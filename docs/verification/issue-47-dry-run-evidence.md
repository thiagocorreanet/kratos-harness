# Issue #47 Dry-Run Plan Evidence

Issue [#47](https://github.com/thiagocorreanet/mestre-yoda/issues/47)
(`RUN-09`) records verification for universal dry-run plans and decision
explanation primitives. This record does not claim compatibility parity credit,
a public command, or a public flag.

## Environment

| | |
| --- | --- |
| Date | 2026-08-13 |
| Platform | Linux 7.0.0-28-generic |
| Node.js | v24.18.0 |
| npm | 11.16.0 |

## Documentation-contract RED

Before `docs/architecture/dry-run-plans.md` existed, this command exited 1:

```bash
npx vitest run tests/architecture.test.ts
```

The suite could not open the absent document.

## Focused evidence

```bash
npx vitest run tests/read-only-ports.test.ts tests/mutation-preview.test.ts \
  tests/mutation-preview-properties.test.ts tests/preview-explanation.test.ts \
  tests/architecture.test.ts tests/contract-documentation.test.ts
```

PASS — 6 files, 148 tests.

| Suite | Tests | Covers |
| --- | --- | --- |
| `read-only-ports` | 20 | Every refused primitive, every read passed through |
| `mutation-preview` | 5 | Preview equals the committed plan; blocked and no-op verdicts |
| `mutation-preview-properties` | 17 | Determinism, invalidation, divergence naming |
| `preview-explanation` | 6 | Redaction, ordering, evidence, blocked reporting |

## What the tests changed about the design

The design claimed precondition invalidation needed no new machinery, because
every operation already carries the fingerprint its destination held and the
transaction boundary already refuses a plan whose destinations moved. The
property test refuted it: an apply re-decides from current state rather than
replaying a plan, so a moved destination produces a *different* valid decision
and the apply commits that one, substituting work the person who read the
preview never saw.

`ApplyPlanOptions.expectPreview` was added in response, and the design document
was corrected in the same commit rather than left claiming something the tests
beside it disprove.

Two smaller findings came from coverage rather than from a failing assertion.
Comparing `operationId` inside the divergence check could never fail, because
the identifier is positional and two operations compared at the same index
always share it; it was removed rather than left looking like a comparison.
And the preview's rethrow of a non-typed failure turned out to be unreachable
through the ports, because the decision boundary sanitizes everything it can
raise — so it carries a coverage directive and an honest reason instead of a
test that would pass for the wrong cause.

## Acceptance criteria

| Criterion | Proven by |
| --- | --- |
| Dry-run causes zero filesystem, Git, lock, event, timestamp, or state mutation | `read-only-ports` refuses all 16 mutating primitives and `ids.next()`; `mutation-preview` asserts the storage snapshot is byte-identical after a preview |
| Applying an unchanged valid plan produces the effects described | `mutation-preview-properties` — "keeps an unchanged preview applicable" |
| Changed preconditions invalidate it | `mutation-preview-properties` — four divergence cases: destination moved, work already done, work appeared where none was found, different bytes at the same address |
| Secrets and full sensitive content are redacted while hashes/provenance remain useful | `preview-explanation` — a sentinel written through the plan appears in neither rendering, and its digest appears in both |
| A canonical operation plan with preconditions, decisions, effects, and recovery | `MutationPreview`; blocked verdicts carry the reason code and the artifact to act on |
| Planning separated from commit, reusing the same validated plan | `decideMutation` is called by both `previewPlan` and `applyPlan`; the digest equality test compares the preview against the committed manifest |
| Universal rendering in human and JSON modes | `previewResult` projects into the result envelope; both renderings asserted |
| Explanation primitives connecting decisions to reason codes and evidence | `preview-explanation`; the result mapping table in the architecture guide |
| `--dry-run` flag | **Deliberately absent** — see below |

## The absent flag

The frozen `go-v3-v0.6.5` inventory has exactly two global flags, `--expect`
and `--require-contract`, and none of its 59 command flags is `--dry-run`. The
string does not appear in the discovery inventory at all.

This repository already refused `--require-contract`, a flag that *is* frozen,
because the evidence did not establish which contract family it pinned:
accepting it would have invented a compatibility rule. A flag with no frozen
evidence is the clearer case of the same rule, and the staged bundle exposes no
mutating command for the flag to preview. It belongs to whichever issue
introduces the first one, which is also the issue that can prove it against a
real decision.

## Final repository gate

Each command was run separately from a clean tree.

| Command | Result |
| --- | --- |
| `npm test` | PASS — 111 files, 3348 tests |
| `npm run test:coverage` | PASS — 100% statements (4322/4322), branches (3004/3004), functions (662/662), lines (3843/3843) |
| `npm run format:check` | PASS |
| `npm run spellcheck` | PASS — 85 files, 0 issues |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run oracle:verify` | PASS |
| `npm run parity:check` | PASS — 0 / 400 (0.00%), unchanged |
| `npm run result:check` | PASS — 76 reasons, exits 0–5 |
| `npm run contracts:check` | PASS |
| `npm run differential:check` | PASS |
| `npm run build` | PASS |
| `npm run package:verify` | PASS |

Parity is unchanged at 0 / 400. This issue delivers runtime semantics, not a
command surface, so no frozen parity row moves.
