import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const plugin = join(repositoryRoot, "dist/plugin");

interface DistributionManifest {
  readonly contractVersion: string;
  readonly pluginVersion: string;
  readonly runtime: {
    readonly entry: string;
    readonly core: string;
    readonly coreSha256: string;
    readonly minimumNode: string;
  };
  readonly contracts: {
    readonly result: string;
    readonly reasonCatalog: string;
    readonly state: string;
    readonly host: string;
  };
}

interface ReasonEntry {
  readonly code: string;
  readonly description: string;
  readonly recovery: string;
}

let manifest: DistributionManifest;
let entry: string;
let core: Buffer;
let reason: ReasonEntry | undefined;

const embeddedSchemaInputs = [
  "schemas/host/adapter-message.v1.schema.json",
  "schemas/result.v1.schema.json",
  "schemas/state/approval.v1.schema.json",
  "schemas/state/event.v1.schema.json",
  "schemas/state/evidence.v1.schema.json",
  "schemas/state/lock.v1.schema.json",
  "schemas/state/migration.v1.schema.json",
  "schemas/state/project-config.v1.schema.json",
  "schemas/state/snapshot.v1.schema.json",
] as const;

beforeAll(async () => {
  const [manifestText, entryText, coreBytes, catalogText] = await Promise.all([
    readFile(join(plugin, "runtime/manifest.json"), "utf8"),
    readFile(join(plugin, "runtime/yoda.mjs"), "utf8"),
    readFile(join(plugin, "runtime/yoda.core.mjs")),
    readFile(
      join(
        repositoryRoot,
        "packages/contracts/catalogs/reason-codes.v1.2.json",
      ),
      "utf8",
    ),
  ]);
  manifest = JSON.parse(manifestText) as DistributionManifest;
  entry = entryText;
  core = coreBytes;
  reason = (JSON.parse(catalogText) as { reasons: ReasonEntry[] }).reasons.find(
    ({ code }) => code === "runtime.node_unsupported",
  );
});

describe("runtime distribution", () => {
  it("binds the manifest to the built core", () => {
    expect(manifest.contractVersion).toBe("1.0.0");
    expect(manifest.pluginVersion).toBe("0.0.0-development");
    expect(manifest.runtime.entry).toBe("runtime/yoda.mjs");
    expect(manifest.runtime.core).toBe("runtime/yoda.core.mjs");
    expect(manifest.runtime.minimumNode).toBe("24.0.0");
    expect(manifest.runtime.coreSha256).toBe(
      createHash("sha256").update(core).digest("hex"),
    );
  });

  it("records the contract versions the bundle carries", () => {
    expect(manifest.contracts).toEqual({
      result: "1.0.0",
      reasonCatalog: "1.3.0",
      state: "1.0.0",
      host: "1.0.0",
    });
  });

  it("substitutes every preflight placeholder", () => {
    expect(entry).not.toMatch(/__[A-Z_]+__/u);
    expect(entry).toContain("runtime.node_unsupported");
    expect(entry).toContain('import("./yoda.core.mjs")');
    expect(entry.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("keeps the preflight text identical to the catalog", () => {
    expect(reason).toBeDefined();
    // Slicing the JSON quotes off yields the exact escaped literal the build
    // embedded, so a drifting copy fails here instead of shipping.
    expect(entry).toContain(JSON.stringify(reason?.recovery).slice(1, -1));
    expect(entry).toContain(JSON.stringify(reason?.description).slice(1, -1));
  });

  it("keeps the shebang off the core bundle", () => {
    expect(core.toString("utf8").startsWith("#!")).toBe(false);
  });

  it("embeds Ajv and every registry schema without checkout-relative imports", async () => {
    const metadata = JSON.parse(
      await readFile(join(repositoryRoot, "dist/build-meta.json"), "utf8"),
    ) as {
      outputs: Record<
        string,
        {
          imports: readonly { external?: boolean; path: string }[];
          inputs: Record<string, { bytesInOutput: number }>;
        }
      >;
    };
    const output = metadata.outputs["dist/plugin/runtime/yoda.core.mjs"];
    expect(output).toBeDefined();
    if (output === undefined) throw new Error("Core build metadata is absent");

    expect(
      output.imports.filter(
        ({ path }) => path === "ajv" || path.startsWith("ajv/"),
      ),
    ).toEqual([]);
    expect(
      Object.keys(output.inputs).some((path) =>
        path.startsWith("node_modules/ajv/"),
      ),
    ).toBe(true);
    for (const schema of embeddedSchemaInputs) {
      expect(output.inputs[schema]?.bytesInOutput).toBeGreaterThan(0);
    }
    expect(core.toString("utf8")).not.toMatch(/(?:\.\.\/)+schemas\//u);
  });

  it("stages exactly the manifest, core, and entry point", async () => {
    expect((await readdir(join(plugin, "runtime"))).sort()).toEqual([
      "manifest.json",
      "yoda.core.mjs",
      "yoda.mjs",
    ]);
  });
});

describe("runtime distribution documentation", () => {
  let guide = "";
  let toolchain = "";

  beforeAll(async () => {
    [guide, toolchain] = await Promise.all([
      readFile(
        join(repositoryRoot, "docs/compatibility/runtime-distribution.md"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "docs/development/toolchain.md"), "utf8"),
    ]);
  });

  it.each([
    "runtime/yoda.mjs",
    "runtime/yoda.core.mjs",
    "runtime/manifest.json",
    "24.0.0",
    "runtime.node_unsupported",
    "--expect",
    "handshake",
    "import.meta.url",
    "process.cwd()",
    "allowlist",
    "denylist",
    "SyntaxError",
  ])("publishes %s", (required) => {
    expect(guide).toContain(required);
  });

  it("states that an absent interpreter is the host adapter's responsibility", () => {
    expect(guide).toMatch(/absent[\s\S]{0,200}host adapter/u);
  });

  it("states that source maps are excluded deliberately", () => {
    expect(guide).toContain("source map");
  });

  it("names the built entry point in the toolchain guide", () => {
    expect(toolchain).toContain("runtime/yoda.mjs");
  });
});
