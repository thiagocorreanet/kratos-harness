# Git Service and Repository-State Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `Git` port with one atomic, normalized, read-only repository observation whose parsing and classification live entirely under the 100% coverage gate.

**Architecture:** `infra/node/git.ts` executes one argv and returns raw bytes with no decision branches. `composition/git.ts` sequences two Git commands plus git-directory marker reads and assembles the snapshot. `domain/git/*` owns every parser, every classification rule, and the frozen types. This mirrors how `composition/events.ts` sits between `domain/events/` and `infra/node/`.

**Tech Stack:** TypeScript 6 (`@typescript/typescript6`), Node >=24.18.0, Vitest 4, ESM only.

**Spec:** [`docs/superpowers/specs/2026-08-12-git-service-design.md`](../specs/2026-08-12-git-service-design.md)

**Issue:** [#23](https://github.com/thiagocorreanet/kratos-harness/issues/23) (`RUN-08`). Epic [#15](https://github.com/thiagocorreanet/kratos-harness/issues/15).

## Global Constraints

- All source, tests, fixtures, comments, errors, docs, commits, and PR text in English.
- `domain/` and `ports/` must not import any Node builtin, Ajv, a schema JSON path, or `infra/schema`. Enforced by `tests/architecture.test.ts`.
- Only an entry point may import `composition`.
- Coverage thresholds are 100% branches, functions, lines, statements over `domain/**`, `composition/**`, `infra/schema/**`. `infra/node/**` is excluded, so **no domain classification rule may live there**. Mapping a Node error object to `RawCommandResult` (`ENOENT` → not spawned, `killed` → timed out, numeric `code` → exit code) is the one exception: the error object does not cross the domain boundary cleanly. Those three branches stay in the adapter and are covered directly by `tests/node-git-runner.test.ts` against real Git.
- `observe()` must never reject and must never mutate the repository.
- No new reason code. The catalog stays at revision 1.3.
- Command evidence carries no output bytes, no file content, no duration, no timestamp.
- Every Git invocation uses the fixed prefix `git --no-optional-locks --no-pager -c core.quotepath=false`.
- Paths sort by UTF-8 byte sequence, never `localeCompare`.
- Run `npx prettier --write` on touched files before each commit; `npm run verify` must pass before review.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/runtime/src/domain/git/model.ts` | frozen observation, change, path, evidence types |
| `packages/runtime/src/domain/git/paths.ts` | byte decoding, byte ordering |
| `packages/runtime/src/domain/git/status.ts` | `--porcelain=v2 -z` parser |
| `packages/runtime/src/domain/git/refs.ts` | `rev-parse` output and marker classification |
| `packages/runtime/src/domain/git/evidence.ts` | `GitCommandRecord` construction |
| `packages/runtime/src/domain/git/index.ts` | re-exports |
| `packages/runtime/src/composition/git.ts` | invocation sequence, snapshot assembly |
| `packages/runtime/src/infra/node/git.ts` | process execution, marker reads |
| `packages/runtime/src/infra/fake/git.ts` | scripted runner, fixed-observation stub |
| `packages/runtime/src/ports/index.ts` | `Git.observe()`, `Digests.sha256Bytes` |
| `packages/runtime/src/infra/digests.ts` | `sha256Bytes` implementation |
| `packages/runtime/src/infra/node/workspace.ts` | consumes the shared runner |
| `tests/support/git-repositories.ts` | real-repository scenario builder |
| `docs/architecture/git-service.md` | public documentation |

---

### Task 1: Frozen types and path handling

**Files:**

- Create: `packages/runtime/src/domain/git/model.ts`
- Create: `packages/runtime/src/domain/git/paths.ts`
- Modify: `packages/runtime/src/ports/transactions.ts:27-29`
- Modify: `packages/runtime/src/infra/digests.ts:6-10`
- Test: `tests/git-paths.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: every type below, plus `decodeGitPath(bytes: Uint8Array, digests: Digests): GitPath` and `compareGitPaths(left: GitPath, right: GitPath): number`.

- [x] **Step 1: Extend the `Digests` port**

In `packages/runtime/src/ports/transactions.ts`, replace the `Digests` interface:

```ts
/** Injected content digests, so domain code never imports a crypto runtime. */
export interface Digests {
  sha256(text: string): string;
  sha256Bytes(bytes: Uint8Array): string;
}
```

In `packages/runtime/src/infra/digests.ts`:

```ts
import { createHash } from "node:crypto";

import type { Digests } from "../ports/index.js";

/** Production SHA-256 over the exact UTF-8 bytes represented by the text. */
export function sha256Digests(): Digests {
  return {
    sha256: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    sha256Bytes: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  };
}
```

- [x] **Step 2: Write `model.ts`**

Types only, no logic. This file is pure declarations, so it carries no test of its own; Tasks 2 through 6 exercise every member.

```ts
export type GitPath =
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "undecodable";
      readonly sha256: string;
      readonly bytes: number;
    };

export type GitChangeKind =
  | "none"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed";

export interface GitConflict {
  readonly ours: boolean;
  readonly theirs: boolean;
  readonly base: boolean;
}

export interface GitChange {
  readonly path: GitPath;
  readonly tracking: "tracked" | "untracked" | "ignored";
  readonly index: GitChangeKind;
  readonly worktree: GitChangeKind;
  readonly conflict: GitConflict | null;
  readonly renamedFrom: GitPath | null;
  readonly entry: "file" | "directory" | "symlink" | "submodule";
}

export interface GitUpstream {
  readonly ref: string;
  readonly ahead: number;
  readonly behind: number;
}

export type GitHead =
  | { readonly kind: "unborn"; readonly branch: string }
  | {
      readonly kind: "branch";
      readonly branch: string;
      readonly commit: string;
      readonly upstream: GitUpstream | null;
    }
  | { readonly kind: "detached"; readonly commit: string };

export type GitOperation =
  | "none"
  | "merge"
  | "rebase"
  | "cherry_pick"
  | "revert";

export interface GitRepository {
  readonly head: GitHead;
  readonly worktree: "principal" | "linked";
  readonly operation: GitOperation;
  readonly changes: readonly GitChange[];
}

export interface GitCommandRecord {
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly stdoutSha256: string;
  readonly stdoutBytes: number;
  readonly stderrSha256: string;
  readonly stderrBytes: number;
  readonly outcome: "ok" | "failed" | "timeout" | "not_spawned";
}

export type GitObservationFailureKind =
  | "git_absent"
  | "not_a_repository"
  | "timeout"
  | "command_failed"
  | "unreadable";

export type GitObservation =
  | {
      readonly kind: "observed";
      readonly repository: GitRepository;
      readonly evidence: readonly GitCommandRecord[];
    }
  | {
      readonly kind: GitObservationFailureKind;
      readonly evidence: readonly GitCommandRecord[];
    };
```

- [x] **Step 3: Write the failing test**

Create `tests/git-paths.test.ts`:

```ts
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import {
  compareGitPaths,
  decodeGitPath,
} from "../packages/runtime/src/domain/git/paths.js";

const digests = sha256Digests();
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("decodeGitPath", () => {
  it("decodes valid UTF-8 as text", () => {
    expect(decodeGitPath(utf8("src/a.ts"), digests)).toEqual({
      kind: "text",
      value: "src/a.ts",
    });
  });

  it("decodes a name containing a newline", () => {
    expect(decodeGitPath(utf8("odd\nname.txt"), digests)).toEqual({
      kind: "text",
      value: "odd\nname.txt",
    });
  });

  it("decodes non-ASCII Unicode", () => {
    // Multi-byte sequences at two lengths: two-byte Latin-1 supplement and
    // three-byte CJK.
    expect(decodeGitPath(utf8("café/naïve/文書.md"), digests)).toEqual({
      kind: "text",
      value: "café/naïve/文書.md",
    });
  });

  it("classifies invalid UTF-8 as undecodable without inventing a name", () => {
    // 0xFF is never valid in UTF-8.
    const path = decodeGitPath(bytes(0x61, 0xff, 0x62), digests);

    expect(path.kind).toBe("undecodable");
    if (path.kind !== "undecodable") throw new Error("unreachable");
    expect(path.bytes).toBe(3);
    expect(path.sha256).toBe(digests.sha256Bytes(bytes(0x61, 0xff, 0x62)));
  });

  it("never yields the replacement character from undecodable bytes", () => {
    const path = decodeGitPath(bytes(0xff, 0xfe), digests);

    expect(JSON.stringify(path)).not.toContain("�");
  });

  it("distinguishes two different undecodable paths", () => {
    const left = decodeGitPath(bytes(0xff, 0x01), digests);
    const right = decodeGitPath(bytes(0xff, 0x02), digests);

    expect(left).not.toEqual(right);
  });
});

describe("compareGitPaths", () => {
  it("orders text paths by UTF-8 bytes, not by locale", () => {
    // Locale collation places "a" before "B"; byte order does not.
    const sorted = [utf8("a.txt"), utf8("B.txt")]
      .map((value) => decodeGitPath(value, digests))
      .sort(compareGitPaths);

    expect(sorted).toEqual([
      { kind: "text", value: "B.txt" },
      { kind: "text", value: "a.txt" },
    ]);
  });

  it("is antisymmetric", () => {
    const left = decodeGitPath(utf8("a"), digests);
    const right = decodeGitPath(utf8("b"), digests);

    expect(Math.sign(compareGitPaths(left, right))).toBe(
      -Math.sign(compareGitPaths(right, left)),
    );
  });

  it("reports equal paths as equal", () => {
    const left = decodeGitPath(utf8("same"), digests);
    const right = decodeGitPath(utf8("same"), digests);

    expect(compareGitPaths(left, right)).toBe(0);
  });

  it("orders every undecodable path after every text path", () => {
    const text = decodeGitPath(utf8("zzz"), digests);
    const undecodable = decodeGitPath(bytes(0xff), digests);

    expect(compareGitPaths(text, undecodable)).toBeLessThan(0);
    expect(compareGitPaths(undecodable, text)).toBeGreaterThan(0);
  });

  it("orders undecodable paths against each other by digest", () => {
    const left = decodeGitPath(bytes(0xff, 0x01), digests);
    const right = decodeGitPath(bytes(0xff, 0x02), digests);

    expect(Math.sign(compareGitPaths(left, right))).not.toBe(0);
  });
});
```

- [x] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/git-paths.test.ts`
Expected: FAIL — cannot resolve `../packages/runtime/src/domain/git/paths.js`.

- [x] **Step 5: Implement `paths.ts`**

```ts
import type { Digests } from "../../ports/index.js";
import type { GitPath } from "./model.js";

// `fatal` is what makes an invalid byte an error instead of U+FFFD. Silent
// replacement would let two distinct files normalize to one path, and a scope
// gate would then compare against a name that does not exist on disk.
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** Decode one raw path from Git, refusing to invent a name for bad bytes. */
export function decodeGitPath(bytes: Uint8Array, digests: Digests): GitPath {
  try {
    return { kind: "text", value: decoder.decode(bytes) };
  } catch {
    return {
      kind: "undecodable",
      sha256: digests.sha256Bytes(bytes),
      bytes: bytes.length,
    };
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * Order by UTF-8 byte sequence.
 *
 * The rest of the runtime uses `localeCompare(…, "en-US")`, but there the data
 * are generated identifiers. These are arbitrary names read off a disk, and
 * locale ordering is not stable across ICU versions — which is exactly what
 * "platform-consistent" forbids.
 */
export function compareGitPaths(left: GitPath, right: GitPath): number {
  if (left.kind === "text" && right.kind === "text") {
    return compareBytes(encoder.encode(left.value), encoder.encode(right.value));
  }
  // An undecodable path has no name to order by, so it sorts after every named
  // path and against its peers by digest. Any total order works; this one is
  // stable and needs no second source of truth.
  if (left.kind === "text") return -1;
  if (right.kind === "text") return 1;
  return left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0;
}
```

- [x] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/git-paths.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 7: Confirm no existing caller broke**

Run: `npx vitest run tests/ports-contract.test.ts tests/event-chain.test.ts tests/node-transactions.test.ts`
Expected: PASS. The `Digests` change is additive, so these must be unaffected.

- [x] **Step 8: Commit**

```bash
npx prettier --write packages/runtime/src/domain/git packages/runtime/src/ports/transactions.ts packages/runtime/src/infra/digests.ts tests/git-paths.test.ts
git add packages/runtime/src/domain/git packages/runtime/src/ports/transactions.ts packages/runtime/src/infra/digests.ts tests/git-paths.test.ts
git commit -m "feat: add Git path decoding and byte ordering"
```

- [x] **Step 9: Write the property test**

The repository has no `fast-check` dependency. Property tests here use a seeded LCG, following `tests/canonical-json-properties.test.ts:12-18`. Create `tests/git-paths-properties.test.ts`:

```ts
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import {
  compareGitPaths,
  decodeGitPath,
} from "../packages/runtime/src/domain/git/paths.js";

const digests = sha256Digests();

function createGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

function generateBytes(next: () => number): Uint8Array {
  const length = next() % 24;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = next() % 256;
  }
  return bytes;
}

const SEEDS = [1, 7, 13, 42, 99, 256, 1_009, 65_537];

describe("path ordering is a total order", () => {
  it.each(SEEDS)("is antisymmetric and transitive for seed %i", (seed) => {
    const next = createGenerator(seed);
    const paths = Array.from({ length: 40 }, () =>
      decodeGitPath(generateBytes(next), digests),
    );

    for (const left of paths) {
      for (const right of paths) {
        expect(Math.sign(compareGitPaths(left, right))).toBe(
          -Math.sign(compareGitPaths(right, left)),
        );
      }
    }

    const sorted = [...paths].sort(compareGitPaths);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(
        compareGitPaths(sorted[index - 1] as never, sorted[index] as never),
      ).toBeLessThanOrEqual(0);
    }
  });

  it.each(SEEDS)("sorts identically regardless of input order for seed %i", (seed) => {
    const next = createGenerator(seed);
    const paths = Array.from({ length: 30 }, () =>
      decodeGitPath(generateBytes(next), digests),
    );

    expect([...paths].sort(compareGitPaths)).toEqual(
      [...paths].reverse().sort(compareGitPaths),
    );
  });
});

describe("decoding never fabricates a name", () => {
  it.each(SEEDS)("emits no replacement character for seed %i", (seed) => {
    const next = createGenerator(seed);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const path = decodeGitPath(generateBytes(next), digests);
      if (path.kind === "text") {
        expect(path.value).not.toContain("�");
      } else {
        expect(path.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  it.each(SEEDS)("round-trips valid UTF-8 unchanged for seed %i", (seed) => {
    const next = createGenerator(seed);
    const encoder = new TextEncoder();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const text = String.fromCodePoint(...[next() % 0x10_000].filter((code) =>
        code < 0xd800 || code > 0xdfff,
      ));
      if (text.length === 0) continue;

      expect(decodeGitPath(encoder.encode(text), digests)).toEqual({
        kind: "text",
        value: text,
      });
    }
  });
});
```

- [x] **Step 10: Run the property test**

Run: `npx vitest run tests/git-paths-properties.test.ts`
Expected: PASS.

- [x] **Step 11: Commit**

```bash
npx prettier --write tests/git-paths-properties.test.ts
git add tests/git-paths-properties.test.ts
git commit -m "test: property-test Git path decoding and ordering"
```

---

### Task 2: Porcelain v2 parser

**Files:**

- Create: `packages/runtime/src/domain/git/status.ts`
- Test: `tests/git-status-parser.test.ts`

**Interfaces:**

- Consumes: `GitChange`, `GitHead`, `GitUpstream` from Task 1's `model.ts`; `decodeGitPath`, `compareGitPaths` from Task 1's `paths.ts`.
- Produces: `parseStatusPorcelainV2(stdout: Uint8Array, digests: Digests): ParsedStatus | null`, where `ParsedStatus` is `{ readonly head: GitHead; readonly changes: readonly GitChange[] }`. `null` means unparsable and maps to the `unreadable` observation.

**Reference — real output captured from Git.** Fields are space-separated within a record; records are NUL-separated. A rename record (`2`) carries its origin path in a second NUL-separated field.

```text
# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a
# branch.head main
1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 849ddff... .gitignore
2 R. N... 100644 100644 100644 587be6b... 587be6b... R100 renamed.txt<NUL>staged.txt
1 .M N... 100644 100644 100644 789819... 789819... tracked.txt
? link.txt
? untracked.txt
! dist/
u UU N... 100644 100644 100644 100644 df967b9... b19a1e9... 950b81b... c.txt
```

Unborn HEAD emits `# branch.oid (initial)`. Detached HEAD emits `# branch.head (detached)`. An upstream adds `# branch.upstream origin/main` and `# branch.ab +2 -1`.

- [x] **Step 1: Write the failing test**

Create `tests/git-status-parser.test.ts`:

```ts
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { parseStatusPorcelainV2 } from "../packages/runtime/src/domain/git/status.js";

const digests = sha256Digests();

/** Build a NUL-separated porcelain v2 payload from its records. */
const payload = (...records: string[]): Uint8Array =>
  new TextEncoder().encode(records.map((record) => `${record}\0`).join(""));

const parse = (...records: string[]) =>
  parseStatusPorcelainV2(payload(...records), digests);

describe("head classification", () => {
  it("reads an unborn branch as unborn with no commit", () => {
    const result = parse("# branch.oid (initial)", "# branch.head main");

    expect(result?.head).toEqual({ kind: "unborn", branch: "main" });
  });

  it("reads a detached head as detached with no branch", () => {
    const result = parse(
      "# branch.oid f901eb330ad4a83dafb882db1aae74ef5d859b32",
      "# branch.head (detached)",
    );

    expect(result?.head).toEqual({
      kind: "detached",
      commit: "f901eb330ad4a83dafb882db1aae74ef5d859b32",
    });
  });

  it("reads a branch without upstream", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: null,
    });
  });

  it("reads a branch with upstream divergence", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: { ref: "origin/main", ahead: 2, behind: 1 },
    });
  });
});

describe("change classification", () => {
  const head = ["# branch.oid " + "a".repeat(40), "# branch.head main"];

  it("separates staged from unstaged state on one path", () => {
    const result = parse(
      ...head,
      "1 AM N... 000000 100644 100644 " + "0".repeat(40) + " " + "1".repeat(40) + " both.txt",
    );

    expect(result?.changes).toEqual([
      {
        path: { kind: "text", value: "both.txt" },
        tracking: "tracked",
        index: "added",
        worktree: "modified",
        conflict: null,
        renamedFrom: null,
        entry: "file",
      },
    ]);
  });

  it("preserves the origin path of a rename", () => {
    const result = parse(
      ...head,
      "2 R. N... 100644 100644 100644 " +
        "5".repeat(40) + " " + "5".repeat(40) +
        " R100 renamed.txt\0staged.txt",
    );

    expect(result?.changes[0]?.index).toBe("renamed");
    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "renamed.txt",
    });
    expect(result?.changes[0]?.renamedFrom).toEqual({
      kind: "text",
      value: "staged.txt",
    });
  });

  it("reports an untracked path with no index or worktree kind", () => {
    const result = parse(...head, "? untracked.txt");

    expect(result?.changes).toEqual([
      {
        path: { kind: "text", value: "untracked.txt" },
        tracking: "untracked",
        index: "none",
        worktree: "none",
        conflict: null,
        renamedFrom: null,
        entry: "file",
      },
    ]);
  });

  it("reports an aggregated ignored directory as a directory entry", () => {
    const result = parse(...head, "! node_modules/");

    expect(result?.changes[0]?.tracking).toBe("ignored");
    expect(result?.changes[0]?.entry).toBe("directory");
  });

  it("reports a loose ignored file as a file entry", () => {
    const result = parse(...head, "! .env");

    expect(result?.changes[0]?.tracking).toBe("ignored");
    expect(result?.changes[0]?.entry).toBe("file");
  });

  it("records which conflict stages are present", () => {
    const result = parse(
      ...head,
      "u UU N... 100644 100644 100644 100644 " +
        "d".repeat(40) + " " + "b".repeat(40) + " " + "9".repeat(40) +
        " c.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: true,
      theirs: true,
      base: true,
    });
  });

  it("classifies a symlink by its worktree mode", () => {
    const result = parse(
      ...head,
      "1 .M N... 100644 100644 120000 " + "1".repeat(40) + " " + "2".repeat(40) + " link.txt",
    );

    expect(result?.changes[0]?.entry).toBe("symlink");
  });

  it("classifies a submodule by its mode", () => {
    const result = parse(
      ...head,
      "1 .M SC.. 160000 160000 160000 " + "1".repeat(40) + " " + "2".repeat(40) + " vendor/lib",
    );

    expect(result?.changes[0]?.entry).toBe("submodule");
  });

  it("keeps a path containing a space intact", () => {
    const result = parse(
      ...head,
      "1 .M N... 100644 100644 100644 " + "1".repeat(40) + " " + "2".repeat(40) + " a file.txt",
    );

    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "a file.txt",
    });
  });

  it("keeps a path beginning with a dash intact", () => {
    const result = parse(...head, "? --not-a-flag.txt");

    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "--not-a-flag.txt",
    });
  });

  it("sorts changes by path bytes regardless of emission order", () => {
    const result = parse(...head, "? b.txt", "? B.txt", "? a.txt");

    expect(result?.changes.map((change) => change.path)).toEqual([
      { kind: "text", value: "B.txt" },
      { kind: "text", value: "a.txt" },
      { kind: "text", value: "b.txt" },
    ]);
  });
});

describe("unparsable input", () => {
  it("returns null when the head record is missing", () => {
    expect(parse("? untracked.txt")).toBeNull();
  });

  it("returns null on an unknown record type", () => {
    expect(
      parse("# branch.oid " + "a".repeat(40), "# branch.head main", "x bogus"),
    ).toBeNull();
  });

  it("returns null on a truncated tracked record", () => {
    expect(
      parse("# branch.oid " + "a".repeat(40), "# branch.head main", "1 AM N..."),
    ).toBeNull();
  });

  it("returns null on a rename record missing its origin path", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "2 R. N... 100644 100644 100644 " +
          "5".repeat(40) + " " + "5".repeat(40) + " R100 renamed.txt",
      ),
    ).toBeNull();
  });

  it("accepts an empty change set", () => {
    const result = parse("# branch.oid " + "a".repeat(40), "# branch.head main");

    expect(result?.changes).toEqual([]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/git-status-parser.test.ts`
Expected: FAIL — cannot resolve `status.js`.

- [x] **Step 3: Implement `status.ts`**

```ts
import type { Digests } from "../../ports/index.js";
import { compareGitPaths, decodeGitPath } from "./paths.js";
import type {
  GitChange,
  GitChangeKind,
  GitHead,
  GitPath,
  GitUpstream,
} from "./model.js";

export interface ParsedStatus {
  readonly head: GitHead;
  readonly changes: readonly GitChange[];
}

const KINDS = new Map<string, GitChangeKind>([
  [".", "none"],
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["R", "renamed"],
  ["C", "copied"],
  ["T", "type_changed"],
]);

/** Split the NUL-delimited payload into raw byte records. */
function splitRecords(stdout: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] !== 0) continue;
    records.push(stdout.subarray(start, index));
    start = index + 1;
  }
  // Trailing bytes with no terminator mean the stream was cut mid-record.
  if (start !== stdout.length) records.push(stdout.subarray(start));
  return records;
}

function entryKindFromMode(mode: string): GitChange["entry"] {
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "submodule";
  if (mode === "040000") return "directory";
  return "file";
}

interface HeaderFields {
  oid?: string;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

function readHeader(text: string, fields: HeaderFields): boolean {
  const [, key, ...rest] = text.split(" ");
  const value = rest.join(" ");
  if (key === "branch.oid") fields.oid = value;
  else if (key === "branch.head") fields.head = value;
  else if (key === "branch.upstream") fields.upstream = value;
  else if (key === "branch.ab") {
    const [ahead, behind] = value.split(" ");
    if (ahead === undefined || behind === undefined) return false;
    if (!ahead.startsWith("+") || !behind.startsWith("-")) return false;
    fields.ahead = Number.parseInt(ahead.slice(1), 10);
    fields.behind = Number.parseInt(behind.slice(1), 10);
    if (!Number.isInteger(fields.ahead) || !Number.isInteger(fields.behind)) {
      return false;
    }
  }
  // An unknown header is tolerated: Git may add fields, and a new header
  // carries no change-set meaning. An unknown *record* is not tolerated.
  return true;
}

function buildHead(fields: HeaderFields): GitHead | null {
  const { oid, head } = fields;
  if (oid === undefined || head === undefined) return null;
  if (oid === "(initial)") {
    return head === "(detached)" ? null : { kind: "unborn", branch: head };
  }
  if (head === "(detached)") return { kind: "detached", commit: oid };
  const upstream: GitUpstream | null =
    fields.upstream === undefined
      ? null
      : {
          ref: fields.upstream,
          ahead: fields.ahead ?? 0,
          behind: fields.behind ?? 0,
        };
  return { kind: "branch", branch: head, commit: oid, upstream };
}

function untrackedChange(
  path: GitPath,
  tracking: "untracked" | "ignored",
  raw: string,
): GitChange {
  return {
    path,
    tracking,
    // An untracked or ignored path has no index state and no worktree delta.
    // Encoding it as `worktree: "added"` would make it indistinguishable from
    // a staged addition, which the completion gate must tell apart.
    index: "none",
    worktree: "none",
    conflict: null,
    renamedFrom: null,
    entry: raw.endsWith("/") ? "directory" : "file",
  };
}

/**
 * Parse `status --porcelain=v2 -z` output.
 *
 * Returns `null` for any record that does not match its expected shape. Partial
 * parsing would report a change set quietly missing entries, and a gate reading
 * that set would approve a change it never saw.
 */
export function parseStatusPorcelainV2(
  stdout: Uint8Array,
  digests: Digests,
): ParsedStatus | null {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const records = splitRecords(stdout);
  const fields: HeaderFields = {};
  const changes: GitChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const bytes = records[index] as Uint8Array;
    if (bytes.length === 0) continue;
    const text = decoder.decode(bytes);

    if (text.startsWith("# ")) {
      if (!readHeader(text, fields)) return null;
      continue;
    }

    const type = text.slice(0, 2);
    if (type === "? " || type === "! ") {
      const raw = text.slice(2);
      changes.push(
        untrackedChange(
          decodeGitPath(bytes.subarray(2), digests),
          type === "? " ? "untracked" : "ignored",
          raw,
        ),
      );
      continue;
    }

    if (type === "1 " || type === "2 ") {
      // `1 XY sub mH mI mW hH hI path` — 8 fields before the path.
      // `2 XY sub mH mI mW hH hI Xscore path` — 9 fields before the path.
      const leading = type === "1 " ? 8 : 9;
      const parts = text.split(" ");
      if (parts.length < leading + 1) return null;
      const status = parts[1] as string;
      const indexKind = KINDS.get(status[0] ?? "");
      const worktreeKind = KINDS.get(status[1] ?? "");
      if (indexKind === undefined || worktreeKind === undefined) return null;
      const worktreeMode = parts[5] as string;

      // Every field before the path is ASCII — status letters, octal modes,
      // hex object ids — so a character offset into `text` is also a byte
      // offset into `bytes`. That is what lets the path be sliced as raw
      // bytes while the fields are read as text.
      const offset = parts.slice(0, leading).join(" ").length + 1;
      const path = decodeGitPath(bytes.subarray(offset), digests);
      let renamedFrom: GitPath | null = null;

      if (type === "2 ") {
        // A rename consumes the following NUL-separated record as its origin.
        const origin = records[index + 1];
        if (origin === undefined || origin.length === 0) return null;
        renamedFrom = decodeGitPath(origin, digests);
        index += 1;
      }

      changes.push({
        path,
        tracking: "tracked",
        index: indexKind,
        worktree: worktreeKind,
        conflict: null,
        renamedFrom,
        entry: entryKindFromMode(worktreeMode),
      });
      continue;
    }

    if (type === "u ") {
      // `u XY sub m1 m2 m3 mW h1 h2 h3 path` — 10 fields before the path.
      const parts = text.split(" ");
      if (parts.length < 11) return null;
      const status = parts[1] as string;
      const offset = parts.slice(0, 10).join(" ").length + 1;
      changes.push({
        path: decodeGitPath(bytes.subarray(offset), digests),
        tracking: "tracked",
        index: "modified",
        worktree: "modified",
        conflict: {
          ours: status[0] !== ".",
          theirs: status[1] !== ".",
          // Stage-1 is the merge base; Git emits its object id as `h1`. An
          // all-zero id means the base is absent, as in add/add conflicts.
          base: (parts[7] ?? "").replace(/0/gu, "") !== "",
        },
        renamedFrom: null,
        entry: entryKindFromMode(parts[6] as string),
      });
      continue;
    }

    return null;
  }

  const head = buildHead(fields);
  if (head === null) return null;
  return {
    head,
    changes: [...changes].sort((left, right) =>
      compareGitPaths(left.path, right.path),
    ),
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/git-status-parser.test.ts`
Expected: PASS, 21 tests.

- [x] **Step 5: Commit**

```bash
npx prettier --write packages/runtime/src/domain/git/status.ts tests/git-status-parser.test.ts
git add packages/runtime/src/domain/git/status.ts tests/git-status-parser.test.ts
git commit -m "feat: parse Git porcelain v2 status records"
```

---

### Task 3: Ref and operation classification

**Files:**

- Create: `packages/runtime/src/domain/git/refs.ts`
- Test: `tests/git-refs.test.ts`

**Interfaces:**

- Consumes: `GitOperation` from `model.ts`.
- Produces:
  - `parseRevParse(stdout: string): RevParseFacts | null` where `RevParseFacts` is `{ readonly insideWorkTree: boolean; readonly gitDir: string; readonly gitCommonDir: string }`.
  - `classifyWorktree(facts: RevParseFacts): "principal" | "linked"`.
  - `classifyOperation(markers: readonly string[]): GitOperation` — `markers` is the list of entry names present in the git directory.

**Reference — real output captured from Git**, one line per requested field, in argument order:

```text
true
/tmp/pv2/.git
/tmp/pv2/.git
```

A merge in progress leaves `AUTO_MERGE`, `MERGE_HEAD`, `MERGE_MODE`, and `MERGE_MSG` in the git directory.

- [x] **Step 1: Write the failing test**

Create `tests/git-refs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  classifyOperation,
  classifyWorktree,
  parseRevParse,
} from "../packages/runtime/src/domain/git/refs.js";

describe("parseRevParse", () => {
  it("reads the three fields in argument order", () => {
    expect(parseRevParse("true\n/tmp/p/.git\n/tmp/p/.git\n")).toEqual({
      insideWorkTree: true,
      gitDir: "/tmp/p/.git",
      gitCommonDir: "/tmp/p/.git",
    });
  });

  it("reads a false work-tree report", () => {
    expect(parseRevParse("false\n/tmp/p.git\n/tmp/p.git\n")?.insideWorkTree).toBe(
      false,
    );
  });

  it("returns null when a field is missing", () => {
    expect(parseRevParse("true\n/tmp/p/.git\n")).toBeNull();
  });

  it("returns null on a non-boolean work-tree field", () => {
    expect(parseRevParse("maybe\n/tmp/p/.git\n/tmp/p/.git\n")).toBeNull();
  });

  it("returns null on empty output", () => {
    expect(parseRevParse("")).toBeNull();
  });
});

describe("classifyWorktree", () => {
  it("reports a principal worktree when the directories match", () => {
    expect(
      classifyWorktree({
        insideWorkTree: true,
        gitDir: "/p/.git",
        gitCommonDir: "/p/.git",
      }),
    ).toBe("principal");
  });

  it("reports a linked worktree when they differ", () => {
    expect(
      classifyWorktree({
        insideWorkTree: true,
        gitDir: "/p/.git/worktrees/feature",
        gitCommonDir: "/p/.git",
      }),
    ).toBe("linked");
  });
});

describe("classifyOperation", () => {
  it("reports none for an idle repository", () => {
    expect(classifyOperation(["HEAD", "config", "objects"])).toBe("none");
  });

  it("reports a merge from MERGE_HEAD", () => {
    expect(
      classifyOperation(["AUTO_MERGE", "MERGE_HEAD", "MERGE_MODE", "MERGE_MSG"]),
    ).toBe("merge");
  });

  it("reports a rebase from rebase-merge", () => {
    expect(classifyOperation(["rebase-merge"])).toBe("rebase");
  });

  it("reports a rebase from rebase-apply", () => {
    expect(classifyOperation(["rebase-apply"])).toBe("rebase");
  });

  it("reports a cherry-pick from CHERRY_PICK_HEAD", () => {
    expect(classifyOperation(["CHERRY_PICK_HEAD"])).toBe("cherry_pick");
  });

  it("reports a revert from REVERT_HEAD", () => {
    expect(classifyOperation(["REVERT_HEAD"])).toBe("revert");
  });

  it("prefers rebase over merge when both markers exist", () => {
    // An interactive rebase resolving a conflict leaves both. The rebase is the
    // operation the user is in; the merge is one step inside it.
    expect(classifyOperation(["MERGE_HEAD", "rebase-merge"])).toBe("rebase");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/git-refs.test.ts`
Expected: FAIL — cannot resolve `refs.js`.

- [x] **Step 3: Implement `refs.ts`**

```ts
import type { GitOperation } from "./model.js";

export interface RevParseFacts {
  readonly insideWorkTree: boolean;
  readonly gitDir: string;
  readonly gitCommonDir: string;
}

/** Read the three fields `rev-parse` emits, one per line, in argument order. */
export function parseRevParse(stdout: string): RevParseFacts | null {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length !== 3) return null;
  const [worktree, gitDir, gitCommonDir] = lines as [string, string, string];
  if (worktree !== "true" && worktree !== "false") return null;
  return { insideWorkTree: worktree === "true", gitDir, gitCommonDir };
}

/** A linked worktree is exactly a git dir that differs from the common dir. */
export function classifyWorktree(
  facts: RevParseFacts,
): "principal" | "linked" {
  return facts.gitDir === facts.gitCommonDir ? "principal" : "linked";
}

// Ordered by precedence, not alphabetically. An interactive rebase resolving a
// conflict leaves MERGE_HEAD as well; the rebase is the operation the user is
// in, and the merge is one step inside it.
const OPERATIONS: readonly (readonly [string, GitOperation])[] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry_pick"],
  ["REVERT_HEAD", "revert"],
  ["MERGE_HEAD", "merge"],
];

/** Classify the in-progress operation from git-directory entry names. */
export function classifyOperation(markers: readonly string[]): GitOperation {
  const present = new Set(markers);
  for (const [marker, operation] of OPERATIONS) {
    if (present.has(marker)) return operation;
  }
  return "none";
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/git-refs.test.ts`
Expected: PASS, 14 tests.

- [x] **Step 5: Commit**

```bash
npx prettier --write packages/runtime/src/domain/git/refs.ts tests/git-refs.test.ts
git add packages/runtime/src/domain/git/refs.ts tests/git-refs.test.ts
git commit -m "feat: classify Git refs, worktree topology, and operations"
```

---

### Task 4: Command evidence

**Files:**

- Create: `packages/runtime/src/domain/git/evidence.ts`
- Create: `packages/runtime/src/domain/git/index.ts`
- Test: `tests/git-evidence.test.ts`

**Interfaces:**

- Consumes: `GitCommandRecord` from `model.ts`; `Digests` from `ports`.
- Produces: `gitCommandRecord(argv: readonly string[], result: RawCommandResult, digests: Digests): GitCommandRecord`, where

```ts
export interface RawCommandResult {
  readonly spawned: boolean;
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
}
```

`RawCommandResult` and `GitRunner` are both declared in `evidence.ts`. They are the exact contract Task 5's Node adapter implements and Task 6's composition consumes. `index.ts` re-exports every public member of `model.ts`, `paths.ts`, `status.ts`, `refs.ts`, and `evidence.ts`.

- [x] **Step 1: Write the failing test**

Create `tests/git-evidence.test.ts`:

```ts
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { gitCommandRecord } from "../packages/runtime/src/domain/git/evidence.js";

const digests = sha256Digests();
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const raw = (overrides: Partial<Parameters<typeof gitCommandRecord>[1]> = {}) => ({
  spawned: true,
  exitCode: 0,
  stdout: utf8(""),
  stderr: utf8(""),
  timedOut: false,
  ...overrides,
});

describe("gitCommandRecord", () => {
  it("records argv, exit code, digests, and byte counts", () => {
    const record = gitCommandRecord(
      ["status", "--porcelain=v2"],
      raw({ stdout: utf8("out"), stderr: utf8("err") }),
      digests,
    );

    expect(record).toEqual({
      argv: ["status", "--porcelain=v2"],
      exitCode: 0,
      stdoutSha256: digests.sha256Bytes(utf8("out")),
      stdoutBytes: 3,
      stderrSha256: digests.sha256Bytes(utf8("err")),
      stderrBytes: 3,
      outcome: "ok",
    });
  });

  it("carries no output bytes, duration, or timestamp", () => {
    const record = gitCommandRecord(
      ["status"],
      raw({ stdout: utf8("secret content") }),
      digests,
    );
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain("secret content");
    expect(Object.keys(record).sort()).toEqual([
      "argv",
      "exitCode",
      "outcome",
      "stderrBytes",
      "stderrSha256",
      "stdoutBytes",
      "stdoutSha256",
    ]);
  });

  it("reports a non-zero exit as failed", () => {
    expect(gitCommandRecord(["status"], raw({ exitCode: 128 }), digests).outcome).toBe(
      "failed",
    );
  });

  it("reports a timeout as timeout regardless of exit code", () => {
    expect(
      gitCommandRecord(["status"], raw({ exitCode: null, timedOut: true }), digests)
        .outcome,
    ).toBe("timeout");
  });

  it("reports an unspawned process as not_spawned with a null exit code", () => {
    const record = gitCommandRecord(
      ["status"],
      raw({ spawned: false, exitCode: null }),
      digests,
    );

    expect(record.outcome).toBe("not_spawned");
    expect(record.exitCode).toBeNull();
  });

  it("produces an equal record for an equal command result", () => {
    const first = gitCommandRecord(["status"], raw({ stdout: utf8("x") }), digests);
    const second = gitCommandRecord(["status"], raw({ stdout: utf8("x") }), digests);

    expect(first).toEqual(second);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/git-evidence.test.ts`
Expected: FAIL — cannot resolve `evidence.js`.

- [x] **Step 3: Implement `evidence.ts` and `index.ts`**

```ts
import type { Digests } from "../../ports/index.js";
import type { GitCommandRecord } from "./model.js";

/** Exactly what the Node runner returns for one invocation. */
export interface RawCommandResult {
  readonly spawned: boolean;
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
}

/**
 * The low-level execution boundary the observation is composed from.
 *
 * It lives in the domain because it is an interface with no Node dependency of
 * its own. Declaring it in `infra/node` would force `composition/git.ts` to
 * import an infrastructure module for a type.
 */
export interface GitRunner {
  run(args: readonly string[]): Promise<RawCommandResult>;
  listGitDirectory(gitDir: string): Promise<readonly string[] | null>;
}

function outcomeOf(result: RawCommandResult): GitCommandRecord["outcome"] {
  if (!result.spawned) return "not_spawned";
  if (result.timedOut) return "timeout";
  return result.exitCode === 0 ? "ok" : "failed";
}

/**
 * Build the evidence record for one invocation.
 *
 * Output bytes, duration, and timestamps are all absent by construction. Any of
 * them would make two observations of an unchanged repository unequal, which is
 * the determinism property the observation is tested for. `argv` is safe to
 * record because the command sequence is fixed and carries no user data.
 */
export function gitCommandRecord(
  argv: readonly string[],
  result: RawCommandResult,
  digests: Digests,
): GitCommandRecord {
  return {
    argv: [...argv],
    exitCode: result.exitCode,
    stdoutSha256: digests.sha256Bytes(result.stdout),
    stdoutBytes: result.stdout.length,
    stderrSha256: digests.sha256Bytes(result.stderr),
    stderrBytes: result.stderr.length,
    outcome: outcomeOf(result),
  };
}
```

`index.ts`:

```ts
export * from "./model.js";
export * from "./paths.js";
export * from "./refs.js";
export * from "./status.js";
export * from "./evidence.js";
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/git-evidence.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
npx prettier --write packages/runtime/src/domain/git tests/git-evidence.test.ts
git add packages/runtime/src/domain/git tests/git-evidence.test.ts
git commit -m "feat: build deterministic Git command evidence"
```

---

### Task 5: Node runner and invocation consolidation

**Files:**

- Create: `packages/runtime/src/infra/node/git.ts`
- Modify: `packages/runtime/src/infra/node/workspace.ts:1,13,116-130`
- Modify: `packages/runtime/src/infra/node/index.ts:1,29-36,157-217`
- Test: `tests/node-git-runner.test.ts`

**Interfaces:**

- Consumes: `RawCommandResult` and `GitRunner` from Task 4.
- Produces:

```ts
export interface GitRunnerOptions {
  readonly timeoutMs?: number; // default 10_000
  readonly maxBuffer?: number; // default 16 * 1024 * 1024
  /**
   * Test-facing. Replaces the inherited `PATH` so a test can simulate Git
   * missing from the system without mutating the process environment.
   */
  readonly pathOverride?: string;
}

export function nodeGitRunner(
  root: string,
  options?: GitRunnerOptions,
): GitRunner;
```

`listGitDirectory` returns `null` when the directory cannot be read, which Task 6 maps to `unreadable`. `workspace.ts` replaces its private `gitOutput` with this runner.

- [x] **Step 1: Write the failing test**

Create `tests/node-git-runner.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeGitRunner } from "@mestre-yoda/runtime/infra/node";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-git-runner-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  return root;
}

describe("nodeGitRunner", () => {
  it("returns raw bytes and a zero exit for a successful command", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root).run(["rev-parse", "--is-inside-work-tree"]);

    expect(result.spawned).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("true");
  });

  it("reports a failing command without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "yoda-git-runner-"));
    roots.push(root);
    const result = await nodeGitRunner(root).run(["rev-parse", "--git-dir"]);

    expect(result.spawned).toBe(true);
    expect(result.exitCode).toBe(128);
  });

  it("reports a missing executable as not spawned", async () => {
    const root = await repository();
    // An empty PATH is how the adapter sees Git absent from the system.
    const result = await nodeGitRunner(root, { pathOverride: "" }).run(["status"]);

    expect(result.spawned).toBe(false);
    expect(result.exitCode).toBeNull();
  });

  it("reports a timeout without throwing", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root, { timeoutMs: 1 }).run([
      "-c",
      "alias.slow=!sleep 5",
      "slow",
    ]);

    expect(result.timedOut).toBe(true);
  });

  it("does not write the index while observing", async () => {
    const root = await repository();
    await writeFile(join(root, "a.txt"), "a", "utf8");
    execFileSync("git", ["add", "a.txt"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-qm", "i"], {
      cwd: root,
    });
    const before = await readIndexDigest(root);

    await nodeGitRunner(root).run([
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "-uall",
      "--ignored=matching",
    ]);

    expect(await readIndexDigest(root)).toBe(before);
  });

  it("lists git-directory entries", async () => {
    const root = await repository();
    const entries = await nodeGitRunner(root).listGitDirectory(join(root, ".git"));

    expect(entries).toContain("HEAD");
  });

  it("returns null for an unreadable git directory", async () => {
    const root = await repository();
    const entries = await nodeGitRunner(root).listGitDirectory(join(root, "absent"));

    expect(entries).toBeNull();
  });
});

async function readIndexDigest(root: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256")
    .update(await readFile(join(root, ".git", "index")))
    .digest("hex");
}
```

`pathOverride` is an extra `GitRunnerOptions` field used only to simulate an absent executable; document it as test-facing in the source comment.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/node-git-runner.test.ts`
Expected: FAIL — `nodeGitRunner` is not exported.

- [x] **Step 3: Implement `infra/node/git.ts`**

```ts
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { GitRunner, RawCommandResult } from "../../domain/git/index.js";

export interface GitRunnerOptions {
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  /**
   * Test-facing. Replaces the inherited `PATH` so a test can simulate Git
   * missing from the system without mutating the process environment.
   */
  readonly pathOverride?: string;
}

// `--no-optional-locks` is what keeps the observation read-only: without it
// `git status` refreshes the index as a side effect and takes the index lock,
// so a read both mutates the user's repository and can fail against a
// concurrent reader.
const PREFIX = [
  "--no-optional-locks",
  "--no-pager",
  "-c",
  "core.quotepath=false",
] as const;

const EMPTY = new Uint8Array(0);

function toBytes(value: unknown): Uint8Array {
  return Buffer.isBuffer(value) ? new Uint8Array(value) : EMPTY;
}

/** Real Git process execution. Deliberately free of decision branches. */
export function nodeGitRunner(
  root: string,
  options: GitRunnerOptions = {},
): GitRunner {
  const timeout = options.timeoutMs ?? 10_000;
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;

  return {
    run: (args) =>
      new Promise<RawCommandResult>((resolve) => {
        execFile(
          "git",
          [...PREFIX, ...args],
          {
            cwd: root,
            encoding: "buffer",
            killSignal: "SIGKILL",
            maxBuffer,
            timeout,
            windowsHide: true,
            env: {
              PATH: options.pathOverride ?? process.env.PATH ?? "",
              GIT_CONFIG_NOSYSTEM: "1",
              // A path that cannot exist neutralizes the user's ~/.gitconfig.
              // A personal `status.showUntrackedFiles=no` would otherwise
              // silently change the change set a gate evaluates.
              GIT_CONFIG_GLOBAL: join(root, ".git", "yoda-absent-global-config"),
              GIT_OPTIONAL_LOCKS: "0",
              GIT_TERMINAL_PROMPT: "0",
              LC_ALL: "C",
            },
          },
          (error, stdout, stderr) => {
            const raw = error as (Error & {
              code?: number | string;
              killed?: boolean;
            }) | null;
            resolve({
              spawned: raw?.code !== "ENOENT",
              exitCode: typeof raw?.code === "number" ? raw.code : error ? null : 0,
              stdout: toBytes(stdout),
              stderr: toBytes(stderr),
              timedOut: raw?.killed === true,
            });
          },
        );
      }),
    listGitDirectory: async (gitDir) => {
      try {
        return await readdir(gitDir);
      } catch {
        return null;
      }
    },
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/node-git-runner.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 5: Migrate `workspace.ts` to the shared runner**

Delete the private `gitOutput` helper (`workspace.ts:116-130`) and its `execFile`/`promisify` imports. Replace its three call sites in `locateWorktree` with the runner, decoding stdout and trimming, and mapping a non-zero exit to `null` so the existing behavior is preserved exactly.

- [x] **Step 6: Verify the migration changed no behavior**

Run: `npx vitest run tests/node-workspace.test.ts tests/project-discovery-composition.test.ts tests/project-root-resolution.test.ts`
Expected: PASS with no test modified. If any fails, the migration changed behavior and must be corrected rather than the test adjusted.

- [x] **Step 7: Commit**

```bash
npx prettier --write packages/runtime/src/infra/node tests/node-git-runner.test.ts
git add packages/runtime/src/infra/node tests/node-git-runner.test.ts
git commit -m "feat: add one Git process runner and consolidate invocation"
```

---

### Task 6: Observation assembly and the new port

**Files:**

- Create: `packages/runtime/src/composition/git.ts`
- Create: `packages/runtime/src/infra/fake/git.ts`
- Modify: `packages/runtime/src/ports/index.ts:50-61`
- Modify: `packages/runtime/src/composition/index.ts:24-31,80-120`
- Modify: `packages/runtime/src/infra/node/index.ts` (remove `nodeGit`, export the composed one)
- Modify: `packages/runtime/src/infra/fake/index.ts:205-215` (replace `stubGit`)
- Test: `tests/git-observation.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–5.
- Produces:
  - `ports/index.ts`: `export interface Git { observe(): Promise<GitObservation> }`. `RepositoryState` and the three old methods are deleted.
  - `composition/git.ts`: `export function composeGit(runner: GitRunner, digests: Digests): Git`.
  - `infra/fake/git.ts`: `export function stubGit(observation?: GitObservation): Git`, defaulting to an observed clean principal worktree with an empty change set and empty evidence.

Task 6's test defines its own positional runner inline rather than importing a shared scripted fake. The sequence is two calls, so a positional stub is smaller than a keyed one and needs no argv-matching logic of its own to go wrong.

- [x] **Step 1: Write the failing test**

Create `tests/git-observation.test.ts`. Every case uses the scripted runner, so no process runs and every failure branch is reachable:

```ts
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { composeGit } from "../packages/runtime/src/composition/git.js";
import type {
  GitRunner,
  RawCommandResult,
} from "../packages/runtime/src/domain/git/index.js";

const digests = sha256Digests();
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const EMPTY = new Uint8Array(0);

const ok = (stdout: string): RawCommandResult => ({
  spawned: true,
  exitCode: 0,
  stdout: utf8(stdout),
  stderr: EMPTY,
  timedOut: false,
});

const REFS_OK = "true\n/p/.git\n/p/.git\n";
const STATUS_OK = "# branch.oid " + "a".repeat(40) + "\0# branch.head main\0";

/** Drive the sequence by position: first call is rev-parse, second is status. */
function runner(
  results: readonly RawCommandResult[],
  markers: readonly string[] | null = ["HEAD"],
): GitRunner {
  let call = 0;
  return {
    run: (): Promise<RawCommandResult> => {
      const result = results[call] ?? ok("");
      call += 1;
      return Promise.resolve(result);
    },
    listGitDirectory: () => Promise.resolve(markers),
  };
}

const observe = (
  results: readonly RawCommandResult[],
  markers: readonly string[] | null = ["HEAD"],
) => composeGit(runner(results, markers), digests).observe();

describe("successful observation", () => {
  it("assembles a clean principal worktree", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)]);

    expect(result).toEqual({
      kind: "observed",
      repository: {
        head: {
          kind: "branch",
          branch: "main",
          commit: "a".repeat(40),
          upstream: null,
        },
        worktree: "principal",
        operation: "none",
        changes: [],
      },
      evidence: [
        {
          argv: [
            "rev-parse",
            "--path-format=absolute",
            "--is-inside-work-tree",
            "--git-dir",
            "--git-common-dir",
          ],
          exitCode: 0,
          stdoutSha256: digests.sha256Bytes(utf8(REFS_OK)),
          stdoutBytes: utf8(REFS_OK).length,
          stderrSha256: digests.sha256Bytes(EMPTY),
          stderrBytes: 0,
          outcome: "ok",
        },
        {
          argv: [
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "-uall",
            "--ignored=matching",
          ],
          exitCode: 0,
          stdoutSha256: digests.sha256Bytes(utf8(STATUS_OK)),
          stdoutBytes: utf8(STATUS_OK).length,
          stderrSha256: digests.sha256Bytes(EMPTY),
          stderrBytes: 0,
          outcome: "ok",
        },
      ],
    });
  });

  it("reports a linked worktree when the git dirs differ", async () => {
    const result = await observe([
      ok("true\n/p/.git/worktrees/f\n/p/.git\n"),
      ok(STATUS_OK),
    ]);

    expect(result.kind === "observed" && result.repository.worktree).toBe(
      "linked",
    );
  });

  it("reports the in-progress operation from git-directory markers", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)], ["MERGE_HEAD"]);

    expect(result.kind === "observed" && result.repository.operation).toBe(
      "merge",
    );
  });

  it("records no evidence for the marker read", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)]);

    expect(result.evidence).toHaveLength(2);
  });
});

