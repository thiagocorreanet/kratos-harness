# Embedded Runtime Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a plugin-owned runtime that Claude Code and Codex invoke from the plugin directory against any project working directory, with no global executable, no `PATH` entry, and no project `node_modules`.

**Architecture:** A two-file boot. `runtime/yoda.mjs` is a preflight in conservative syntax that gates the Node version and then dynamically imports `runtime/yoda.core.mjs`, the self-contained esbuild bundle. A build-emitted `runtime/manifest.json` binds versions and digests. Package verification enforces a plugin allowlist and a project denylist.

**Tech Stack:** Node.js 24.18.0, strict TypeScript 6, esbuild 0.28.1, Vitest 4, AJV 8 / JSON Schema 2020-12, SHA-256.

## Global Constraints

- The supported interpreter floor is Node **24.0.0**; the bundle targets `node24`.
- `runtime/yoda.mjs` uses only syntax valid on Node 12 and imports nothing but relative paths. It is never transpiled.
- Reason catalog revision `1.2.0` preserves all 82 entries of `1.1.0` byte-for-byte.
- Contract version stays `1.0.0`; the catalog addition is additive.
- The distributed plugin contains exactly three files; `sourcemap` stays `false`.
- Plugin assets resolve from `import.meta.url`; project data resolves from `process.cwd()`.
- Public output never echoes a supplied version value, an absolute path, or a stack trace.
- Keep repository content and delivery text English-only and DCO-sign every commit.

---

### Task 1: Add the unsupported-interpreter reason

**Files:**

- Create: `packages/contracts/catalogs/reason-codes.v1.2.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `schemas/contracts/contract-manifest.v1.schema.json`
- Modify: `packages/contracts/src/compatibility.ts:2`
- Modify: `scripts/lib/result-contract.mjs:274`
- Modify: `tests/contract-reason-catalog.test.ts:16`
- Modify: `tests/contract-manifest.test.ts:111`
- Modify: `tests/contract-documentation.test.ts:42`

**Interfaces:**

- Produces: catalog revision `1.2.0` containing `runtime.node_unsupported` with `status: "failure"`, `exitCode: 2`, `stateMutation: false`, `retryable: false`, and recovery text naming the required Node version.
- Consumes: revision `1.1.0` entries, copied unchanged.

- [x] **Step 1: Write the failing catalog test**

Add to `tests/contract-reason-catalog.test.ts`:

```ts
it("adds the unsupported interpreter reason without altering revision 1.1", async () => {
  const previous = JSON.parse(
    await readFile(resolve("packages/contracts/catalogs/reason-codes.v1.1.json"), "utf8"),
  ) as { reasons: { code: string }[] };
  const current = JSON.parse(
    await readFile(resolve("packages/contracts/catalogs/reason-codes.v1.2.json"), "utf8"),
  ) as { reasons: { code: string; status: string; exitCode: number; recovery: string }[] };

  expect(current.reasons.slice(0, previous.reasons.length)).toEqual(previous.reasons);
  const added = current.reasons.filter((reason) => reason.code === "runtime.node_unsupported");
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ status: "failure", exitCode: 2 });
  expect(added[0]?.recovery).toContain("24");
});
```

- [x] **Step 2: Run RED**

```bash
npm test -- tests/contract-reason-catalog.test.ts
```

Expected: FAIL because `reason-codes.v1.2.json` does not exist.

- [x] **Step 3: Generate the catalog and retarget every reference**

Generate the new file from the old one so the preserved entries are byte-identical rather than retyped:

```bash
node -e '
const fs = require("node:fs");
const source = "packages/contracts/catalogs/reason-codes.v1.1.json";
const catalog = JSON.parse(fs.readFileSync(source, "utf8"));
catalog.reasons.push({
  code: "runtime.node_unsupported",
  description: "The interpreter running the plugin runtime is older than the supported minimum.",
  status: "failure",
  exitCode: 2,
  evidence: "forbidden",
  stateChanged: false,
  retryable: false,
  recovery: "Install Node.js 24.0.0 or newer and run the command again.",
});
fs.writeFileSync("packages/contracts/catalogs/reason-codes.v1.2.json", JSON.stringify(catalog, null, 2) + "\n");
'
```

Those eight keys are exactly the catalog schema's `reason` required set:
`code`, `description`, `status`, `exitCode`, `evidence`, `stateChanged`,
`retryable`, `recovery`. `evidence: "forbidden"` matches the other
`runtime.*` entries, because an interpreter rejection publishes no evidence.

Leave `minItems` for `reasons` in `schemas/reason-catalog.v1.schema.json` at
`76`. It is a floor shared by every revision, and raising it makes the schema
reject the frozen 1.0 and 1.1 catalogs it also validates.

Leave `scripts/check-result-contract.mjs:48` pointing at `reason-codes.v1.json`:
that checker deliberately validates the frozen revision 1.0. Only the canonical
renderer in `result-contract.mjs` follows the current revision.

Then set `reasonCatalog` to `"1.2.0"` in
`contract-families.v1.json` and in the `contract-manifest.v1.schema.json`
`const`, and repoint the three `reason-codes.v1.1.json` string references in
`compatibility.ts:2`, `result-contract.mjs:274`, and
`contract-reason-catalog.test.ts:16` to `v1.2`. Update the expected
`reasonCatalog` literal in `tests/contract-manifest.test.ts:111` and the
filename expectation in `tests/contract-documentation.test.ts:42`.

Leave `contractVersion` at `"1.0.0"`: the catalog revision advances, the
contract does not.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/contract-reason-catalog.test.ts tests/contract-manifest.test.ts tests/contract-documentation.test.ts
npm run result:check
npm run contracts:check
npm run typecheck
npm run lint
git add packages/contracts schemas scripts/lib/result-contract.mjs tests
git commit -s -m "feat: add the unsupported interpreter reason"
```

