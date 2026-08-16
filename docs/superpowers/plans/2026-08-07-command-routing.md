# Command Routing and Structured Output Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every command one validated invocation pipeline, one generated
help surface, and one rendering of the universal result contract.

**Architecture:** Commands are declarative specifications. One generic parser
consumes them, so parsing, usage text, and help cannot disagree. Parsing,
resolution, dispatch, and rendering are pure functions in `domain`; the
composition root is the only code that applies effects or writes to a stream.

**Tech Stack:** TypeScript 6, Node 24, Vitest, esbuild. No new dependency.

Design: [`docs/superpowers/specs/2026-08-07-command-routing-design.md`](../specs/2026-08-07-command-routing-design.md).
Issue [#17](https://github.com/thiagocorreanet/kratos-harness/issues/17) (`RUN-02`).

## Global Constraints

- Everything committed is in English: code, tests, fixtures, comments, errors,
  documentation, commit messages, and pull-request text.
- Prose wraps at 80 columns. Markdown must pass `npx markdownlint-cli2` and
  `npm run spellcheck`. Add a new proper noun to `.cspell.json` in alphabetical
  order rather than rewording around it.
- `packages/runtime/src/domain/**` and `packages/runtime/src/composition/**` are
  held to 100% branch, function, line, and statement coverage.
- `domain` and `ports` may not import a Node builtin, and only an entry point
  may import `composition`. `tests/architecture.test.ts` enforces this.
- Results never echo a caller-supplied argument value.
- Contract version stays `1.0.0`. The reason catalog moves to revision `1.3.0`,
  which is additive: earlier revisions stay byte-identical.
- Parity stays `0 / 400 (0.00%)`. No inventory row moves.
- Run `npm run verify` before opening the pull request.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/contracts/catalogs/reason-codes.v1.3.json` | Catalog revision adding the orientation reason |
| `packages/contracts/src/reasons.ts` | Typed catalog lookup for consumers |
| `packages/runtime/src/domain/result/result.ts` | Result envelope type and catalog-backed constructors |
| `packages/runtime/src/domain/result/validate.ts` | Envelope, catalog agreement, and output-safety checks |
| `packages/runtime/src/domain/result/render.ts` | JSON and human rendering, returning text |
| `packages/runtime/src/domain/result/index.ts` | Barrel for the result module |
| `packages/runtime/src/domain/cli/spec.ts` | `CommandSpec`, `FlagSpec`, globals, and registry types |
| `packages/runtime/src/domain/cli/help.ts` | Help and usage text generated from a registry |
| `packages/runtime/src/domain/cli/parse.ts` | Global flags, command resolution, argument parsing |
| `packages/runtime/src/domain/cli/commands.ts` | The three implemented command specifications |
| `packages/runtime/src/domain/cli/dispatch.ts` | Handler invocation |
| `packages/runtime/src/domain/cli/index.ts` | Barrel for the CLI module |
| `packages/runtime/src/composition/cli.ts` | Stage wiring, plan application, stream writes, exit code |
| `packages/runtime/src/cli.ts` | Thin entry point over the composed pipeline |

## A note on why command text is not an effect

The `Output` port names its methods `structured` and `human`, and the Node
implementation maps `structured` to stdout and `human` to stderr. The names
describe streams, not audiences: help text is human prose that must reach
stdout. Command-owned stdout text therefore travels on the `Decision`, and the
effect plan stays reserved for state effects. Routing an `emit` effect through
the `human` channel would put help on stderr and break `CLI-HELP`.

---

### Task 1: Add reason catalog revision 1.3

The catalog has no exit-0 reason for orientation output. `trail.ok` requires
evidence and represents a state change, so `help`, `version`, and the shipped
`handshake` payload have no valid reason code. The handshake already emits
`trail.ok` with empty evidence, which contradicts its own policy.

**Files:**

- Create: `packages/contracts/catalogs/reason-codes.v1.3.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/compatibility.ts:2`
- Modify: `scripts/build.mjs:67`
- Modify: `scripts/lib/result-contract.mjs:274`
- Modify: `docs/compatibility/result-contract.md`
- Test: `tests/contract-reason-catalog.test.ts`,
  `tests/contract-manifest.test.ts`, `tests/contract-documentation.test.ts`

**Interfaces:**

- Produces: reason code `runtime.orientation_ok`, catalog revision `1.3.0`.

- [x] **Step 1: Write the failing test**

Add to `tests/contract-reason-catalog.test.ts`, alongside the existing
revision tests. Add `catalogV13Path`, `catalogV13`, and `catalogV13Text`
following the exact shape of the 1.2 declarations at the top of the file.

```ts
it("preserves revision 1.2 and appends the orientation reason", () => {
  expect(catalogV13.contractVersion).toBe("1.0.0");
  expect(catalogV13.reasons.slice(0, catalogV12.reasons.length)).toEqual(
    catalogV12.reasons,
  );
  expect(catalogV13.reasons).toHaveLength(84);
  expect(
    catalogV13.reasons.slice(catalogV12.reasons.length).map(({ code }) => code),
  ).toEqual(["runtime.orientation_ok"]);
});

it("lets orientation output succeed without claiming evidence or mutation", () => {
  expect(
    catalogV13.reasons.find(({ code }) => code === "runtime.orientation_ok"),
  ).toMatchObject({
    status: "success",
    exitCode: 0,
    evidence: "optional",
    stateChanged: false,
    retryable: false,
    recovery: null,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contract-reason-catalog.test.ts`
Expected: FAIL, the 1.3 catalog file does not exist.

- [x] **Step 3: Create the revision**

```bash
node -e '
const fs = require("node:fs");
const path = "packages/contracts/catalogs/reason-codes.v1.2.json";
const catalog = JSON.parse(fs.readFileSync(path, "utf8"));
catalog.reasons.push({
  code: "runtime.orientation_ok",
  description:
    "The runtime published orientation output without changing state.",
  status: "success",
  exitCode: 0,
  evidence: "optional",
  stateChanged: false,
  retryable: false,
  recovery: null,
});
fs.writeFileSync(
  "packages/contracts/catalogs/reason-codes.v1.3.json",
  JSON.stringify(catalog, null, 2) + "\n",
);
'
npx prettier --write packages/contracts/catalogs/reason-codes.v1.3.json
```

Then point every reader at the new revision:

- `packages/contracts/src/compatibility.ts` line 2: import
  `../catalogs/reason-codes.v1.3.json`.
- `scripts/build.mjs`: read `reason-codes.v1.3.json`.
- `scripts/lib/result-contract.mjs` in `rendererContract()`: read
  `reason-codes.v1.3.json`.
- `packages/contracts/catalogs/contract-families.v1.json`: `"reasonCatalog":
  "1.3.0"`.
- `tests/contract-manifest.test.ts` line 111: expect `reasonCatalog: "1.3.0"`.

- [x] **Step 4: Record the measured digest**

The revision tests pin file digests. Measure, do not guess:

```bash
sha256sum packages/contracts/catalogs/reason-codes.v1.3.json
```

Add to the new revision test, using the printed value:

```ts
expect(createHash("sha256").update(catalogV13Text).digest("hex")).toBe(
  "<paste the measured digest>",
);
```

- [x] **Step 5: Document the revision**

In `docs/compatibility/result-contract.md`, add `reason-codes.v1.3.json` to the
authoritative artifact list, mark it the current revision, demote the 1.2 entry
to a preserved predecessor, and add a paragraph after the revision 1.2
paragraph:

```markdown
Catalog revision 1.3 preserves those 83 entries byte-for-byte and adds
`runtime.orientation_ok`, reported when an operation publishes orientation
output such as usage text or a version identifier. No frozen reason described a
successful read-only operation: `trail.ok` requires evidence and represents a
committed mutation, so orientation output had no truthful reason to report.
```

Then extend `tests/contract-documentation.test.ts` beside its existing
assertions:

```ts
expect(guide).toContain("reason-codes.v1.3.json");
```

- [x] **Step 6: Run the full contract suite**

Run: `npx vitest run tests/contract-reason-catalog.test.ts tests/contract-manifest.test.ts tests/contract-documentation.test.ts tests/contract-compatibility.test.ts && npm run result:check && npm run contracts:check`
Expected: PASS for all.

- [x] **Step 7: Commit**

```bash
git add packages/contracts scripts docs tests
git commit -m "feat: add an orientation reason to the catalog

No frozen reason described a successful read-only operation. trail.ok requires
evidence and claims a mutation, so help, version, and the shipped handshake
payload had no truthful reason code. Revision 1.3 adds one additively.

Refs #17"
```

---

### Task 2: Expose the catalog and build results from it

**Files:**

- Create: `packages/contracts/src/reasons.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/runtime/src/domain/result/result.ts`
- Create: `packages/runtime/src/domain/result/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/result-envelope.test.ts`

**Interfaces:**

- Consumes: `runtime.orientation_ok` from Task 1.
- Produces: `reasonPolicy(code): ReasonPolicy | null`, `REASON_CATALOG`,
  `Result`, `EvidenceRef`, `resultFor(code, detail?)`, `usageFailure(why)`,
  `internalFailure()`, and the `USAGE_WHY` constants.

- [x] **Step 1: Write the failing test**

Create `tests/result-envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  internalFailure,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@mestre-yoda/runtime/domain/result";

describe("result envelope", () => {
  it("takes status, exit, retry, and recovery from the catalog", () => {
    expect(resultFor("trail.uso", { why: [USAGE_WHY.unknownCommand] })).toEqual({
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "trail.uso",
      summary: "The trail command arguments do not satisfy the operation usage contract.",
      why: [USAGE_WHY.unknownCommand],
      evidence: [],
      stateChanged: false,
      retryable: true,
      recovery:
        "Correct the command arguments according to the operation usage and invoke it again.",
    });
  });

  it("carries a caller summary without changing catalog policy", () => {
    const result = resultFor("runtime.orientation_ok", {
      summary: "Runtime version 0.0.0-development.",
    });

    expect(result.summary).toBe("Runtime version 0.0.0-development.");
    expect(result.exitCode).toBe(0);
    expect(result.recovery).toBeNull();
    expect(result.stateChanged).toBe(false);
  });

  it("refuses a reason the catalog does not define", () => {
    expect(() => resultFor("trail.invented", {})).toThrow(
      "Unknown reason code",
    );
  });

  it("fixes the public prose of an internal failure", () => {
    expect(internalFailure()).toMatchObject({
      reasonCode: "runtime.internal_failure",
      summary: "The operation stopped after an unexpected internal failure.",
      why: ["A sanitized runtime boundary caught an unexpected condition."],
      exitCode: 2,
    });
  });

  it("builds a usage failure that carries exactly one cause", () => {
    expect(usageFailure(USAGE_WHY.unknownFlag).why).toEqual([
      USAGE_WHY.unknownFlag,
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/result-envelope.test.ts`
Expected: FAIL, the module cannot be resolved.

- [x] **Step 3: Write the implementation**

`packages/contracts/src/reasons.ts`:

```ts
import reasonCatalog from "../catalogs/reason-codes.v1.3.json" with { type: "json" };

/** One catalog entry: the policy a result carrying this code must satisfy. */
export interface ReasonPolicy {
  readonly code: string;
  readonly description: string;
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly evidence: "required" | "optional" | "forbidden";
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

// The JSON import widens every literal to `string`, so the catalog is asserted
// once here. `tests/contract-reason-catalog.test.ts` is what proves the file
// actually satisfies this shape.
export const REASON_CATALOG = reasonCatalog.reasons as readonly ReasonPolicy[];

const byCode = new Map(REASON_CATALOG.map((reason) => [reason.code, reason]));

export function reasonPolicy(code: string): ReasonPolicy | null {
  return byCode.get(code) ?? null;
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export { REASON_CATALOG, reasonPolicy } from "./reasons.js";
export type { ReasonPolicy } from "./reasons.js";
```

`packages/runtime/src/domain/result/result.ts`:

```ts
import { reasonPolicy } from "@mestre-yoda/contracts";

export interface EvidenceRef {
  readonly kind: "artifact" | "event" | "approval" | "test" | "observation";
  readonly ref: string;
  readonly sha256?: string;
}

/** The universal result envelope, in canonical field order. */
export interface Result {
  readonly contractVersion: "1.0.0";
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly reasonCode: string;
  readonly summary: string;
  readonly why: readonly string[];
  readonly evidence: readonly EvidenceRef[];
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

export interface ResultDetail {
  readonly summary?: string;
  readonly why?: readonly string[];
  readonly evidence?: readonly EvidenceRef[];
  readonly stateChanged?: boolean;
}

/**
 * Build a result from its reason.
 *
 * Status, exit code, retry policy, and recovery come from the catalog rather
 * than the caller, so a result cannot contradict the reason it reports.
 */
export function resultFor(code: string, detail: ResultDetail = {}): Result {
  const policy = reasonPolicy(code);
  if (policy === null) {
    throw new Error("Unknown reason code");
  }
  return {
    contractVersion: "1.0.0",
    status: policy.status,
    exitCode: policy.exitCode,
    reasonCode: code,
    summary: detail.summary ?? policy.description,
    why: detail.why ?? [],
    evidence: detail.evidence ?? [],
    stateChanged: detail.stateChanged ?? false,
    retryable: policy.retryable,
    recovery: policy.recovery,
  };
}

/**
 * The complete set of usage causes.
 *
 * They are fixed strings because a cause must never carry a supplied argument:
 * that is how a version value or an absolute path would reach public output.
 */
export const USAGE_WHY = {
  unknownCommand: "The requested command is not registered in this runtime.",
  unknownFlag: "A supplied flag is not part of the command usage contract.",
  missingValue: "A flag that requires a value was supplied without one.",
  conflictingFlag: "A repeated global flag supplied conflicting values.",
  arity: "The number of positional arguments does not match the command usage.",
} as const;

export function usageFailure(why: string): Result {
  return resultFor("trail.uso", { why: [why] });
}

// The catalog owns this prose, and the verifier rejects any other wording for
// this reason, so an internal failure cannot leak a message it caught.
export function internalFailure(): Result {
  return resultFor("runtime.internal_failure", {
    summary: "The operation stopped after an unexpected internal failure.",
    why: ["A sanitized runtime boundary caught an unexpected condition."],
  });
}
```

`packages/runtime/src/domain/result/index.ts`:

```ts
export {
  internalFailure,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "./result.js";
export type { EvidenceRef, Result, ResultDetail } from "./result.js";
```

Add to the `exports` map in `packages/runtime/package.json`:

```json
"./domain/result": "./src/domain/result/index.ts"
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/result-envelope.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: build results from their catalog policy

A result takes status, exit, retry, and recovery from the reason it reports, so
the two cannot disagree. Usage causes are fixed strings, because a cause that
interpolated an argument would be the path a supplied value takes to stdout.

Refs #17"
```

---

### Task 3: Validate a result without Ajv

**Files:**

- Create: `packages/runtime/src/domain/result/validate.ts`
- Modify: `packages/runtime/src/domain/result/index.ts`
- Test: `tests/result-validation.test.ts`

**Interfaces:**

- Consumes: `Result`, `resultFor` from Task 2.
- Produces: `validateResult(result: Result): Result` and the exported error
  class `ResultContractError`.

- [x] **Step 1: Write the failing test**

Create `tests/result-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  resultFor,
  validateResult,
  type Result,
} from "@mestre-yoda/runtime/domain/result";

function withField(overrides: Partial<Result>): Result {
  return { ...resultFor("trail.uso", { why: ["cause"] }), ...overrides };
}

describe("result validation", () => {
  it("accepts a result that agrees with its reason", () => {
    const result = resultFor("trail.uso", { why: ["cause"] });

    expect(validateResult(result)).toEqual(result);
  });

  it.each([
    ["status", withField({ status: "success" })],
    ["exit code", withField({ exitCode: 0 })],
    ["retry policy", withField({ retryable: false })],
    ["recovery", withField({ recovery: "do something else" })],
  ])("rejects a result whose %s contradicts its reason", (_label, result) => {
    expect(() => validateResult(result)).toThrow("conflicts with its reason");
  });

  it("rejects a false state mutation claim", () => {
    expect(() => validateResult(withField({ stateChanged: true }))).toThrow(
      "false state mutation claim",
    );
  });

  it("rejects forbidden evidence", () => {
    expect(() =>
      validateResult(
        withField({ evidence: [{ kind: "event", ref: ".brain/events.jsonl" }] }),
      ),
    ).toThrow("forbidden evidence");
  });

  it("requires a cause for a failure", () => {
    expect(() => validateResult(withField({ why: [] }))).toThrow(
      "requires at least one cause",
    );
  });

  it("rejects duplicate causes", () => {
    expect(() => validateResult(withField({ why: ["a", "a"] }))).toThrow(
      "must be unique",
    );
  });

  it.each([
    ["an absolute path", "Failed reading /home/someone/project/file.json"],
    ["a URL", "See https://example.test/report for details"],
    ["a control character", "Broken\u0007summary"],
    ["a stack frame", "at handler (/app/index.js:10:5)"],
    ["a bearer token", "Authorization Bearer abcdefghijklmnopqrstuvwxyz"],
    ["a backslash", "C:\\Users\\someone"],
  ])("rejects %s in public text", (_label, summary) => {
    expect(() => validateResult(withField({ summary }))).toThrow(
      "unsafe text is not publishable",
    );
  });

  it("rejects fields outside the canonical order", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        status: "failure",
        contractVersion: "1.0.0",
        exitCode: 2,
        reasonCode: "trail.uso",
        summary: "s",
        why: ["cause"],
        evidence: [],
        stateChanged: false,
        retryable: true,
        recovery:
          "Correct the command arguments according to the operation usage and invoke it again.",
      }),
    ) as Result;

    expect(() => validateResult(reordered)).toThrow("canonical order");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/result-validation.test.ts`
Expected: FAIL, `validateResult` is not exported.

- [x] **Step 3: Write the implementation**

`packages/runtime/src/domain/result/validate.ts`. The unsafe patterns and the
canonical key list are the same rules `scripts/lib/result-contract.mjs` applies;
Task 5 proves the two agree.

```ts
import { reasonPolicy } from "@mestre-yoda/contracts";

import type { EvidenceRef, Result } from "./result.js";

export class ResultContractError extends Error {
  constructor(detail: string) {
    super(`Result contract validation failed: ${detail}`);
    this.name = "ResultContractError";
  }
}

const RESULT_KEYS = [
  "contractVersion",
  "status",
  "exitCode",
  "reasonCode",
  "summary",
  "why",
  "evidence",
  "stateChanged",
  "retryable",
  "recovery",
];

const unsafe = [
  /(?:^|\s)[A-Za-z]*Error:/u,
  /(?:^|\s)at\s+\S+\s*\([^)]*:\d+:\d+\)/u,
  /[a-z][a-z0-9+.-]*:\/\//iu,
  /(?:github_pat_|gh[pousr]_)/iu,
  /(?:token|secret|password)["']?\s*[:=]/iu,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]/iu,
  /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_[A-Z0-9_]+)\b["']?\s*[:=]/u,
  /\b(?:Basic|Bearer)\s+(?:[A-Za-z]{20,}|(?=\S*(?:\d|[-._~+/=]))\S+)/u,
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/u,
  /\bTraceback \(most recent call last\):/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /(?:^|[^A-Za-z0-9_.-])\/(?!\/)(?:[^\s/'")\]}]+\/)*[^\s/'")\]}]+/u,
  /(?:^|[^A-Za-z0-9_.-])[A-Za-z]:[\\/]/u,
  /\\/u,
];

function assertSafe(text: string): void {
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
  if (hasControlCharacter || unsafe.some((pattern) => pattern.test(text))) {
    throw new ResultContractError("unsafe text is not publishable");
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ResultContractError(`${label} must be unique`);
  }
}

function assertEvidence(evidence: readonly EvidenceRef[]): void {
  for (const item of evidence) {
    const expected =
      item.sha256 === undefined ? ["kind", "ref"] : ["kind", "ref", "sha256"];
    if (JSON.stringify(Object.keys(item)) !== JSON.stringify(expected)) {
      throw new ResultContractError(
        "evidence properties are not in canonical order",
      );
    }
    assertSafe(item.ref);
  }
  assertUnique(
    evidence.map((item) => JSON.stringify(item)),
    "evidence entries",
  );
}

/**
 * Prove a result may be published.
 *
 * Both renderers validate before writing anything, so a contradiction or unsafe
 * string is refused instead of being redacted after partial output.
 */
export function validateResult(result: Result): Result {
  if (JSON.stringify(Object.keys(result)) !== JSON.stringify(RESULT_KEYS)) {
    throw new ResultContractError("result properties are not in canonical order");
  }
  const policy = reasonPolicy(result.reasonCode);
  if (policy === null) {
    throw new ResultContractError("result uses an unknown reason code");
  }
  assertSafe(result.summary);
  for (const why of result.why) assertSafe(why);
  assertEvidence(result.evidence);
  for (const property of ["status", "exitCode", "retryable", "recovery"] as const) {
    if (result[property] !== policy[property]) {
      throw new ResultContractError(`result ${property} conflicts with its reason`);
    }
  }
  if (!policy.stateChanged && result.stateChanged) {
    throw new ResultContractError("result makes a false state mutation claim");
  }
  if (policy.evidence === "required" && result.evidence.length === 0) {
    throw new ResultContractError("required evidence is absent");
  }
  if (policy.evidence === "forbidden" && result.evidence.length !== 0) {
    throw new ResultContractError("forbidden evidence is present");
  }
  if (result.status !== "success" && result.why.length === 0) {
    throw new ResultContractError(
      "a failure or blocked result requires at least one cause",
    );
  }
  assertUnique(result.why, "why entries");
  return result;
}
```

Export both from `packages/runtime/src/domain/result/index.ts`:

```ts
export { ResultContractError, validateResult } from "./validate.js";
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/result-validation.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: validate a result before it can be published

The bundle cannot read a schema from disk, so the envelope, its agreement with
the catalog, and output safety are checked in the runtime. A contradiction is
refused before output rather than redacted after it.

Refs #17"
```

---

### Task 4: Render JSON and human output

**Files:**

- Create: `packages/runtime/src/domain/result/render.ts`
- Modify: `packages/runtime/src/domain/result/index.ts`
- Test: `tests/result-rendering.test.ts`

**Interfaces:**

- Consumes: `validateResult` from Task 3.
- Produces: `Rendered { stdout, stderr, exitCode }`, `renderResultJson(result)`,
  `renderResultHuman(result)`.

- [x] **Step 1: Write the failing test**

Create `tests/result-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  renderResultHuman,
  renderResultJson,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@mestre-yoda/runtime/domain/result";

describe("result rendering", () => {
  it("emits one compact newline-terminated object in JSON mode", () => {
    const result = resultFor("runtime.orientation_ok", {
      summary: "Runtime version 0.0.0-development.",
    });
    const rendered = renderResultJson(result);

    expect(rendered.stdout).toBe(`${JSON.stringify(result)}\n`);
    expect(rendered.stdout).not.toContain("\n  ");
    expect(rendered.stderr).toBe("");
    expect(rendered.exitCode).toBe(0);
  });

  it("emits only the summary on stdout for a human success", () => {
    expect(
      renderResultHuman(
        resultFor("runtime.orientation_ok", { summary: "All good." }),
      ),
    ).toEqual({ stdout: "All good.\n", stderr: "", exitCode: 0 });
  });

  it("emits labeled lines on stderr for a human failure", () => {
    const rendered = renderResultHuman(usageFailure(USAGE_WHY.unknownCommand));

    expect(rendered.stdout).toBe("");
    expect(rendered.exitCode).toBe(2);
    expect(rendered.stderr).toBe(
      [
        "Summary: The trail command arguments do not satisfy the operation usage contract.",
        `Why: ${USAGE_WHY.unknownCommand}`,
        "Reason: trail.uso",
        "State changed: false",
        "Retryable: true",
        "Recovery: Correct the command arguments according to the operation usage and invoke it again.",
      ].join("\n") + "\n",
    );
  });

  it("renders evidence references in order after the reason", () => {
    const rendered = renderResultHuman(
      resultFor("blocked.empty_plan", {
        why: ["cause"],
        evidence: [
          { kind: "event", ref: ".brain/events.jsonl" },
          { kind: "artifact", ref: ".brain/plan.json", sha256: "a".repeat(64) },
        ],
      }),
    );

    expect(rendered.stderr).toContain(
      "Evidence: event .brain/events.jsonl\nEvidence: artifact .brain/plan.json sha256=" +
        "a".repeat(64),
    );
  });

  it("refuses to render a result that fails validation", () => {
    expect(() =>
      renderResultJson({ ...usageFailure(USAGE_WHY.arity), why: [] }),
    ).toThrow("requires at least one cause");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/result-rendering.test.ts`
Expected: FAIL, the renderers are not exported.

- [x] **Step 3: Write the implementation**

`packages/runtime/src/domain/result/render.ts`:

```ts
import type { Result } from "./result.js";
import { validateResult } from "./validate.js";

export interface Rendered {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** One compact object per invocation, newline-terminated, nothing around it. */
export function renderResultJson(result: Result): Rendered {
  const validated = validateResult(result);
  return {
    stdout: `${JSON.stringify(validated)}\n`,
    stderr: "",
    exitCode: validated.exitCode,
  };
}

/**
 * Human output.
 *
 * A success prints its summary on stdout. A failure prints nothing on stdout
 * and writes labeled lines to stderr in contract order, so a caller piping
 * stdout never mixes a diagnostic into a successful payload.
 */
export function renderResultHuman(result: Result): Rendered {
  const validated = validateResult(result);
  if (validated.exitCode === 0) {
    return {
      stdout: `${validated.summary}\n`,
      stderr: "",
      exitCode: validated.exitCode,
    };
  }
  const lines = [
    `Summary: ${validated.summary}`,
    ...validated.why.map((why) => `Why: ${why}`),
    `Reason: ${validated.reasonCode}`,
    ...validated.evidence.map(
      (evidence) =>
        `Evidence: ${evidence.kind} ${evidence.ref}${
          evidence.sha256 === undefined ? "" : ` sha256=${evidence.sha256}`
        }`,
    ),
    `State changed: ${String(validated.stateChanged)}`,
    `Retryable: ${String(validated.retryable)}`,
    `Recovery: ${validated.recovery}`,
  ];
  return {
    stdout: "",
    stderr: `${lines.join("\n")}\n`,
    exitCode: validated.exitCode,
  };
}
```

Export from the barrel:

```ts
export { renderResultHuman, renderResultJson } from "./render.js";
export type { Rendered } from "./render.js";
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/result-rendering.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: render the result contract in both modes

Rendering returns text instead of writing, so the domain holds no stream and a
rendering test asserts strings rather than capturing process output.

Refs #17"
```

---

### Task 5: Prove the two renderers agree

**Files:**

- Create: `tests/result-renderer-equivalence.test.ts`

**Interfaces:**

- Consumes: `renderResultJson`, `renderResultHuman` from Task 4, and
  `canonicalResultJson`, `renderHumanResult` from
  `scripts/lib/result-contract.mjs`.

- [x] **Step 1: Write the failing test**

The verifier's renderer runs under Ajv and reads schemas from disk, so it is
loaded in a child process exactly the way `tests/contract-reason-catalog.test.ts`
already does it.

Create `tests/result-renderer-equivalence.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  renderResultHuman,
  renderResultJson,
  type Result,
} from "@mestre-yoda/runtime/domain/result";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const examplesPath = join(repositoryRoot, "fixtures/result-contract/v1");
const libraryUrl = pathToFileURL(
  join(repositoryRoot, "scripts/lib/result-contract.mjs"),
).href;

let examples: Result[];

beforeAll(async () => {
  const names = (await readdir(examplesPath))
    .filter((name) => name.endsWith(".json"))
    .sort();
  examples = await Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(join(examplesPath, name), "utf8")) as Result,
    ),
  );
});

function verifierRender(
  operation: "json" | "human",
  result: Result,
): { stdout: string; stderr: string; exitCode: number } {
  const source = `
    import { canonicalResultJson, renderHumanResult } from ${JSON.stringify(libraryUrl)};
    const result = JSON.parse(process.argv[1]);
    const operation = process.argv[2];
    const rendered =
      operation === "json"
        ? { stdout: canonicalResultJson(result), stderr: "", exitCode: result.exitCode }
        : renderHumanResult(result);
    process.stdout.write(JSON.stringify(rendered));
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      source,
      JSON.stringify(result),
      operation,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

describe("renderer equivalence", () => {
  it("covers every canonical fixture", () => {
    expect(examples).toHaveLength(6);
  });

  it("emits identical JSON bytes for every fixture", () => {
    for (const example of examples) {
      expect(renderResultJson(example), example.reasonCode).toEqual(
        verifierRender("json", example),
      );
    }
  });

  it("emits identical human bytes for every fixture", () => {
    for (const example of examples) {
      expect(renderResultHuman(example), example.reasonCode).toEqual(
        verifierRender("human", example),
      );
    }
  });

  it("agrees on generated permutations of cause and evidence order", () => {
    const base = examples.find(({ exitCode }) => exitCode === 3);
    expect(base).toBeDefined();
    const permutations: Result[] = [
      { ...(base as Result), why: ["first cause", "second cause"] },
      {
        ...(base as Result),
        evidence: [
          { kind: "approval", ref: ".brain/approvals.jsonl" },
          { kind: "event", ref: ".brain/events.jsonl", sha256: "b".repeat(64) },
        ],
      },
      { ...(base as Result), summary: "A single safe line." },
    ];

    for (const [index, permutation] of permutations.entries()) {
      expect(renderResultJson(permutation), `json ${index}`).toEqual(
        verifierRender("json", permutation),
      );
      expect(renderResultHuman(permutation), `human ${index}`).toEqual(
        verifierRender("human", permutation),
      );
    }
  });
});
```

- [x] **Step 2: Run it**

Run: `npx vitest run tests/result-renderer-equivalence.test.ts`
Expected: PASS. If it fails, the runtime renderer is wrong, not the verifier:
the verifier is the published contract check. Fix `render.ts` or `validate.ts`
until the bytes match.

- [x] **Step 3: Commit**

```bash
git add tests
git commit -m "test: require both renderers to emit identical bytes

Two implementations of one contract have two chances to disagree. The verifier
is the published check, so the runtime renderer is the one that must match it.

Refs #17"
```

---

### Task 6: Command specifications, registry, and generated help

**Files:**

- Create: `packages/runtime/src/domain/cli/spec.ts`
- Create: `packages/runtime/src/domain/cli/help.ts`
- Create: `packages/runtime/src/domain/cli/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/cli-help.test.ts`

**Interfaces:**

- Consumes: `Result` from Task 2, `EffectPlan` from
  `packages/runtime/src/domain/effects.ts`.
- Produces: `FlagSpec`, `CommandSpec`, `CommandRegistry`, `Globals`,
  `Invocation`, `Decision`, `GLOBAL_FLAGS`, `renderHelp(registry)`,
  `usageLine(spec)`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-help.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  renderHelp,
  usageLine,
  type CommandRegistry,
  type CommandSpec,
} from "@mestre-yoda/runtime/domain/cli";
import { resultFor } from "@mestre-yoda/runtime/domain/result";
import { planOf } from "@mestre-yoda/runtime/domain/effects";

const stub: CommandSpec = {
  path: ["ac", "check"],
  summary: "Check every stored acceptance criterion.",
  flags: [
    {
      name: "--root",
      kind: "value",
      valueLabel: "<path>",
      summary: "Operate on the project rooted at this path.",
    },
  ],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  handler: () => ({
    result: resultFor("runtime.orientation_ok"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  }),
};

const registry: CommandRegistry = [stub];

describe("generated help", () => {
  it("builds a usage line from the specification", () => {
    expect(usageLine(stub)).toBe("yoda ac check [--root <path>]");
  });

  it("lists commands and their flags", () => {
    const help = renderHelp(registry);

    expect(help).toContain("  ac check");
    expect(help).toContain("Check every stored acceptance criterion.");
    expect(help).toContain("      --root <path>");
  });

  it("lists every global flag", () => {
    const help = renderHelp(registry);

    expect(help).toContain("--expect <version>");
    expect(help).toContain("--json");
  });

  it("orders commands deterministically", () => {
    const other: CommandSpec = { ...stub, path: ["ab"], flags: [] };

    expect(renderHelp([stub, other])).toBe(renderHelp([other, stub]));
    expect(renderHelp([stub, other]).indexOf("ab")).toBeLessThan(
      renderHelp([stub, other]).indexOf("ac check"),
    );
  });

  it("changes when the registry changes", () => {
    // A snapshot that passes for any registry proves nothing, so the help must
    // be observably a function of its input.
    const extra: CommandSpec = { ...stub, path: ["zz"], flags: [] };

    expect(renderHelp([stub, extra])).not.toBe(renderHelp(registry));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-help.test.ts`
Expected: FAIL, the module cannot be resolved.

- [x] **Step 3: Write the implementation**

`packages/runtime/src/domain/cli/spec.ts`:

```ts
import type { EffectPlan } from "../effects.js";
import type { Result } from "../result/index.js";

export interface FlagSpec {
  readonly name: string;
  readonly kind: "boolean" | "value";
  readonly valueLabel?: string;
  readonly summary: string;
}

/** The JSON schema a command's successful output satisfies. */
export type JsonContractId = "result@1.0.0" | "adapter-message@1.0.0";

/**
 * What a command decided.
 *
 * `humanStdout` is text the command owns on stdout; `null` means the renderer
 * prints the result summary instead. `payload` is the object emitted in JSON
 * mode by a command declaring a contract other than the result envelope.
 */
export interface Decision {
  readonly result: Result;
  readonly plan: EffectPlan;
  readonly humanStdout: string | null;
  readonly payload: unknown;
}

export interface Globals {
  readonly json: boolean;
  readonly expect: string | null;
  readonly orientation: "help" | "version" | null;
}

export interface Invocation {
  readonly command: CommandSpec;
  readonly globals: Globals;
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
  readonly registry: CommandRegistry;
}

export type CommandHandler = (invocation: Invocation) => Decision;

export interface CommandSpec {
  readonly path: readonly string[];
  readonly summary: string;
  readonly flags: readonly FlagSpec[];
  readonly positionals: { readonly min: number; readonly max: number };
  readonly jsonContract: JsonContractId;
  readonly handler: CommandHandler;
}

export type CommandRegistry = readonly CommandSpec[];

/**
 * Flags accepted before any command.
 *
 * They live here so the parser and the help text read the same table. A flag
 * described in only one of the two is how a surface starts drifting.
 */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  {
    name: "--expect",
    kind: "value",
    valueLabel: "<version>",
    summary: "Act only when the plugin version matches exactly.",
  },
  {
    name: "--json",
    kind: "boolean",
    summary: "Emit one machine-readable object instead of human text.",
  },
];
```

`packages/runtime/src/domain/cli/help.ts`:

```ts
import { GLOBAL_FLAGS, type CommandRegistry, type CommandSpec, type FlagSpec } from "./spec.js";

function label(flag: FlagSpec): string {
  return flag.valueLabel === undefined
    ? flag.name
    : `${flag.name} ${flag.valueLabel}`;
}

function sortedFlags(flags: readonly FlagSpec[]): readonly FlagSpec[] {
  return [...flags].sort((left, right) => left.name.localeCompare(right.name));
}

function sortedCommands(registry: CommandRegistry): readonly CommandSpec[] {
  return [...registry].sort((left, right) =>
    left.path.join(" ").localeCompare(right.path.join(" ")),
  );
}

/** The exact invocation form of one command. */
export function usageLine(spec: CommandSpec): string {
  const flags = sortedFlags(spec.flags).map((flag) => `[${label(flag)}]`);
  return ["yoda", ...spec.path, ...flags].join(" ");
}

function pad(text: string, width: number): string {
  return text.padEnd(width, " ");
}

/**
 * The complete usage text, generated from the registry.
 *
 * Help is a function of the same table the parser reads, so a flag appears here
 * because it exists rather than because someone remembered to document it.
 */
export function renderHelp(registry: CommandRegistry): string {
  const commands = sortedCommands(registry);
  const width = Math.max(
    12,
    ...commands.map((spec) => spec.path.join(" ").length + 2),
  );
  const lines = [
    "Usage: yoda [--expect <version>] [--json] <command>",
    "",
    "Commands:",
  ];
  for (const spec of commands) {
    lines.push(`  ${pad(spec.path.join(" "), width)}${spec.summary}`);
    for (const flag of sortedFlags(spec.flags)) {
      lines.push(`      ${pad(label(flag), width - 4)}${flag.summary}`);
    }
  }
  lines.push("", "Global flags:");
  for (const flag of sortedFlags(GLOBAL_FLAGS)) {
    lines.push(`  ${pad(label(flag), width)}${flag.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
```

`packages/runtime/src/domain/cli/index.ts`:

```ts
export { GLOBAL_FLAGS } from "./spec.js";
export type {
  CommandHandler,
  CommandRegistry,
  CommandSpec,
  Decision,
  FlagSpec,
  Globals,
  Invocation,
  JsonContractId,
} from "./spec.js";
export { renderHelp, usageLine } from "./help.js";
```

Add to the `exports` map in `packages/runtime/package.json`:

```json
"./domain/cli": "./src/domain/cli/index.ts"
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-help.test.ts && npm run typecheck`
Expected: PASS. Adjust the expected column padding in the test to the generator
if the two disagree, then keep the generator fixed.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: generate help from the command table

Usage text, flag validation, and help all read one table, so they cannot
describe different surfaces.

Refs #17"
```

---

### Task 7: Parse global flags

**Files:**

- Create: `packages/runtime/src/domain/cli/parse.ts`
- Modify: `packages/runtime/src/domain/cli/index.ts`
- Test: `tests/cli-globals.test.ts`

**Interfaces:**

- Consumes: `Globals`, `GLOBAL_FLAGS` from Task 6, `usageFailure`, `USAGE_WHY`
  from Task 2.
- Produces: `parseGlobals(argv): GlobalParse` with
  `{ globals, rest, failure }`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-globals.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { GLOBAL_FLAGS, parseGlobals } from "@mestre-yoda/runtime/domain/cli";
import { USAGE_WHY } from "@mestre-yoda/runtime/domain/result";

describe("global flag parsing", () => {
  it("extracts --expect from any position", () => {
    for (const argv of [
      ["--expect", "1.2.3", "version"],
      ["version", "--expect", "1.2.3"],
    ]) {
      const parsed = parseGlobals(argv);

      expect(parsed.failure).toBeNull();
      expect(parsed.globals.expect).toBe("1.2.3");
      expect(parsed.rest).toEqual(["version"]);
    }
  });

  it("extracts --json from any position", () => {
    expect(parseGlobals(["handshake", "--json"]).globals.json).toBe(true);
    expect(parseGlobals(["--json", "handshake"]).globals.json).toBe(true);
    expect(parseGlobals(["handshake"]).globals.json).toBe(false);
  });

  it.each([["--help"], ["-h"]])("normalizes %s into the help command", (flag) => {
    expect(parseGlobals([flag]).globals.orientation).toBe("help");
  });

  it("normalizes --version into the version command", () => {
    expect(parseGlobals(["--version"]).globals.orientation).toBe("version");
  });

  it("refuses --expect without a value", () => {
    expect(parseGlobals(["--expect"]).failure?.why).toEqual([
      USAGE_WHY.missingValue,
    ]);
    expect(parseGlobals(["--expect", "--json"]).failure?.why).toEqual([
      USAGE_WHY.missingValue,
    ]);
  });

  it("accepts an identical repeat and refuses a conflicting one", () => {
    expect(parseGlobals(["--expect", "1.2.3", "--expect", "1.2.3"]).failure).toBeNull();
    expect(
      parseGlobals(["--expect", "1.2.3", "--expect", "9.9.9"]).failure?.why,
    ).toEqual([USAGE_WHY.conflictingFlag]);
  });

  it("recognizes every flag the help text advertises", () => {
    for (const flag of GLOBAL_FLAGS) {
      const argv =
        flag.kind === "value" ? [flag.name, "1.2.3"] : [flag.name];

      expect(parseGlobals(argv).rest, flag.name).toEqual([]);
    }
  });

  it("leaves an unknown flag for the command parser", () => {
    expect(parseGlobals(["version", "--unknown"]).rest).toEqual([
      "version",
      "--unknown",
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-globals.test.ts`
Expected: FAIL, `parseGlobals` is not exported.

- [x] **Step 3: Write the implementation**

Create `packages/runtime/src/domain/cli/parse.ts`:

```ts
import { USAGE_WHY, usageFailure, type Result } from "../result/index.js";

import type { Globals } from "./spec.js";

export interface GlobalParse {
  readonly globals: Globals;
  readonly rest: readonly string[];
  readonly failure: Result | null;
}

function failed(why: string): GlobalParse {
  return {
    globals: { json: false, expect: null, orientation: null },
    rest: [],
    failure: usageFailure(why),
  };
}

/**
 * Pull the flags that apply before any command out of the argument vector.
 *
 * Position does not matter: the inventory requires the compatibility check to
 * apply regardless of argument order, and honoring `--expect` only in first
 * position is how a drifted install slips past it.
 */
export function parseGlobals(argv: readonly string[]): GlobalParse {
  const rest: string[] = [];
  let json = false;
  let expect: string | null = null;
  let orientation: Globals["orientation"] = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      json = true;
    } else if (token === "--help" || token === "-h") {
      orientation = "help";
    } else if (token === "--version") {
      // Help wins when both are supplied, because usage text is the safer of
      // the two answers to an ambiguous request.
      orientation ??= "version";
    } else if (token === "--expect") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return failed(USAGE_WHY.missingValue);
      }
      if (expect !== null && expect !== value) {
        return failed(USAGE_WHY.conflictingFlag);
      }
      expect = value;
      index += 1;
    } else if (token !== undefined) {
      rest.push(token);
    }
  }

  return { globals: { json, expect, orientation }, rest, failure: null };
}
```

Export it from `packages/runtime/src/domain/cli/index.ts`:

```ts
export { parseGlobals } from "./parse.js";
export type { GlobalParse } from "./parse.js";
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-globals.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: parse global flags at any position

CLI-GLOBAL-EXPECT requires the compatibility check to apply regardless of
argument order. Honoring --expect only in first position is how a drifted
install walks past its own guard.

Refs #17"
```

---

### Task 8: Resolve commands and parse their arguments

**Files:**

- Modify: `packages/runtime/src/domain/cli/parse.ts`
- Modify: `packages/runtime/src/domain/cli/index.ts`
- Test: `tests/cli-parsing.test.ts`

**Interfaces:**

- Consumes: `parseGlobals` from Task 7, `CommandSpec`, `CommandRegistry` from
  Task 6.
- Produces: `resolveCommand(tokens, registry): Resolution | null`,
  `parseArguments(spec, tokens): ArgumentParse`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-parsing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  parseArguments,
  resolveCommand,
  type CommandRegistry,
  type CommandSpec,
} from "@mestre-yoda/runtime/domain/cli";
import { resultFor, USAGE_WHY } from "@mestre-yoda/runtime/domain/result";
import { planOf } from "@mestre-yoda/runtime/domain/effects";

function spec(overrides: Partial<CommandSpec>): CommandSpec {
  return {
    path: ["ac", "check"],
    summary: "Check every stored acceptance criterion.",
    flags: [
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
      { name: "--force", kind: "boolean", summary: "Overwrite existing rules." },
    ],
    positionals: { min: 0, max: 1 },
    jsonContract: "result@1.0.0",
    handler: () => ({
      result: resultFor("runtime.orientation_ok"),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    }),
    ...overrides,
  };
}

const registry: CommandRegistry = [spec({}), spec({ path: ["ac"] })];

describe("command resolution", () => {
  it("resolves the separated spelling", () => {
    expect(resolveCommand(["ac", "check", "x"], registry)?.command.path).toEqual([
      "ac",
      "check",
    ]);
  });

  it("resolves the dotted spelling to the same command", () => {
    expect(resolveCommand(["ac.check"], registry)?.command.path).toEqual([
      "ac",
      "check",
    ]);
  });

  it("prefers the longest matching path", () => {
    expect(resolveCommand(["ac"], registry)?.command.path).toEqual(["ac"]);
    expect(resolveCommand(["ac", "check"], registry)?.rest).toEqual([]);
  });

  it("returns nothing for an unregistered name", () => {
    expect(resolveCommand(["start"], registry)).toBeNull();
  });
});

describe("argument parsing", () => {
  it("reads a value flag and a boolean flag", () => {
    const parsed = parseArguments(spec({}), ["--root", ".", "--force"]);

    expect(parsed.failure).toBeNull();
    expect(parsed.flags.get("--root")).toBe(".");
    expect(parsed.flags.get("--force")).toBe(true);
  });

  it("collects positionals", () => {
    expect(parseArguments(spec({}), ["target"]).positionals).toEqual(["target"]);
  });

  it.each([
    [["--unknown"], USAGE_WHY.unknownFlag],
    [["-x"], USAGE_WHY.unknownFlag],
    [["--root"], USAGE_WHY.missingValue],
    [["--root", "--force"], USAGE_WHY.missingValue],
    [["one", "two"], USAGE_WHY.arity],
  ])("refuses %o", (tokens, why) => {
    expect(parseArguments(spec({}), tokens).failure?.why).toEqual([why]);
  });

  it("requires the minimum number of positionals", () => {
    expect(
      parseArguments(spec({ positionals: { min: 1, max: 1 } }), []).failure?.why,
    ).toEqual([USAGE_WHY.arity]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-parsing.test.ts`
Expected: FAIL, the functions are not exported.

- [x] **Step 3: Write the implementation**

Append to `packages/runtime/src/domain/cli/parse.ts`:

```ts
import type { CommandRegistry, CommandSpec } from "./spec.js";

export interface Resolution {
  readonly command: CommandSpec;
  readonly rest: readonly string[];
}

export interface ArgumentParse {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
  readonly failure: Result | null;
}

function match(
  tokens: readonly string[],
  registry: CommandRegistry,
): Resolution | null {
  const depths = registry.map((spec) => spec.path.length);
  for (let depth = Math.max(0, ...depths); depth >= 1; depth -= 1) {
    const candidate = tokens.slice(0, depth).join(" ");
    const command = registry.find(
      (spec) => spec.path.join(" ") === candidate,
    );
    if (command !== undefined) {
      return { command, rest: tokens.slice(depth) };
    }
  }
  return null;
}

/**
 * Find the command a token sequence names.
 *
 * The dotted spelling is tried only after the separated one fails, so a
 * positional that happens to contain a dot cannot be mistaken for a nested
 * command path.
 */
export function resolveCommand(
  tokens: readonly string[],
  registry: CommandRegistry,
): Resolution | null {
  const direct = match(tokens, registry);
  if (direct !== null) return direct;
  const first = tokens[0];
  if (first === undefined || !first.includes(".")) return null;
  return match([...first.split("."), ...tokens.slice(1)], registry);
}

function argumentFailure(why: string): ArgumentParse {
  return { flags: new Map(), positionals: [], failure: usageFailure(why) };
}

/** Apply one command's declared flags and arity to its remaining tokens. */
export function parseArguments(
  spec: CommandSpec,
  tokens: readonly string[],
): ArgumentParse {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (!token.startsWith("-") || token.length === 1) {
      positionals.push(token);
      continue;
    }
    const flag = spec.flags.find(({ name }) => name === token);
    if (flag === undefined) return argumentFailure(USAGE_WHY.unknownFlag);
    if (flag.kind === "boolean") {
      flags.set(flag.name, true);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("-")) {
      return argumentFailure(USAGE_WHY.missingValue);
    }
    flags.set(flag.name, value);
    index += 1;
  }

  if (
    positionals.length < spec.positionals.min ||
    positionals.length > spec.positionals.max
  ) {
    return argumentFailure(USAGE_WHY.arity);
  }
  return { flags, positionals, failure: null };
}
```

Export both from `packages/runtime/src/domain/cli/index.ts`:

```ts
export { parseArguments, resolveCommand } from "./parse.js";
export type { ArgumentParse, Resolution } from "./parse.js";
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-parsing.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: resolve commands and parse declared arguments

One parser reads every command's declared flags and arity, so no command can
invent its own idea of what an unknown flag or a missing value means.

Refs #17"
```

---

### Task 9: The implemented commands and the full pipeline

**Files:**

- Create: `packages/runtime/src/domain/cli/commands.ts`
- Create: `packages/runtime/src/domain/cli/dispatch.ts`
- Modify: `packages/runtime/src/domain/cli/index.ts`
- Modify: `packages/runtime/src/handshake.ts`
- Test: `tests/cli-commands.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 6, 7, and 8.
- Produces: `DEFAULT_REGISTRY`, `parseInvocation(argv, registry): ParseOutcome`,
  `dispatch(invocation): Decision`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-commands.test.ts`:

```ts
import { YODA_VERSION } from "@mestre-yoda/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
} from "@mestre-yoda/runtime/domain/cli";
import { USAGE_WHY } from "@mestre-yoda/runtime/domain/result";

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  return parsed.kind === "result"
    ? { failure: parsed.result, decision: null }
    : { failure: null, decision: dispatch(parsed.invocation) };
}

describe("implemented commands", () => {
  it("registers exactly the commands that work today", () => {
    expect(DEFAULT_REGISTRY.map((spec) => spec.path.join(" ")).sort()).toEqual([
      "handshake",
      "help",
      "version",
    ]);
  });

  it("prints usage for an empty argument vector", () => {
    expect(invoke([]).decision?.humanStdout).toContain("Usage: yoda");
  });

  it.each([["--help"], ["-h"], ["help"]])("answers %s with usage", (token) => {
    expect(invoke([token]).decision?.humanStdout).toContain("Commands:");
  });

  it.each([["--version"], ["version"]])(
    "answers %s with exactly the version",
    (token) => {
      expect(invoke([token]).decision?.humanStdout).toBe(`${YODA_VERSION}\n`);
    },
  );

  it("carries the version in the summary for JSON mode", () => {
    expect(invoke(["--version"]).decision?.result.summary).toContain(
      YODA_VERSION,
    );
  });

  it("answers the handshake with an adapter message", () => {
    const decision = invoke(["handshake"]).decision;

    expect(decision?.payload).toMatchObject({
      messageType: "response",
      operation: "handshake",
    });
    expect(JSON.parse(decision?.humanStdout ?? "")).toEqual(decision?.payload);
  });

  it("refuses an unregistered command", () => {
    expect(invoke(["start"]).failure?.why).toEqual([USAGE_WHY.unknownCommand]);
  });

  it("checks a pinned version before resolving the command", () => {
    // A drifted install must not have its arguments interpreted at all.
    expect(invoke(["--expect", "9.9.9", "start"]).failure?.reasonCode).toBe(
      "contract.plugin_version_unsupported",
    );
  });

  it("continues past a matching pin", () => {
    expect(invoke(["--expect", YODA_VERSION, "version"]).failure).toBeNull();
  });

  it("keeps help available with a matching pin", () => {
    expect(
      invoke(["--expect", YODA_VERSION, "--help"]).decision?.humanStdout,
    ).toContain("Usage: yoda");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-commands.test.ts`
Expected: FAIL, the module cannot be resolved.

- [x] **Step 3: Update the handshake to a truthful reason**

In `packages/runtime/src/handshake.ts`, change the payload's `reasonCode` from
`"trail.ok"` to `"runtime.orientation_ok"`. The published payload claimed a
reason whose policy requires evidence and represents a mutation, and it carried
neither.

- [x] **Step 4: Write the commands**

`packages/runtime/src/domain/cli/commands.ts`:

```ts
import { YODA_VERSION } from "@mestre-yoda/contracts";

import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";
import { buildHandshakeResponse } from "../../handshake.js";
import { renderHelp } from "./help.js";
import type { CommandRegistry, CommandSpec, Decision, Invocation } from "./spec.js";

function orientation(summary: string, humanStdout: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout,
    payload: null,
  };
}

const helpCommand: CommandSpec = {
  path: ["help"],
  summary: "Print the command usage text.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  handler: (invocation: Invocation): Decision =>
    orientation(
      "The runtime published its command usage text.",
      renderHelp(invocation.registry),
    ),
};

const versionCommand: CommandSpec = {
  path: ["version"],
  summary: "Print the runtime version.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  // The frozen contract is exactly the version and a newline, with nothing else
  // on stdout, so the human form is the bare identifier.
  handler: (): Decision =>
    orientation(`Runtime version ${YODA_VERSION}.`, `${YODA_VERSION}\n`),
};

const handshakeCommand: CommandSpec = {
  path: ["handshake"],
  summary: "Report the contract versions this runtime carries.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "adapter-message@1.0.0",
  handler: (): Decision => {
    const message = buildHandshakeResponse("cli");
    return {
      result: resultFor("runtime.orientation_ok", {
        // If the generated `AdapterMessageV1` type does not expose `payload`
        // as a result envelope, use the literal summary
        // "The runtime reported the contract versions it carries." rather than
        // casting the payload to reach a field the type does not promise.
        summary: message.payload.summary,
      }),
      plan: planOf(),
      // A machine operation has no human form, so the message is what both
      // modes print. ADP-01 owns the adapter protocol and may revisit this.
      humanStdout: `${JSON.stringify(message)}\n`,
      payload: message,
    };
  },
};

export const DEFAULT_REGISTRY: CommandRegistry = [
  handshakeCommand,
  helpCommand,
  versionCommand,
];
```

Note: `packages/runtime/src/handshake.ts` sits outside `domain`, so importing it
from `domain/cli/commands.ts` would break the layer rule. Move
`buildHandshakeResponse` and `classifyExpectedVersion` into
`packages/runtime/src/domain/handshake.ts`, and leave
`packages/runtime/src/handshake.ts` re-exporting them so
`@mestre-yoda/runtime/handshake` and `tests/runtime-handshake.test.ts` keep
working:

```ts
export {
  buildHandshakeResponse,
  classifyExpectedVersion,
} from "./domain/handshake.js";
```

Then import from `../handshake.js` (the domain copy) in `commands.ts` and
`parse.ts`.

- [x] **Step 5: Write the pipeline entry and dispatch**

Append to `packages/runtime/src/domain/cli/parse.ts`:

```ts
import { classifyExpectedVersion } from "../handshake.js";

import type { Invocation } from "./spec.js";

export type ParseOutcome =
  | { readonly kind: "invocation"; readonly invocation: Invocation }
  | { readonly kind: "result"; readonly result: Result; readonly json: boolean };

/**
 * Turn an argument vector into either an invocation or the result that ends the
 * run.
 *
 * The compatibility check runs before the command is resolved, so a drifted
 * install never has its arguments interpreted by a runtime that must not act.
 */
export function parseInvocation(
  argv: readonly string[],
  registry: CommandRegistry,
): ParseOutcome {
  const parsed = parseGlobals(argv);
  if (parsed.failure !== null) {
    return { kind: "result", result: parsed.failure, json: parsed.globals.json };
  }
  if (parsed.globals.expect !== null) {
    const drift = classifyExpectedVersion(parsed.globals.expect);
    if (drift !== null) {
      return { kind: "result", result: drift, json: parsed.globals.json };
    }
  }
  const tokens =
    parsed.globals.orientation !== null
      ? [parsed.globals.orientation]
      : parsed.rest.length === 0
        ? ["help"]
        : parsed.rest;
  const resolved = resolveCommand(tokens, registry);
  if (resolved === null) {
    return {
      kind: "result",
      result: usageFailure(USAGE_WHY.unknownCommand),
      json: parsed.globals.json,
    };
  }
  const args = parseArguments(resolved.command, resolved.rest);
  if (args.failure !== null) {
    return { kind: "result", result: args.failure, json: parsed.globals.json };
  }
  return {
    kind: "invocation",
    invocation: {
      command: resolved.command,
      globals: parsed.globals,
      flags: args.flags,
      positionals: args.positionals,
      registry,
    },
  };
}
```

`packages/runtime/src/domain/cli/dispatch.ts`:

```ts
import type { Decision, Invocation } from "./spec.js";

/** Invoke the resolved command. Handlers are pure and perform no effect. */
export function dispatch(invocation: Invocation): Decision {
  return invocation.command.handler(invocation);
}
```

Export `DEFAULT_REGISTRY`, `dispatch`, `parseInvocation`, and `ParseOutcome`
from `packages/runtime/src/domain/cli/index.ts`.

- [x] **Step 6: Run the tests**

Run: `npx vitest run tests/cli-commands.test.ts tests/runtime-handshake.test.ts && npm run typecheck && npx vitest run tests/architecture.test.ts`
Expected: PASS. The architecture test is included because this task moves a
module between layers.

- [x] **Step 7: Commit**

```bash
git add packages tests
git commit -m "feat: register the commands that work and route to them

The compatibility check runs before command resolution, so a drifted install
never gets its arguments interpreted. The handshake payload moves to the
orientation reason: it claimed trail.ok, whose policy requires evidence and
represents a mutation, and carried neither.

Refs #17"
```

---

### Task 10: Compose the pipeline and replace the entry point

**Files:**

- Create: `packages/runtime/src/composition/cli.ts`
- Modify: `packages/runtime/src/cli.ts`
- Modify: `packages/runtime/src/main.ts`
- Modify: `packages/runtime/src/cli.test.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/cli-composition.test.ts`

**Interfaces:**

- Consumes: `parseInvocation`, `dispatch`, `DEFAULT_REGISTRY` from Task 9,
  `renderResultJson`, `renderResultHuman` from Task 4, `applyPlan`,
  `createRuntime` from `composition/index.ts`.
- Produces: `runCommandLine(argv, ports, registry?): Promise<number>`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-composition.test.ts`:

```ts
import { YODA_VERSION } from "@mestre-yoda/contracts";
import { recordingOutput } from "@mestre-yoda/runtime/infra/fake";
import { runCommandLine } from "@mestre-yoda/runtime/composition/cli";
import { describe, expect, it } from "vitest";

import { createRuntime } from "@mestre-yoda/runtime/composition";

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));

  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

describe("composed command line", () => {
  it("prints usage on stdout with an empty stderr", async () => {
    const result = await run(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: yoda");
    expect(result.stderr).toBe("");
  });

  it("prints exactly the version", async () => {
    expect(await run(["version"])).toEqual({
      exitCode: 0,
      stdout: `${YODA_VERSION}\n`,
      stderr: "",
    });
  });

  it("emits one result envelope in JSON mode", async () => {
    const result = await run(["--json", "version"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "runtime.orientation_ok",
    });
    expect(result.stdout.trimEnd()).not.toContain("\n");
  });

  it("emits the declared adapter message for the handshake", async () => {
    expect(JSON.parse((await run(["--json", "handshake"])).stdout)).toMatchObject(
      { operation: "handshake", payloadContract: "result@1.0.0" },
    );
  });

  it("writes a human failure to stderr and nothing to stdout", async () => {
    const result = await run(["start"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Reason: trail.uso");
  });

  it("writes a JSON failure to stdout as one envelope", async () => {
    const result = await run(["--json", "start"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).reasonCode).toBe("trail.uso");
  });

  it("renders an unexpected failure as a sanitized internal failure", async () => {
    const output = recordingOutput();
    const exploding = [
      {
        path: ["boom"],
        summary: "Throw on purpose.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        handler: () => {
          throw new Error("/home/someone/secret-token");
        },
      },
    ];
    const exitCode = await runCommandLine(
      ["boom"],
      createRuntime({ output }),
      exploding,
    );

    expect(exitCode).toBe(2);
    expect(output.human_.join("")).toContain("Reason: runtime.internal_failure");
    expect(output.human_.join("")).not.toContain("secret-token");
    expect(output.structured_.join("")).toBe("");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-composition.test.ts`
Expected: FAIL, `@mestre-yoda/runtime/composition/cli` does not resolve.

- [x] **Step 3: Write the implementation**

`packages/runtime/src/composition/cli.ts`:

```ts
import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  type CommandRegistry,
} from "../domain/cli/index.js";
import {
  internalFailure,
  renderResultHuman,
  renderResultJson,
  type Result,
} from "../domain/result/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { applyPlan } from "./index.js";

function write(text: string, stream: "stdout" | "stderr", ports: RuntimePorts): void {
  if (text.length === 0) return;
  // The port names its methods by stream, not by audience: `structured` is
  // stdout and `human` is stderr.
  if (stream === "stdout") ports.output.structured(text);
  else ports.output.human(text);
}

function publish(result: Result, json: boolean, ports: RuntimePorts): number {
  const rendered = json ? renderResultJson(result) : renderResultHuman(result);
  write(rendered.stdout, "stdout", ports);
  write(rendered.stderr, "stderr", ports);
  return rendered.exitCode;
}

/**
 * Run one command line to completion.
 *
 * Parsing produces either an invocation or the result that ends the run, so a
 * usage failure is produced before any effect could be applied. That is what
 * makes "no state change on a usage error" structural.
 */
export async function runCommandLine(
  argv: readonly string[],
  ports: RuntimePorts,
  registry: CommandRegistry = DEFAULT_REGISTRY,
): Promise<number> {
  // Read once, directly, for the failure path below: the error handler must not
  // depend on the parser that may be what failed.
  const json = argv.includes("--json");
  try {
    const parsed = parseInvocation(argv, registry);
    if (parsed.kind === "result") {
      return publish(parsed.result, parsed.json, ports);
    }
    const decision = dispatch(parsed.invocation);
    await applyPlan(decision.plan, ports);
    if (decision.result.exitCode !== 0) {
      return publish(decision.result, json, ports);
    }
    if (json && parsed.invocation.command.jsonContract === "result@1.0.0") {
      return publish(decision.result, true, ports);
    }
    if (json) {
      write(`${JSON.stringify(decision.payload)}\n`, "stdout", ports);
      return decision.result.exitCode;
    }
    write(
      decision.humanStdout ?? `${decision.result.summary}\n`,
      "stdout",
      ports,
    );
    return decision.result.exitCode;
  } catch {
    // Nothing from the caught value reaches output: the catalog owns the public
    // prose for this reason precisely so a message cannot leak through it.
    return publish(internalFailure(), json, ports);
  }
}
```

Replace `packages/runtime/src/cli.ts` entirely:

```ts
import { runCommandLine } from "./composition/cli.js";
import { createRuntime } from "./composition/index.js";

/** Process entry: compose the real ports and run one command line. */
export async function runCli(argv: readonly string[]): Promise<number> {
  return runCommandLine(argv, createRuntime());
}
```

Replace `packages/runtime/src/main.ts`:

```ts
import { runCli } from "./cli.js";

process.exitCode = await runCli(process.argv.slice(2));
```

Delete `packages/runtime/src/cli.test.ts`: every case it covers now lives in
`tests/cli-commands.test.ts` and `tests/cli-composition.test.ts`, and keeping a
second copy invites the two to drift.

Add to the `exports` map in `packages/runtime/package.json`:

```json
"./composition/cli": "./src/composition/cli.ts"
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/cli-composition.test.ts tests/architecture.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages tests
git commit -m "feat: compose the routing pipeline behind one entry point

The composition root is the only code that applies effects or writes to a
stream. An unexpected throw renders as a sanitized internal failure, and the
JSON mode flag for that path is read straight from argv so the error handler
does not depend on the parser that failed.

Refs #17"
```

---

### Task 11: Cross-cutting proofs

**Files:**

- Create: `tests/cli-contracts.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_REGISTRY`, `runCommandLine`, the schema files under
  `schemas/`.

- [x] **Step 1: Write the failing test**

Create `tests/cli-contracts.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { recordingOutput } from "@mestre-yoda/runtime/infra/fake";
import { runCommandLine } from "@mestre-yoda/runtime/composition/cli";
import { createRuntime, applyPlan } from "@mestre-yoda/runtime/composition";
import { DEFAULT_REGISTRY } from "@mestre-yoda/runtime/domain/cli";
import { memoryFileSystem } from "@mestre-yoda/runtime/infra/fake";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaPaths = new Map([
  ["result@1.0.0", "schemas/result.v1.schema.json"],
  ["adapter-message@1.0.0", "schemas/host/adapter-message.v1.schema.json"],
]);

const validators = new Map<string, (value: unknown) => boolean>();

beforeAll(async () => {
  for (const [id, path] of schemaPaths) {
    const schema = JSON.parse(
      await readFile(join(repositoryRoot, path), "utf8"),
    ) as object;
    validators.set(
      id,
      new Ajv2020({ allErrors: true, strict: false }).compile(schema),
    );
  }
});

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));

  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

describe("declared JSON contracts", () => {
  it("declares a schema that exists for every command", () => {
    for (const spec of DEFAULT_REGISTRY) {
      expect(schemaPaths.has(spec.jsonContract), spec.path.join(" ")).toBe(true);
    }
  });

  it("emits output satisfying the declared schema", async () => {
    for (const spec of DEFAULT_REGISTRY) {
      const result = await run(["--json", ...spec.path]);
      const validate = validators.get(spec.jsonContract);

      expect(validate?.(JSON.parse(result.stdout)), spec.path.join(" ")).toBe(
        true,
      );
    }
  });
});

describe("output safety", () => {
  const hostile = [
    "/home/someone/private/secret-token",
    "--expect",
    "sekrit-value-1.2.3",
    "start\u0007",
  ];

  it("never echoes a supplied argument in either mode", async () => {
    for (const json of [[], ["--json"]]) {
      const result = await run([...json, ...hostile]);

      expect(result.exitCode).not.toBe(0);
      for (const secret of ["secret-token", "sekrit-value", "\u0007"]) {
        expect(result.stdout, secret).not.toContain(secret);
        expect(result.stderr, secret).not.toContain(secret);
      }
    }
  });
});

describe("determinism", () => {
  it("emits identical bytes for two runs of one argument vector", async () => {
    expect(await run(["--json", "handshake"])).toEqual(
      await run(["--json", "handshake"]),
    );
    expect(await run(["--help"])).toEqual(await run(["--help"]));
  });
});

describe("no mutation on a usage failure", () => {
  it("applies no filesystem effect", async () => {
    const fileSystem = memoryFileSystem();
    const output = recordingOutput();
    const before = await fileSystem.list(".");

    await runCommandLine(["start"], createRuntime({ fileSystem, output }));

    expect(await fileSystem.list(".")).toEqual(before);
  });
});
```

- [x] **Step 2: Run it**

Run: `npx vitest run tests/cli-contracts.test.ts`
Expected: PASS. If the adapter-message schema rejects the handshake output,
fix the payload, not the schema: the schema is the published contract.

If `memoryFileSystem()` requires a seed argument, pass the shape its signature
in `packages/runtime/src/infra/fake/index.ts` declares.

- [x] **Step 3: Commit**

```bash
git add tests
git commit -m "test: prove the contracts the router claims

Every registered command declares a schema that exists and emits output that
satisfies it. A hostile argument vector reaches neither stream, two identical
runs emit identical bytes, and a usage failure touches no file.

Refs #17"
```

---

### Task 12: Update the surfaces that pinned the old help text

**Files:**

- Modify: `scripts/verify-package.mjs:39`
- Modify: `tests/package-verifier.test.ts:41`
- Modify: `tests/bundle-smoke.test.ts:56`
- Modify: `README.md`
- Test: `tests/readme-honesty.test.ts`

- [x] **Step 1: Run the suites to see what breaks**

Run: `npx vitest run tests/package-verifier.test.ts tests/bundle-smoke.test.ts tests/readme-honesty.test.ts && npm run build && npm run package:verify`
Expected: FAIL. Each failure names a place that pinned the old one-line help.

- [x] **Step 2: Replace the pinned help with the generated first line**

The old constant was the entire help text. The generated help is multi-line, so
these checks assert its first line and its command list instead of the whole
block. In `scripts/verify-package.mjs`, replace the `expectedHelp` constant with:

```js
const expectedHelpFirstLine =
  "Usage: yoda [--expect <version>] [--json] <command>";
```

and change the assertion that compared the whole string to compare
`stdout.split("\n")[0]`. Apply the same change in `tests/package-verifier.test.ts`
and `tests/bundle-smoke.test.ts`.

- [x] **Step 3: Correct the README claim**

`tests/readme-honesty.test.ts` pins the sentence describing the shipped surface.
Update both the README sentence and the test to the same new wording:

```text
supports only `help`, `version`, and `handshake`
```

- [x] **Step 4: Verify**

Run: `npm run build && npm run package:verify && npx vitest run tests/package-verifier.test.ts tests/bundle-smoke.test.ts tests/readme-honesty.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add scripts tests README.md
git commit -m "test: pin the generated help instead of a constant

The help text is now a function of the registry, so the checks that pinned a
single hand-written line assert its first line and command list.

Refs #17"
```

---

### Task 13: Document the public behavior and verify the whole repository

**Files:**

- Create: `docs/architecture/command-routing.md`
- Modify: `docs/superpowers/plans/2026-08-07-command-routing.md` (check the boxes)

- [x] **Step 1: Write the public behavior document**

Create `docs/architecture/command-routing.md` covering, in prose that matches
`docs/architecture/runtime-boundaries.md`:

- the five stages and why a usage failure cannot change state;
- the global flags, and that `--expect` applies at any position;
- that `--help`, `-h`, and `--version` are spellings of commands;
- JSON mode: one object, whose schema the command declares, and that a non-zero
  exit is always the result envelope;
- the reason codes the router can emit, and why `runtime.orientation_ok` was
  added;
- the exemption: `handshake` has no human form;
- what is deliberately absent: `--require-contract`, and every workflow command;
- that parity remains `0 / 400` and why `CLI-HELP` is not claimed.

- [x] **Step 2: Verify the document**

Run: `npx markdownlint-cli2 "docs/architecture/command-routing.md" && npm run spellcheck`
Expected: clean.

- [x] **Step 3: Run the full verification suite**

Run: `npm run verify`
Expected: PASS end to end. Record the exact output for the pull request. If
coverage falls below 100% on `domain` or `composition`, add the missing case as
a real test rather than an ignore comment.

- [x] **Step 4: Confirm parity did not move**

Run: `npm run parity:check`
Expected: `0 / 400 (0.00%)`. If it changed, a row was edited that should not
have been.

- [x] **Step 5: Commit and open the pull request**

```bash
git add docs
git commit -m "docs: publish the command routing contract

Refs #17"
git push -u origin feat/issue-17-command-routing
```

The pull request must close #17, name `RUN-02`, explain the two JSON shapes and
the catalog revision, list the exact verification commands with their output,
and state that parity remains `0 / 400 (0.00%)`.
