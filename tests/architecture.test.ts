import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  classifyLayer,
  collectImports,
  violations,
  type SourceModule,
} from "./support/architecture.js";

const repositoryRoot = join(import.meta.dirname, "..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("import extraction", () => {
  it("finds static, type-only, side-effect, and dynamic imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "yoda-architecture-"));
    roots.push(root);
    const file = join(root, "sample.ts");
    await writeFile(
      file,
      [
        'import { a } from "node:fs/promises";',
        'import type { B } from "../ports/clock.js";',
        'import "./side-effect.js";',
        'export { c } from "@mestre-yoda/contracts";',
        'const d = await import("node:crypto");',
        '// import { ignored } from "node:net";',
        'const text = "import { alsoIgnored } from \\"node:tls\\";";',
        "void d;",
        "void text;",
      ].join("\n"),
      "utf8",
    );

    expect(await collectImports(file)).toEqual([
      "node:fs/promises",
      "../ports/clock.js",
      "./side-effect.js",
      "@mestre-yoda/contracts",
      "node:crypto",
    ]);
  });

  it("finds imports split across lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "yoda-architecture-"));
    roots.push(root);
    const file = join(root, "multiline.ts");
    // This is Prettier's own output for an import with several names, so an
    // extractor that only reads single-line imports would miss most real ones.
    await writeFile(
      file,
      [
        "import {",
        "  mkdir,",
        "  readFile,",
        '} from "node:fs/promises";',
        "import type {",
        "  Clock,",
        '} from "../ports/index.js";',
        "import",
        "  { indirect }",
        '  from "node:crypto";',
        'export * from "node:os";',
        "  import { indented } from " + '"node:tls";',
      ].join("\n"),
      "utf8",
    );

    expect(await collectImports(file)).toEqual([
      "node:fs/promises",
      "../ports/index.js",
      "node:crypto",
      "node:os",
      "node:tls",
    ]);
  });

  it("reads every import in the layered source it sweeps", async () => {
    // A silently empty result would make the repository sweep vacuous, so the
    // real files are asserted to yield their real dependencies.
    expect(
      await collectImports(
        join(repositoryRoot, "packages/runtime/src/infra/fake/index.ts"),
      ),
    ).toEqual([
      "node:path",
      "../../domain/project/index.js",
      "../../ports/index.js",
    ]);

    expect(
      await collectImports(
        join(repositoryRoot, "packages/runtime/src/composition/index.ts"),
      ),
    ).toEqual([
      "../domain/effects.js",
      "../infra/node/index.js",
      "../ports/index.js",
      "./schema.js",
    ]);
  });
});

describe("layer classification", () => {
  it.each([
    ["packages/runtime/src/domain/effects.ts", "domain"],
    ["packages/runtime/src/ports/clock.ts", "ports"],
    ["packages/runtime/src/infra/node/clock.ts", "infra"],
    ["packages/runtime/src/infra/fake/clock.ts", "infra"],
    ["packages/runtime/src/composition/runtime.ts", "composition"],
    ["packages/runtime/src/cli.ts", "entry"],
    ["packages/contracts/src/index.ts", "contracts"],
  ])("classifies %s as %s", (path, layer) => {
    expect(classifyLayer(path)).toBe(layer);
  });
});

