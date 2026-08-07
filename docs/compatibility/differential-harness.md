# Go-to-TypeScript Differential Harness

## Current result

The differential harness executes one validated scenario in two independent
workspaces, captures process/filesystem/structured/Git observations, applies
only declared normalization, and reports stable field-level mismatches. It does
not modify the source checkout.

Public CI runs an original synthetic equality scenario:

```bash
npm run differential:check
```

The corpus contains one executable public self-test, two authorized live
bootstrap scenarios, and 12 planned PRD requirements. The public self-test
proves the harness; it is not Go parity evidence and does not change the current
`0 / 400 (0.00%)` parity result.

## Authorized live comparison

An authorized maintainer can compare the installed frozen Linux oracle with the
fresh TypeScript bundle:

```text
npm run build
node scripts/run-differential.mjs \
  --class live \
  --oracle <verified-go-v3-v0.6.5-binary> \
  --candidate dist/plugin/runtime/yoda.mjs
```

The runner verifies the oracle SHA-256 against the issue #9 baseline before it
loads or materializes a scenario. It never searches home directories or
downloads a binary.

The initial authorized run has a known mismatch while the TypeScript bundle
remains a bootstrap runtime:

| Scenario | Contracts | Result |
| --- | --- | --- |
| `live-version` | `CLI-ALIAS-VERSION`, `CLI-VERSION` | stdout byte count and digest differ |
| `live-help` | `CLI-ALIAS-HELP`, `CLI-HELP` | stdout byte count and digest differ |

The verified Go outputs retain their published issue #9 byte counts and
digests. No private help text is printed or checked in. Live comparison returns
nonzero until both sides satisfy the same golden observation.

## Exit contract

- Exit `0`: every selected executable scenario matches its golden observation
  on both sides.
- Exit `1`: at least one field differs; output contains scenario IDs, parity
  contract IDs, mismatch kinds, and JSON Pointers.
- Exit `2`: usage, corpus/schema, runner provenance, unsafe path, or internal
  harness validation failed. Selecting no runnable scenario is also Exit `2`,
  because an empty run proves nothing and must never be reported as a pass.

JSON is the default deterministic renderer. `--format human` prints one concise
line per scenario and mismatch pointer. Normal comparison failures use stdout;
usage and harness failures use stderr. Normal output contains no stack trace,
caller path, secret, or undisclosed stream content.

## Isolation and capture

Each side receives a separately materialized copy of the same fixture below an
external temporary root. The project, HOME, TMPDIR, and Git configuration are
isolated. Executables are spawned directly with a literal argument vector and
`shell: false`; arbitrary environment variables, `NODE_OPTIONS`, credentials,
and proxy configuration are not inherited.

Wall time and stdout/stderr bytes are bounded. Timeout or output overflow first
terminates the process group and then escalates to a forced kill 250 ms later;
the escalation is measured from that signal, so an overflowing run does not wait
out the full scenario timeout. Overflow keeps the retained prefix that fits
within the declared bound and classifies the run as `output_limit`; the reported
byte count, SHA-256, and any disclosed content always describe that same
retained prefix. Capture still runs after a nonzero exit, signal, timeout,
crash, or partial mutation. Both temporary roots are removed in `finally`, and
cleanup failure is a harness failure.

The canonical observation includes:

- process outcome, exit/signal, and stream byte/digest summaries;
- sorted before/after filesystem manifests and added/modified/deleted paths;
- selected canonical JSON state/result/event values;
- optional Git HEAD, refs, status, staged diff, and unstaged diff summaries.

Filesystem traversal uses `lstat` and never follows captured symlinks. Selected
JSON must remain a regular file whose resolved path is below the workspace.
Special files, unsafe links, malformed JSON, over-limit manifests, and
case-fold-colliding fixture paths fail explicitly.

## Normalization and disclosure

Normalization is scenario-owned and applied in declared order. The only
operations are selected CRLF-to-LF conversion, workspace-token replacement,
explicit JSON value tokens, keyed array sorting, and justified removal of one
field. Wildcards and regular-expression rewriting are unavailable.

Normalization cannot target process outcome/exit, result `status`, `exitCode`,
or `reasonCode`, filesystem mutations/unexpected files, or Git effects. These
are the decision-bearing fields of the universal result contract; rewriting one
would let a real behavioral difference be normalized away.

Reports default to digest-only stream and artifact summaries. A digest field may
show its digest; arbitrary string content is represented only by byte count and
SHA-256. When `disclosure.artifacts` is `digest`, each captured structured value
is compared as a single opaque digest rather than field by field, so a mismatch
names only the artifact pointer. Neither private key names nor private scalar
values from predecessor output can reach a report. Setting
`disclosure.artifacts` to `content` is the explicit opt-in that enables
field-level pointers, and it is reserved for original public fixtures.

Every mismatch names the affected parity contract IDs. A seeded difference
returns Exit `1`; there is no “expected difference means success” mode.

## PRD preservation

PRD stays `migration-only`. The corpus records 12 planned PRD requirements
covering all four frozen anchors without inventing golden output or copying
private expression:

- sufficient context and a completed WHAT/WHY artifact;
- insufficient context, `needs_input`, blocking questions, and no artifact;
- blocking versus deferred questions;
- adaptive 5 Whys applied and skipped;
- probable root cause with retained uncertainty;
- adaptive 5W2H applied and skipped;
- invalid structured output and fail-closed publication;
- lineage drift and stale approval invalidation;
- traceable spec revision;
- content-bound approval.

Planned entries contain requirement metadata but no executable path or golden
observation. They become live only after an authorized publication-safe oracle
capture exists and the TypeScript PRD driver can execute the same input. PRD
parity still requires unit, differential, integration, and E2E evidence before
the matrix can grant credit.

## Fixture contract

Executable scenarios are closed JSON documents validated by
[`differential-scenario.v1.schema.json`](../../schemas/compatibility/differential-scenario.v1.schema.json).
Their golden observations conform to
[`differential-observation.v1.schema.json`](../../schemas/compatibility/differential-observation.v1.schema.json).

Paths are POSIX-style relative names. Absolute paths, URLs, backslashes,
traversal segments, empty segments, NUL/control characters, duplicates, and
case-fold collisions fail before workspace mutation. A scenario contains at
most 256 entries, 4 MiB of materialized UTF-8 input, 30 seconds of wall time,
and 1 MiB per process stream.