describe("failure classification", () => {
  it("reports git_absent when the process never spawned", async () => {
    const result = await observe([
      { spawned: false, exitCode: null, stdout: EMPTY, stderr: EMPTY, timedOut: false },
    ]);

    expect(result.kind).toBe("git_absent");
    expect(result.evidence).toHaveLength(1);
  });

  it("reports not_a_repository when rev-parse exits 128", async () => {
    const result = await observe([
      { spawned: true, exitCode: 128, stdout: EMPTY, stderr: EMPTY, timedOut: false },
    ]);

    expect(result.kind).toBe("not_a_repository");
  });

  it("reports not_a_repository for a bare repository", async () => {
    // Exit 0 with a false work-tree report: bare repo, or inside .git.
    const result = await observe([ok("false\n/p.git\n/p.git\n")]);

    expect(result.kind).toBe("not_a_repository");
  });

  it("reports timeout when rev-parse is killed", async () => {
    const result = await observe([
      { spawned: true, exitCode: null, stdout: EMPTY, stderr: EMPTY, timedOut: true },
    ]);

    expect(result.kind).toBe("timeout");
  });

  it("reports timeout when status is killed", async () => {
    const result = await observe([
      ok(REFS_OK),
      { spawned: true, exitCode: null, stdout: EMPTY, stderr: EMPTY, timedOut: true },
    ]);

    expect(result.kind).toBe("timeout");
  });

  it("reports command_failed on an unexpected rev-parse exit", async () => {
    const result = await observe([
      { spawned: true, exitCode: 1, stdout: EMPTY, stderr: EMPTY, timedOut: false },
    ]);

    expect(result.kind).toBe("command_failed");
  });

  it("reports command_failed on a non-zero status exit", async () => {
    const result = await observe([
      ok(REFS_OK),
      { spawned: true, exitCode: 1, stdout: EMPTY, stderr: EMPTY, timedOut: false },
    ]);

    expect(result.kind).toBe("command_failed");
  });

  it("reports unreadable on unparsable rev-parse output", async () => {
    const result = await observe([ok("nonsense\n")]);

    expect(result.kind).toBe("unreadable");
  });

  it("reports unreadable on unparsable status output", async () => {
    const result = await observe([ok(REFS_OK), ok("x bogus\0")]);

    expect(result.kind).toBe("unreadable");
  });

  it("reports unreadable when the git directory cannot be listed", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)], null);

    expect(result.kind).toBe("unreadable");
  });

  it("resolves rather than rejecting on every failure branch", async () => {
    const branches: RawCommandResult[][] = [
      [{ spawned: false, exitCode: null, stdout: EMPTY, stderr: EMPTY, timedOut: false }],
      [{ spawned: true, exitCode: 128, stdout: EMPTY, stderr: EMPTY, timedOut: false }],
      [{ spawned: true, exitCode: null, stdout: EMPTY, stderr: EMPTY, timedOut: true }],
      [ok("nonsense\n")],
      [ok(REFS_OK), ok("x bogus\0")],
    ];

    for (const branch of branches) {
      await expect(observe(branch)).resolves.toBeDefined();
    }
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/git-observation.test.ts`
Expected: FAIL — cannot resolve `composition/git.js`.

- [x] **Step 3: Implement `composition/git.ts`**

```ts
import {
  classifyOperation,
  classifyWorktree,
  gitCommandRecord,
  parseRevParse,
  parseStatusPorcelainV2,
  type GitCommandRecord,
  type GitObservation,
  type GitObservationFailureKind,
  type GitRunner,
} from "../domain/git/index.js";
import type { Digests, Git } from "../ports/index.js";

const REV_PARSE = [
  "rev-parse",
  "--path-format=absolute",
  "--is-inside-work-tree",
  "--git-dir",
  "--git-common-dir",
] as const;

const STATUS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "-uall",
  "--ignored=matching",
] as const;

function failure(
  kind: GitObservationFailureKind,
  evidence: readonly GitCommandRecord[],
): GitObservation {
  return { kind, evidence };
}

/** Compose the atomic observation from a runner and a digest provider. */
export function composeGit(runner: GitRunner, digests: Digests): Git {
  return {
    observe: async (): Promise<GitObservation> => {
      const evidence: GitCommandRecord[] = [];

      const refs = await runner.run(REV_PARSE);
      evidence.push(gitCommandRecord(REV_PARSE, refs, digests));
      if (!refs.spawned) return failure("git_absent", evidence);
      if (refs.timedOut) return failure("timeout", evidence);
      // Exit 128 is how Git reports "not a repository" for rev-parse.
      if (refs.exitCode === 128) return failure("not_a_repository", evidence);
      if (refs.exitCode !== 0) return failure("command_failed", evidence);

      const facts = parseRevParse(new TextDecoder().decode(refs.stdout));
      if (facts === null) return failure("unreadable", evidence);
      // A bare repository and the inside of a .git directory both exit 0 while
      // reporting false. There is no worktree to classify in either case.
      if (!facts.insideWorkTree) return failure("not_a_repository", evidence);

      const status = await runner.run(STATUS);
      evidence.push(gitCommandRecord(STATUS, status, digests));
      if (status.timedOut) return failure("timeout", evidence);
      if (status.exitCode !== 0) return failure("command_failed", evidence);

      const parsed = parseStatusPorcelainV2(status.stdout, digests);
      if (parsed === null) return failure("unreadable", evidence);

      // A filesystem read, not a command, so it produces no evidence record.
      // An unreadable marker fails the whole observation rather than silently
      // reporting `operation: "none"`.
      const markers = await runner.listGitDirectory(facts.gitDir);
      if (markers === null) return failure("unreadable", evidence);

      return {
        kind: "observed",
        repository: {
          head: parsed.head,
          worktree: classifyWorktree(facts),
          operation: classifyOperation(markers),
          changes: parsed.changes,
        },
        evidence,
      };
    },
  };
}
```

- [x] **Step 4: Replace the port and rewire composition**

In `ports/index.ts`, delete `RepositoryState` and the three placeholder methods, and import `GitObservation` from `domain/git/index.js`. In `composition/index.ts`, build the port as `composeGit(nodeGitRunner(root), digests)`. Remove `nodeGit` from `infra/node/index.ts`.

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/git-observation.test.ts`
Expected: PASS.

- [x] **Step 6: Typecheck the whole package**

Run: `npm run typecheck`
Expected: PASS. Any error here is a caller of the deleted methods that must be updated, not suppressed.

- [x] **Step 7: Commit**

```bash
npx prettier --write packages/runtime/src tests/git-observation.test.ts
git add packages/runtime/src tests/git-observation.test.ts
git commit -m "feat: assemble the atomic Git observation"
```

---

### Task 7: Real-repository scenario corpus

**Files:**

- Create: `tests/support/git-repositories.ts`
- Create: `tests/git-scenarios.test.ts`
- Test: both of the above

**Interfaces:**

- Consumes: `composeGit`, `nodeGitRunner`, `sha256Digests`.
- Produces:

```ts
export type ScenarioName = (typeof SCENARIOS)[number];

export const SCENARIOS: readonly string[];

export interface Scenario {
  readonly root: string;
  /** `false` when the platform cannot express this state at all. */
  readonly available: boolean;
  /** Why it is unavailable. Present only when `available` is false. */
  readonly reason: string | null;
  dispose(): Promise<void>;
}

export function createScenarioRepository(
  name: ScenarioName,
): Promise<Scenario>;

/** SHA-256 over every file under the root, including `.git`, in path order. */
export function digestTree(root: string): Promise<string>;
```

`digestTree` walks the whole directory recursively, sorts entries by path, and hashes each path followed by its bytes. Including `.git` is the point: an index refresh changes `.git/index` and nothing else, so a digest that skipped it would let a mutating observation pass.

- [x] **Step 1: Write the scenario builder**

One function per scenario, each returning a real temporary repository. Every repository is created with `git init -q --initial-branch=main` and `-c user.email=t@e.com -c user.name=T -c commit.gpgsign=false`, so no test depends on the developer's Git identity.

Scenarios: `not-a-repository`, `unborn`, `clean`, `staged`, `unstaged`, `staged-and-unstaged`, `deleted`, `untracked`, `ignored-file`, `ignored-directory`, `renamed`, `copied`, `type-changed`, `symlink`, `submodule`, `detached`, `branch-with-upstream`, `linked-worktree`, `merge-conflict`, `rebase-conflict`, `cherry-pick-conflict`, `revert-conflict`, `name-with-space`, `name-with-newline`, `name-with-unicode`, `name-with-leading-dash`.

- [x] **Step 2: Write the failing test**

`tests/git-scenarios.test.ts` asserts, per scenario, the expected normalized observation, plus two cross-cutting properties for every scenario:

```ts
it.each(SCENARIOS)("observes %s as expected", async (name) => {
  const scenario = await createScenarioRepository(name);
  try {
    if (!scenario.available) return;
    const observation = await composeGit(
      nodeGitRunner(scenario.root),
      sha256Digests(),
    ).observe();

    expect(observation).toEqual(EXPECTED[name]);
  } finally {
    await scenario.dispose();
  }
});

it.each(SCENARIOS)("leaves %s byte-identical", async (name) => {
  const scenario = await createScenarioRepository(name);
  try {
    if (!scenario.available) return;
    const before = await digestTree(scenario.root);
    await composeGit(nodeGitRunner(scenario.root), sha256Digests()).observe();

    // An index refresh changes .git/index and nothing else, so a digest that
    // skipped .git would let a mutating observation pass.
    expect(await digestTree(scenario.root)).toBe(before);
  } finally {
    await scenario.dispose();
  }
});
```

`EXPECTED` is a record mapping each scenario name to its full expected `GitObservation`, written out per scenario. Evidence digests vary with the repository's own object ids, so `EXPECTED` compares `repository` and `kind` exactly and asserts `evidence` separately by shape — two records, both `outcome: "ok"`.

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/git-scenarios.test.ts`
Expected: FAIL — the support module does not exist.

- [x] **Step 4: Implement the builder until the tests pass**

Report missing platform capabilities rather than skipping. `createScenarioRepository` probes support while building — a `symlink` scenario attempts `symlink()` and catches `EPERM`, a `name-with-newline` scenario attempts the write and catches `EINVAL` — and returns `available: false` with a reason instead of throwing. Every test then reports the gap rather than vanishing:

```ts
it.each(SCENARIOS)("observes %s deterministically", async (name) => {
  const scenario = await createScenarioRepository(name);
  try {
    if (!scenario.available) {
      // A scenario that vanishes from a green report is indistinguishable from
      // one that passed, so the absence is asserted rather than skipped.
      expect(scenario.reason).toBeTypeOf("string");
      return;
    }
    const git = composeGit(nodeGitRunner(scenario.root), sha256Digests());

    expect(await git.observe()).toEqual(await git.observe());
  } finally {
    await scenario.dispose();
  }
});
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/git-scenarios.test.ts`
Expected: PASS across all scenarios.

- [x] **Step 6: Commit**

```bash
npx prettier --write tests/support/git-repositories.ts tests/git-scenarios.test.ts
git add tests/support/git-repositories.ts tests/git-scenarios.test.ts
git commit -m "test: observe every classified Git state in real repositories"
```

- [x] **Step 7: Close the loop between real repositories and the pure parser**

The spec requires that the byte vectors feeding the pure parser come from real Git output rather than being authored by hand. Task 2's vectors were transcribed from captured output, which drifts silently if Git changes its format. Add a test that regenerates them:

```ts
it.each(SCENARIOS)("parses the real status bytes of %s", async (name) => {
  const scenario = await createScenarioRepository(name);
  try {
    if (!scenario.available) return;
    const status = await nodeGitRunner(scenario.root).run([
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "-uall",
      "--ignored=matching",
    ]);
    if (status.exitCode !== 0) return;

    // The parser must accept every byte sequence Git actually produces. A
    // hand-written vector that drifts from real output fails here, which is
    // what keeps the pure parser tests honest.
    expect(parseStatusPorcelainV2(status.stdout, sha256Digests())).not.toBeNull();
  } finally {
    await scenario.dispose();
  }
});
```

- [x] **Step 8: Run the test**

Run: `npx vitest run tests/git-scenarios.test.ts`
Expected: PASS. A `null` here means real Git emitted a record shape Task 2's parser rejects — fix the parser, not the assertion.

- [x] **Step 9: Commit**

```bash
npx prettier --write tests/git-scenarios.test.ts
git add tests/git-scenarios.test.ts
git commit -m "test: parse real status output for every scenario"
```

---

### Task 8: Port contract suite and guard tests

**Files:**

- Modify: `tests/support/port-contracts.ts:188-226`
- Modify: `tests/ports-contract.test.ts:21,27,39,90-93,134-198`
- Modify: `tests/architecture.test.ts:367-415`
- Test: all of the above

**Interfaces:**

- Consumes: `Git`, `GitObservation`, `stubGit`, `composeGit`, `nodeGitRunner`.
- Produces: a rewritten `describeGitContract(label: string, factory: () => Promise<Disposable<Git>>): void`.

- [x] **Step 1: Rewrite `describeGitContract`**

Replace the three placeholder assertions with contract properties both implementations must satisfy:

```ts
export function describeGitContract(
  label: string,
  factory: () => Promise<Disposable<Git>>,
): void {
  describe(`Git contract: ${label}`, () => {
    it("returns a kind from the closed set", async () => {
      const { port, dispose } = await factory();
      try {
        expect([
          "observed",
          "git_absent",
          "not_a_repository",
          "timeout",
          "command_failed",
          "unreadable",
        ]).toContain((await port.observe()).kind);
      } finally {
        await dispose();
      }
    });

    it("resolves rather than rejecting", async () => {
      const { port, dispose } = await factory();
      try {
        await expect(port.observe()).resolves.toBeDefined();
      } finally {
        await dispose();
      }
    });

    it("carries evidence that never contains output bytes", async () => {
      const { port, dispose } = await factory();
      try {
        for (const record of (await port.observe()).evidence) {
          expect(Object.keys(record).sort()).toEqual([
            "argv",
            "exitCode",
            "outcome",
            "stderrBytes",
            "stderrSha256",
            "stdoutBytes",
            "stdoutSha256",
          ]);
        }
      } finally {
        await dispose();
      }
    });

    it("returns changes sorted by path bytes", async () => {
      const { port, dispose } = await factory();
      try {
        const observation = await port.observe();
        if (observation.kind !== "observed") return;
        const paths = observation.repository.changes.map((change) => change.path);

        expect([...paths]).toEqual([...paths].sort(compareGitPaths));
      } finally {
        await dispose();
      }
    });

    it("observes the same repository equally twice", async () => {
      const { port, dispose } = await factory();
      try {
        expect(await port.observe()).toEqual(await port.observe());
      } finally {
        await dispose();
      }
    });
  });
}
```

- [x] **Step 2: Update `tests/ports-contract.test.ts`**

Replace the `nodeGit` import with `composeGit` and `nodeGitRunner`; run `describeGitContract` against both the stub and the composed Node implementation; delete the `node git classification` block at lines 146-198, whose assertions Task 7 now owns against real repositories.

- [x] **Step 3: Add the guard test for shell-out isolation**

Append to `tests/architecture.test.ts`, reusing the existing `sourceModules` helper:

```ts
it("confines child_process to the single Git runner module", async () => {
  const modules = await sourceModules();
  const importers = modules
    .filter(({ path }) => path.startsWith("packages/runtime/"))
    .filter(({ imports }) =>
      imports.some((specifier) => /^node:child_process$|^child_process$/u.test(specifier)),
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
```

The assertion above only holds once Task 6 deletes `nodeGit` from `packages/runtime/src/infra/node/index.ts`, which is that file's last remaining reason to import `node:child_process`. Task 5 deliberately leaves it in place.

- [x] **Step 4: Add the guard test for argv purity**

Append to `tests/git-scenarios.test.ts`:

```ts
it.each(SCENARIOS)("derives no argv element from observed data in %s", async (name) => {
  const scenario = await createScenarioRepository(name);
  try {
    if (!scenario.available) return;
    const observation = await composeGit(
      nodeGitRunner(scenario.root),
      sha256Digests(),
    ).observe();
    const allowed = new Set([
      "rev-parse", "--path-format=absolute", "--is-inside-work-tree",
      "--git-dir", "--git-common-dir",
      "status", "--porcelain=v2", "-z", "--branch", "-uall", "--ignored=matching",
    ]);

    for (const record of observation.evidence) {
      for (const argument of record.argv) expect(allowed).toContain(argument);
    }
  } finally {
    await scenario.dispose();
  }
});
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run tests/ports-contract.test.ts tests/architecture.test.ts tests/git-scenarios.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
npx prettier --write tests
git add tests
git commit -m "test: contract and guard the Git observation boundary"
```

---

### Task 9: Documentation and full verification

**Files:**

- Create: `docs/architecture/git-service.md`
- Modify: `docs/architecture/runtime-boundaries.md:69-94,108-110`
- Modify: `.cspell.json` if a new term appears

**Interfaces:**

- Consumes: the finished implementation.
- Produces: no code.

- [x] **Step 1: Write `docs/architecture/git-service.md`**

Document, in this order: the observation model and why it is one call; the failure variants and why `git_absent` stays distinct from `not_a_repository`; the command sequence; the environment table with the reason for each variable; why `--ignored=matching` rather than `traditional`, including the 502-versus-3 measurement; the evidence boundary; the read-only guarantee; path decoding and byte ordering; and the platform-consistency scope boundary against `QAL-03`.

- [x] **Step 2: Update `runtime-boundaries.md`**

In the ports table, change the `Git` row to "atomic repository observation". Delete the sentence assigning repository classification to `RUN-08` and the paragraph excusing its contract assertions, leaving the `RUN-07` half intact. State that `Git` now runs the full shared contract suite with no exception.

- [x] **Step 3: Run the documentation gates**

Run: `npx prettier --check . && npm run spellcheck && npx markdownlint-cli2`
Expected: PASS. Add any genuinely new term to `.cspell.json` in alphabetical order.

- [x] **Step 4: Run the full verification suite**

Run: `npm run verify`
Expected: PASS, including 100% coverage over `domain/**` and `composition/**`. A coverage gap in `composition/git.ts` means a failure branch has no scripted-runner test — add the test rather than lowering the threshold.

- [x] **Step 5: Commit**

```bash
git add docs .cspell.json
git commit -m "docs: document the Git service and repository-state classification"
```

- [x] **Step 6: Open the pull request**

The PR must link issue #23; explain the atomic-observation choice and the removal of the three placeholder methods; state that no reason code was added and why; explain the additive `Digests.sha256Bytes` method; record the `--ignored=matching` measurement; list the exact verification commands; and record the cross-platform scope boundary against `QAL-03`.

---

## Verification Summary

```bash
npx vitest run tests/git-paths.test.ts tests/git-paths-properties.test.ts \
  tests/git-status-parser.test.ts tests/git-refs.test.ts \
  tests/git-evidence.test.ts tests/node-git-runner.test.ts \
  tests/git-observation.test.ts tests/git-scenarios.test.ts \
  tests/ports-contract.test.ts tests/architecture.test.ts
npm run verify
```