### Task 2: Gate the interpreter in a preflight

**Files:**

- Create: `packages/runtime/src/boot/preflight.mjs`
- Create: `tests/fixtures/runtime/old-node.mjs`
- Create: `tests/runtime-preflight.test.ts`

**Interfaces:**

- Produces: a preflight template containing the literal placeholders `__MINIMUM_NODE__`, `__SUMMARY__`, `__RECOVERY__`, and `__CORE__`, substituted at build time by Task 3.
- Produces: on an unsupported interpreter, one line of `result.v1` JSON on stdout and exit `2`; otherwise a dynamic import of the core bundle.

- [x] **Step 1: Write the failing preflight tests**

The old-interpreter case runs the real file under a stub that rewrites
`process.versions.node` before the entry point loads, so the shipped artifact is
what gets tested:

```ts
// tests/fixtures/runtime/old-node.mjs
Object.defineProperty(process.versions, "node", {
  value: process.env.YODA_TEST_NODE_VERSION ?? "18.20.0",
  configurable: true,
});
```

```ts
// tests/runtime-preflight.test.ts
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stub = join(import.meta.dirname, "fixtures/runtime/old-node.mjs");

async function materializePreflight(): Promise<string> {
  const template = await readFile(
    join(import.meta.dirname, "../packages/runtime/src/boot/preflight.mjs"),
    "utf8",
  );
  const root = await mkdtemp(join(tmpdir(), "yoda-preflight-"));
  await mkdir(join(root, "runtime"), { recursive: true });
  const entry = join(root, "runtime/yoda.mjs");
  await writeFile(
    entry,
    template
      .replaceAll("__MINIMUM_NODE__", "24.0.0")
      .replaceAll("__SUMMARY__", "Interpreter too old.")
      .replaceAll("__RECOVERY__", "Install Node.js 24.0.0 or newer and run the command again.")
      .replaceAll("__CORE__", "./yoda.core.mjs"),
    "utf8",
  );
  await writeFile(
    join(root, "runtime/yoda.core.mjs"),
    'process.stdout.write("core reached\\n");\n',
    "utf8",
  );
  return entry;
}

function run(entry: string, version: string) {
  return execFileSync(
    process.execPath,
    ["--import", stub, entry],
    {
      encoding: "utf8",
      env: { ...process.env, YODA_TEST_NODE_VERSION: version },
    },
  );
}

describe("runtime preflight", () => {
  it("reaches the core on a supported interpreter", async () => {
    expect(run(await materializePreflight(), "24.18.0")).toBe("core reached\n");
  });

  it("renders a structured result on an unsupported interpreter", async () => {
    const entry = await materializePreflight();
    let stdout = "";
    let status = 0;
    try {
      stdout = run(entry, "18.20.0");
    } catch (error) {
      const failure = error as { stdout: string; status: number };
      stdout = failure.stdout;
      status = failure.status;
    }

    expect(status).toBe(2);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result).toMatchObject({
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "runtime.node_unsupported",
      stateChanged: false,
      retryable: false,
    });
    expect(stdout).not.toContain("18.20.0");
    expect(stdout).not.toContain(entry);
  });
});
```

