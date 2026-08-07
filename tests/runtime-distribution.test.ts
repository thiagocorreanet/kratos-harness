import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
      reasonCatalog: "1.2.0",
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
});
