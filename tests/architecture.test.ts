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
    const root = await mkdtemp(join(tmpdir(), "kratos-architecture-"));
    roots.push(root);
    const file = join(root, "sample.ts");
    await writeFile(
      file,
      [
        'import { a } from "node:fs/promises";',
        'import type { B } from "../ports/clock.js";',
        'import "./side-effect.js";',
        'export { c } from "@kratos/contracts";',
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
      "@kratos/contracts",
      "node:crypto",
    ]);
  });

  it("finds imports split across lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-architecture-"));
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
      "./git.js",
      "./transactions.js",
    ]);

    expect(
      await collectImports(
        join(repositoryRoot, "packages/runtime/src/composition/index.ts"),
      ),
    ).toEqual([
      "node:util",
      "../domain/effects.js",
      "../domain/events/index.js",
      "../domain/transactions/index.js",
      "../domain/schema/index.js",
      "../domain/result/index.js",
      "../infra/node/index.js",
      "../ports/index.js",
      "./read-only.js",
      "./preview-result.js",
      "./git.js",
      "./schema.js",
      "./events.js",
      "./transactions.js",
      "./locks.js",
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
    ["packages/runtime/src/domain/policy.ts", "@kratos/contracts"],
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
  let eventStoreGuide = "";
  let atomicTransactionsGuide = "";
  let concurrencyLocksGuide = "";
  let dryRunGuide = "";
  let initializationGuide = "";
  let objectiveGuide = "";

  beforeAll(async () => {
    [
      guide,
      eventStoreGuide,
      atomicTransactionsGuide,
      concurrencyLocksGuide,
      dryRunGuide,
      initializationGuide,
      objectiveGuide,
    ] = await Promise.all([
      readFile(
        join(repositoryRoot, "docs/architecture/runtime-boundaries.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/event-store.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/atomic-transactions.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/concurrency-locks.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/dry-run-plans.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/project-initialization.md"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "docs/architecture/objective-lifecycle.md"),
        "utf8",
      ),
    ]);
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

  // `RUN-01` asserted that this document named both pending owners, `RUN-07`
  // and `RUN-08`. Both have since delivered, so the document names no port
  // whose semantics are still owed and points at the shipped contracts.
  it("points at the delivered port contracts", () => {
    expect(guide).toContain("git-service.md");
    expect(guide).toContain("concurrency-locks.md");
  });

  it.each([
    "events.jsonl",
    "state.json",
    "exact-prefix",
    "canonical JSON",
    "previousHash",
    "eventHash",
    "64 KiB",
    "64 MiB",
    "100,000",
    "runtime.state_corrupt",
    "runtime.revision_conflict",
    "runtime.recovery_required",
    "tamper evidence",
    "not authentication",
    "no raw prompts",
  ])("publishes the event-store integrity boundary: %s", (required) => {
    expect(eventStoreGuide).toContain(required);
  });

  it.each([
    "run:<run-id>",
    ".brain/locks/project",
    ".brain/locks/runs/<encoded-run-id>",
    "Base64URL",
    "30 seconds",
    "10 seconds",
    "5 seconds",
    "runtime.lease_conflict",
    "runtime.recovery_required",
    "explicit takeover",
    "fencing token",
    "read-only",
  ])("publishes the lock boundary: %s", (required) => {
    expect(concurrencyLocksGuide).toContain(required);
  });

  it.each([
    "One code path, two exits",
    "readOnlyPorts",
    "planDigest",
    "expectPreview",
    "runtime.revision_conflict",
    "runtime.recovery_required",
    "stateChanged: false",
    "does not add a public command",
  ])("publishes the preview boundary: %s", (required) => {
    expect(dryRunGuide).toContain(required);
  });

  it.each([
    "BEGIN KRATOS MANAGED SECTION",
    "guard.outside_allow",
    "runtime.state_corrupt",
    "--worktree-local",
    "created",
    "preserved",
    "0 / 400 (0.00%)",
    "in_progress",
  ])("publishes the initialization boundary: %s", (required) => {
    expect(initializationGuide).toContain(required);
  });

  it.each([
    "trail.objetivo_divergente",
    "--replace",
    "objective-history.jsonl",
    "idempotent",
    "0 / 400 (0.00%)",
    "CMP-05",
  ])("publishes the objective boundary: %s", (required) => {
    expect(objectiveGuide).toContain(required);
  });

  it("states that completion has no command yet", () => {
    // A reader who finds a completed status will look for the command that
    // sets it. The document has to say where that lives.
    expect(objectiveGuide).toMatch(/SDD-06/u);
  });

  it("states what initialization refuses to claim", () => {
    // A reader who sees seven implemented flags will assume the parity number
    // moved. It did not, and the document has to say why.
    expect(initializationGuide).toMatch(/CMP-05/u);
    expect(initializationGuide).toMatch(/hash-only provenance/u);
  });

  it("states why the dry-run flag is absent rather than omitting it", () => {
    // A reader who finds no mention of the flag will assume it was forgotten.
    expect(dryRunGuide).toContain("--dry-run");
    expect(dryRunGuide).toContain("--require-contract");
    expect(dryRunGuide).toContain("0 / 400");
  });

  it("states what the lock contract refuses to promise", () => {
    expect(concurrencyLocksGuide).toMatch(/does\s+not add a public command/iu);
    expect(concurrencyLocksGuide).toContain("PID");
    expect(concurrencyLocksGuide).toContain("#99");
  });

  it("states the conditional reducer and portable filesystem guarantees", () => {
    expect(eventStoreGuide).toMatch(
      /caller-supplied reducers and\s+materializer are pure/iu,
    );
    expect(eventStoreGuide).toMatch(/double-run comparison is\s+diagnostic/iu);
    expect(atomicTransactionsGuide).toMatch(
      /concurrent pathname replacement by a\s+non-cooperating local process/iu,
    );
    expect(atomicTransactionsGuide).toContain("directory-handle-relative I/O");
  });
});

describe("the repository obeys its own rules", () => {
  it("keeps transaction domain and durable ports free of Node.js builtins", async () => {
    const paths = [
      "packages/runtime/src/domain/transactions/index.ts",
      "packages/runtime/src/domain/transactions/model.ts",
      "packages/runtime/src/domain/transactions/normalize.ts",
      "packages/runtime/src/domain/transactions/recovery.ts",
      "packages/runtime/src/domain/transactions/transition.ts",
      "packages/runtime/src/ports/transactions.ts",
    ] as const;
    const modules = await Promise.all(
      paths.map(async (path) => ({
        path,
        imports: await collectImports(join(repositoryRoot, path)),
      })),
    );

    expect(modules.map(({ path }) => path)).toEqual(paths);
    expect(violations(modules)).toEqual([]);
  });

  it("has no dependency-direction violation", async () => {
    const modules = await sourceModules();
    // Prove the sweep actually looked at the layered source, so an empty glob
    // cannot report a clean repository.
    expect(modules.some(({ path }) => path.includes("/domain/"))).toBe(true);
    expect(modules.some(({ path }) => path.includes("/ports/"))).toBe(true);
    expect(violations(modules)).toEqual([]);
  });

  it("sweeps every event-domain module", async () => {
    const modules = await sourceModules();
    const eventModules = modules
      .map(({ path }) => path)
      .filter((path) => path.startsWith("packages/runtime/src/domain/events/"))
      .sort();

    expect(eventModules).toEqual([
      "packages/runtime/src/domain/events/index.ts",
      "packages/runtime/src/domain/events/model.ts",
      "packages/runtime/src/domain/events/parse.ts",
      "packages/runtime/src/domain/events/redaction.ts",
      "packages/runtime/src/domain/events/reduce.ts",
      "packages/runtime/src/domain/events/seal.ts",
      "packages/runtime/src/domain/events/verify.ts",
    ]);
  });

  it("confines child_process to the single Git runner module", async () => {
    const modules = await sourceModules();
    const importers = modules
      .filter(({ path }) => path.startsWith("packages/runtime/"))
      .filter(({ imports }) =>
        imports.some((specifier) =>
          /^node:child_process$|^child_process$/u.test(specifier),
        ),
      )
      .map(({ path }) => path)
      .sort();

    // The acceptance criterion "policy code never shells out directly" is only
    // real if it fails CI. One runtime module owns process execution; everything
    // else reaches Git through the port.
    //
    // Scoped to the runtime package deliberately. `packages/differential` spawns
    // the frozen Go v3 binary — running an external process is the entire point
    // of the differential harness, and it is not policy code.
    expect(importers).toEqual(["packages/runtime/src/infra/node/git.ts"]);
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