- [x] **Step 2: Run RED**

```bash
npm test -- tests/runtime-preflight.test.ts
```

Expected: FAIL because `preflight.mjs` does not exist.

- [x] **Step 3: Write the preflight**

No `const`, `let`, arrow functions, template literals, optional chaining, or
top-level `await` — every one of those would defeat the purpose:

```js
#!/usr/bin/env node
"use strict";

var MINIMUM = "__MINIMUM_NODE__";

function atLeast(actual, minimum) {
  var left = String(actual).split(".");
  var right = String(minimum).split(".");
  for (var index = 0; index < 3; index += 1) {
    var a = parseInt(left[index], 10);
    var b = parseInt(right[index], 10);
    if (isNaN(a)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

if (atLeast(process.versions.node, MINIMUM)) {
  import("__CORE__").catch(function () {
    process.stderr.write("The Yoda runtime could not be loaded.\n");
    process.exitCode = 2;
  });
} else {
  process.stdout.write(
    JSON.stringify({
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "runtime.node_unsupported",
      summary: "__SUMMARY__",
      why: ["The plugin runtime requires a newer Node.js interpreter."],
      evidence: [],
      stateChanged: false,
      retryable: false,
      recovery: "__RECOVERY__"
    }) + "\n"
  );
  process.exitCode = 2;
}
```

No lint or format exclusion turned out to be needed: `no-var` is not part of
`eslint:recommended`, and Prettier formats the legacy syntax unchanged. Leave
both configurations alone rather than adding an exemption nothing requires.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/runtime-preflight.test.ts
npm run lint
npm run format:check
git add packages/runtime/src/boot/preflight.mjs tests/runtime-preflight.test.ts tests/fixtures/runtime .prettierignore eslint.config.mjs
git commit -s -m "feat: gate the interpreter before loading the runtime"
```

### Task 3: Emit the two-file runtime and its manifest

**Files:**

- Modify: `scripts/build.mjs`
- Create: `tests/runtime-distribution.test.ts`

**Interfaces:**

- Produces: `dist/plugin/runtime/yoda.mjs`, `dist/plugin/runtime/yoda.core.mjs`, and `dist/plugin/runtime/manifest.json`.
- Produces: manifest fields `contractVersion`, `pluginVersion`, `runtime.entry`, `runtime.core`, `runtime.coreSha256`, `runtime.minimumNode`, and `contracts` holding the result, reason-catalog, state, and host versions read from `contract-families.v1.json`.
- Consumes: the Task 2 preflight template and its four placeholders.

- [ ] **Step 1: Write the failing distribution test**

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(import.meta.dirname, "../dist/plugin");

describe("runtime distribution", () => {
  it("binds the manifest to the built core", async () => {
    const manifest = JSON.parse(
      await readFile(join(plugin, "runtime/manifest.json"), "utf8"),
    ) as { runtime: { entry: string; core: string; coreSha256: string; minimumNode: string } };
    const core = await readFile(join(plugin, "runtime/yoda.core.mjs"));

    expect(manifest.runtime.entry).toBe("runtime/yoda.mjs");
    expect(manifest.runtime.core).toBe("runtime/yoda.core.mjs");
    expect(manifest.runtime.minimumNode).toBe("24.0.0");
    expect(manifest.runtime.coreSha256).toBe(
      createHash("sha256").update(core).digest("hex"),
    );
  });

  it("substitutes every preflight placeholder", async () => {
    const entry = await readFile(join(plugin, "runtime/yoda.mjs"), "utf8");
    expect(entry).not.toMatch(/__[A-Z_]+__/u);
    expect(entry).toContain("runtime.node_unsupported");
    expect(entry).toContain("./yoda.core.mjs");
  });

  it("keeps the preflight recovery text identical to the catalog", async () => {
    const catalog = JSON.parse(
      await readFile(
        join(import.meta.dirname, "../packages/contracts/catalogs/reason-codes.v1.2.json"),
        "utf8",
      ),
    ) as { reasons: { code: string; description: string; recovery: string }[] };
    const reason = catalog.reasons.find(({ code }) => code === "runtime.node_unsupported");
    const entry = await readFile(join(plugin, "runtime/yoda.mjs"), "utf8");

    expect(reason).toBeDefined();
    expect(entry).toContain(JSON.stringify(reason?.recovery).slice(1, -1));
    expect(entry).toContain(JSON.stringify(reason?.description).slice(1, -1));
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm run build && npm test -- tests/runtime-distribution.test.ts
```