describe("dependency direction", () => {
  it("rejects a domain module importing a Node builtin", () => {
    const modules: SourceModule[] = [
      {
        path: "packages/runtime/src/domain/policy.ts",
        imports: ["node:fs/promises"],
      },
    ];

    expect(violations(modules)).toEqual([
      {
        path: "packages/runtime/src/domain/policy.ts",
        specifier: "node:fs/promises",
        reason: "domain must not import Node.js builtins",
      },
    ]);
  });

  it.each([
    "ajv",
    "../../../../../schemas/state/approval.v1.schema.json",
    "../infra/schema/index.js",
  ])(
    "rejects a domain module importing schema infrastructure through %s",
    (specifier) => {
      const path = "packages/runtime/src/domain/policy.ts";

      expect(violations([{ path, imports: [specifier] }])).toEqual([
        {
          path,
          specifier,
          reason: "domain must not import schema infrastructure",
        },
      ]);
    },
  );

  it.each([
    "ajv",
    "../../../../../schemas/state/approval.v1.schema.json",
    "../infra/schema/index.js",
  ])(
    "rejects a ports module importing schema infrastructure through %s",
    (specifier) => {
      const path = "packages/runtime/src/ports/schema.ts";

      expect(violations([{ path, imports: [specifier] }])).toEqual([
        {
          path,
          specifier,
          reason: "ports must not import schema infrastructure",
        },
      ]);
    },
  );

  it.each([
    [
      "packages/runtime/src/domain/policy.ts",
      "../infra/node/clock.js",
      "domain must not import infra",
    ],
    [
      "packages/runtime/src/ports/clock.ts",
      "node:crypto",
      "ports must not import Node.js builtins",
    ],
    // A bare builtin specifier is legal Node and resolves fine, so matching
    // only the `node:` prefix would let four dropped characters walk through
    // the rule this whole issue exists to enforce.
    [
      "packages/runtime/src/domain/policy.ts",
      "fs",
      "domain must not import Node.js builtins",
    ],
    [
      "packages/runtime/src/domain/policy.ts",
      "fs/promises",
      "domain must not import Node.js builtins",
    ],
    [
      "packages/runtime/src/domain/policy.ts",
      "crypto",
      "domain must not import Node.js builtins",
    ],
    [
      "packages/runtime/src/ports/clock.ts",
      "path",
      "ports must not import Node.js builtins",
    ],
    [
      "packages/runtime/src/domain/policy.ts",
      "../composition/runtime.js",
      "only an entry point may import composition",
    ],
    [
      "packages/runtime/src/infra/node/clock.ts",
      "../../composition/runtime.js",
      "only an entry point may import composition",
    ],
  ])("rejects %s importing %s", (path, specifier, reason) => {
    expect(violations([{ path, imports: [specifier] }])).toEqual([
      { path, specifier, reason },
    ]);
  });

  it.each([
    ["packages/runtime/src/domain/policy.ts", "../ports/clock.js"],
    ["packages/runtime/src/domain/policy.ts", "./effects.js"],
    ["packages/runtime/src/domain/policy.ts", "@mestre-yoda/contracts"],
    ["packages/runtime/src/ports/schema.ts", "../domain/schema/index.js"],
    ["packages/runtime/src/ports/clock.ts", "../domain/effects.js"],
    ["packages/runtime/src/infra/node/clock.ts", "node:fs/promises"],
    ["packages/runtime/src/infra/node/clock.ts", "../../ports/clock.js"],
    ["packages/runtime/src/composition/runtime.ts", "../infra/node/clock.js"],
    ["packages/runtime/src/cli.ts", "./composition/runtime.js"],
  ])("allows %s importing %s", (path, specifier) => {
    expect(violations([{ path, imports: [specifier] }])).toEqual([]);
  });

  it("resolves a relative specifier against the importing module", () => {
    // `../handshake.js` from domain lands on an entry module. Classifying by
    // the specifier text alone would leave `entry` unreachable, making those
    // rules dead code and allowing domain to reach a builtin indirectly.
    expect(
      violations([
        {
          path: "packages/runtime/src/domain/policy.ts",
          imports: ["../handshake.js"],
        },
      ]),
    ).toEqual([
      {
        path: "packages/runtime/src/domain/policy.ts",
        specifier: "../handshake.js",
        reason: "domain must not import entry",
      },
    ]);
  });

  it("treats require as an import", () => {
    expect(
      violations([
        {
          path: "packages/runtime/src/domain/policy.ts",
          imports: ["fs"],
        },
      ]).map(({ reason }) => reason),
    ).toEqual(["domain must not import Node.js builtins"]);
  });
});

describe("runtime boundary documentation", () => {
  let guide = "";

  beforeAll(async () => {
    guide = await readFile(
      join(repositoryRoot, "docs/architecture/runtime-boundaries.md"),
      "utf8",
    );
  });

  it.each([
    "domain",
    "ports",
    "infra",
    "composition",
    "Clock",
    "Ids",
    "FileSystem",
    "Git",
    "Locks",
    "Environment",
    "Output",
    "createRuntime",
    "EffectPlan",
    "0 / 400 (0.00%)",
  ])("publishes %s", (required) => {
    expect(guide).toContain(required);
  });

  it("states that only an entry point may import composition", () => {
    expect(guide).toMatch(/only an entry point may import composition/iu);
  });

  it("names the issues that own Git and Locks semantics", () => {
    expect(guide).toContain("RUN-07");
    expect(guide).toContain("RUN-08");
  });
});

describe("the repository obeys its own rules", () => {
  it("has no dependency-direction violation", async () => {
    const modules = await sourceModules();
    // Prove the sweep actually looked at the layered source, so an empty glob
    // cannot report a clean repository.
    expect(modules.some(({ path }) => path.includes("/domain/"))).toBe(true);
    expect(modules.some(({ path }) => path.includes("/ports/"))).toBe(true);
    expect(violations(modules)).toEqual([]);
  });
});

async function sourceModules(): Promise<SourceModule[]> {
  const entries = await readdir(join(repositoryRoot, "packages"), {
    recursive: true,
    withFileTypes: true,
  });
  const collected: SourceModule[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|mts|cts|tsx|js|mjs|cjs)$/u.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    const absolute = join(entry.parentPath, entry.name);
    const path = absolute
      .slice(repositoryRoot.length + 1)
      .split("\\")
      .join("/");
    collected.push({ path, imports: await collectImports(absolute) });
  }
  return collected;
}