Expected: FAIL because the build emits a single `runtime/yoda.mjs` bundle and no manifest.

- [ ] **Step 3: Split the build output**

Change `outfile` to `dist/plugin/runtime/yoda.core.mjs`, drop the shebang banner
from the bundle (the preflight owns the shebang now), then read the preflight
template, substitute the four placeholders from the catalog and
`contract-families.v1.json`, and write `runtime/yoda.mjs` with mode `0755`.
Write `runtime/manifest.json` last so it can record the core digest.

Substitute with `JSON.stringify(value).slice(1, -1)` so a quote or backslash in
catalog text cannot break out of the emitted string literal.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run build
npm test -- tests/runtime-distribution.test.ts
node dist/plugin/runtime/yoda.mjs --version
npm run typecheck
npm run lint
git add scripts/build.mjs tests/runtime-distribution.test.ts
git commit -s -m "feat: emit the two-file runtime and its manifest"
```

### Task 4: Answer the handshake and pin the plugin version

**Files:**

- Create: `packages/runtime/src/handshake.ts`
- Modify: `packages/runtime/src/cli.ts`
- Modify: `packages/runtime/package.json`
- Modify: `vitest.config.ts`
- Create: `tests/runtime-handshake.test.ts`

**Interfaces:**

- Produces: `buildHandshakeResponse(correlationId: string): AdapterMessageV1` returning a `messageType: "response"` message whose `payload` is a successful `result.v1`.
- Produces: `classifyExpectedVersion(value: unknown): ContractFailureResult | null`, returning `null` when the value matches the bundle plugin version.
- Consumes: `classifyContractVersion` and `contractFailureResult` from `@mestre-yoda/contracts`.

- [ ] **Step 1: Write the failing handshake tests**

```ts
import { buildHandshakeResponse, classifyExpectedVersion } from "@mestre-yoda/runtime/handshake";
import { YODA_VERSION } from "@mestre-yoda/contracts";
import { describe, expect, it } from "vitest";

describe("runtime handshake", () => {
  it("reports the carried contract versions", () => {
    const message = buildHandshakeResponse("cli");
    expect(message).toMatchObject({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      messageType: "response",
      operation: "handshake",
      correlationId: "cli",
    });
    expect(message.payload).toMatchObject({ status: "success", exitCode: 0, stateChanged: false });
  });

  it("accepts the exact bundle version", () => {
    expect(classifyExpectedVersion(YODA_VERSION)).toBeNull();
  });

  it.each([
    [undefined, "contract.plugin_version_invalid"],
    ["", "contract.plugin_version_invalid"],
    ["not-semver", "contract.plugin_version_invalid"],
    ["9.9.9", "contract.plugin_version_unsupported"],
  ])("rejects %s", (value, reasonCode) => {
    const failure = classifyExpectedVersion(value);
    expect(failure).toMatchObject({ reasonCode, exitCode: 2, stateChanged: false });
    expect(JSON.stringify(failure)).not.toContain(String(value));
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/runtime-handshake.test.ts
```

Expected: FAIL because `handshake.ts` does not exist.

- [ ] **Step 3: Implement the handshake and wire the CLI**

`buildHandshakeResponse` reads `contract-families.v1.json` and returns a message
with `host: "unknown"`, `capabilities: []`, and
`observedIdentity: { adapterVersion: YODA_VERSION, model: null }`, because the
runtime cannot observe a host identity when invoked directly. `messageId` is the
constant `"handshake-response"` so output stays deterministic.

`classifyExpectedVersion` calls `classifyContractVersion("plugin", value)` and
returns `contractFailureResult(classification)` unless the classification is
`current`.

In `cli.ts`, accept `handshake` as a subcommand and `--expect <version>` as a
prefix flag on any invocation. Both write JSON plus a trailing newline to
stdout. Keep `--help` and `--version` byte-identical.

`packages/runtime/package.json` currently exports a single path
(`"exports": "./src/cli.ts"`), so the test import above cannot resolve. Replace
it with a subpath map:

```json
"exports": {
  ".": "./src/cli.ts",
  "./handshake": "./src/handshake.ts"
}
```

Add `packages/runtime/src/handshake.ts` to the `vitest.config.ts` coverage
`include` array, because the repository gates runtime sources at 100%. Every
branch of `classifyExpectedVersion` is covered by the `it.each` table above plus
the accepting case; keep the module free of unreachable defensive branches so
the gate stays achievable.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/runtime-handshake.test.ts packages/runtime/src/cli.test.ts
npm run test:coverage
npm run typecheck
npm run lint
git add packages/runtime/src tests/runtime-handshake.test.ts vitest.config.ts
git commit -s -m "feat: answer the contract handshake and pin the plugin version"
```

### Task 5: Prove the distribution and installation boundaries

**Files:**

- Modify: `scripts/verify-package.mjs`
- Create: `tests/package-boundaries.test.ts`
- Modify: `tests/package-verifier.test.ts`

**Interfaces:**

- Produces: an exact plugin allowlist of `runtime/manifest.json`, `runtime/yoda.core.mjs`, and `runtime/yoda.mjs`.
- Produces: a project denylist rejecting `node_modules`, `packages`, `runtime`, `*.ts`, and `*.map` anywhere under a project the runtime operated on.
- Produces: a black-box run whose `PATH` contains a failing decoy `yoda`, from a project directory whose name contains a space and a non-ASCII character.

- [ ] **Step 1: Write the failing boundary tests**

```ts
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(import.meta.dirname, "../dist/plugin");

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-boundary-"));
  const directory = join(root, "a project ç ü");
  await mkdir(directory, { recursive: true });
  return directory;
}

async function decoyPath(root: string): Promise<string> {
  const binary = join(root, "yoda");
  await writeFile(binary, "#!/bin/sh\necho 'global yoda was used' >&2\nexit 99\n", "utf8");
  await chmod(binary, 0o755);
  return root;
}

describe("distribution boundaries", () => {
  it("runs from a plugin directory against a project with spaces and non-ASCII characters", async () => {
    const cwd = await project();
    const stdout = execFileSync(
      process.execPath,
      [join(plugin, "runtime/yoda.mjs"), "--version"],
      { cwd, encoding: "utf8" },
    );
    expect(stdout.trim()).toBe("0.0.0-development");
  });

  it("never consults a global yoda on PATH", async () => {
    const cwd = await project();
    const decoy = await decoyPath(await mkdtemp(join(tmpdir(), "yoda-decoy-")));
    const stdout = execFileSync(
      process.execPath,
      [join(plugin, "runtime/yoda.mjs"), "--version"],
      {
        cwd,
        encoding: "utf8",
        env: { PATH: `${decoy}:${process.env.PATH ?? ""}`, HOME: cwd },
      },
    );
    expect(stdout.trim()).toBe("0.0.0-development");
  });

  it("leaves no runtime source or dependency in the project", async () => {
    const cwd = await project();
    execFileSync(process.execPath, [join(plugin, "runtime/yoda.mjs"), "--help"], { cwd });
    const entries = await readdir(cwd, { recursive: true });
    for (const entry of entries) {
      expect(entry).not.toMatch(/(^|\/)(node_modules|packages|runtime)(\/|$)/u);
      expect(entry).not.toMatch(/\.(ts|map)$/u);
    }
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm run build && npm test -- tests/package-boundaries.test.ts
```

Expected: the first two cases FAIL because the built entry is still a single bundle whose name and content changed in Task 3, and the third passes trivially until the allowlist below is enforced.

- [ ] **Step 3: Enforce both inventories**

Set `expectedInventory` to the three-file allowlist sorted lexicographically.
Keep the forbidden-reference and external-import checks and apply them to
`runtime/yoda.core.mjs`. Verify the shebang on `runtime/yoda.mjs` rather than on
the core, and verify `runtime/manifest.json` records the core's real digest.

Copy the whole `runtime` directory into the clean room instead of one file, so
the isolated execution exercises the real two-file boot.

Add a project-denylist check that runs the built entry inside a temporary
project and fails if any denied pattern appears afterward.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run build
npm run package:verify
npm test -- tests/package-boundaries.test.ts tests/package-verifier.test.ts
npm run lint
git add scripts/verify-package.mjs tests
git commit -s -m "test: prove the plugin and project installation boundaries"
```

### Task 6: Document, verify, review, and deliver

**Files:**

- Create: `docs/compatibility/runtime-distribution.md`
- Modify: `README.md`
- Modify: `docs/development/toolchain.md`
- Modify: `docs/compatibility/result-contract.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Modify: `schemas/README.md`
- Modify: `tests/readme-honesty.test.ts`
- Modify: this plan

**Interfaces:**

- Publishes the plugin layout, the two-file boot rationale, the interpreter floor, the two-root rule, both inventories, the handshake contract, and honest unchanged parity.

- [ ] **Step 1: Write documentation RED tests**

Extend `tests/readme-honesty.test.ts` to require the README to name the
plugin-owned runtime and to state that no global executable is installed. Add a
guide test requiring `docs/compatibility/runtime-distribution.md` to contain
`runtime/yoda.mjs`, `runtime/yoda.core.mjs`, `24.0.0`, `runtime.node_unsupported`,
`--expect`, `handshake`, `import.meta.url`, `process.cwd()`, and both the words
`allowlist` and `denylist`. Assert parity still reads `0 / 400 (0.00%)`.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/readme-honesty.test.ts
```

Expected: FAIL because the distribution guide does not exist.

- [ ] **Step 3: Publish exact documentation**

Document the three-file plugin layout; why the boot is split and what a
single-file guard cannot do; the Node 24.0.0 floor and the Node 12 syntax floor
of the preflight; that an absent Node is the host adapter's responsibility and
not the runtime's; the plugin-root versus project-root rule; both inventories;
`--expect` and `handshake` semantics with their reason codes; and that source
maps are deliberately excluded. Record catalog revision `1.2.0` in the result
contract and contract versioning guides and in `schemas/README.md`. Check
completed plan steps in this file.

- [ ] **Step 4: Run final verification**

```bash
export PATH=/tmp/tmp.qb2rcwG3r2/node-v24.18.0-linux-x64/bin:$PATH
npm test -- tests/runtime-preflight.test.ts tests/runtime-distribution.test.ts tests/runtime-handshake.test.ts tests/package-boundaries.test.ts tests/package-verifier.test.ts tests/readme-honesty.test.ts tests/contract-reason-catalog.test.ts tests/contract-manifest.test.ts
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/docs.yml
npx markdownlint-cli2 "**/*.md" "#node_modules" "#.worktrees"
rg --files -g '*.md' -g '!node_modules/**' -g '!.worktrees/**' -0 | xargs -0 /tmp/tmp.KmVAr8uMu3/lychee-x86_64-unknown-linux-gnu/lychee --config .lychee.toml
git diff --check main...HEAD
git status --short
```

Expected: all gates PASS, parity unchanged, and only intended changes remain.

- [ ] **Step 5: Commit and review**

```bash
git add docs README.md schemas/README.md tests/readme-honesty.test.ts
git commit -s -m "docs: publish the runtime distribution contract"
```

Use `requesting-code-review` against `main...HEAD`; resolve every Critical and
Important finding with `receiving-code-review`, then rerun Step 4.

- [ ] **Step 6: Deliver and close #14**

Push, open an English PR with `Closes #14`, include the exact commands and the
decoy-`PATH` and non-ASCII-path evidence, wait for GitHub checks, squash merge,
confirm issue `#14` closed, mark only `#14` in epic `#8`, fast-forward `main`,
and remove this owned worktree and branch.
