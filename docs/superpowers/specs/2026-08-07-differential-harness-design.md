# Golden-Fixture Differential Harness Design

- Status: Approved
- Decision date: 2026-08-07
- Tracking issue: [#13](https://github.com/thiagocorreanet/mestre-yoda/issues/13)
- Parent epic: [#8](https://github.com/thiagocorreanet/mestre-yoda/issues/8)
- Depends on: issues [#9](https://github.com/thiagocorreanet/mestre-yoda/issues/9), [#10](https://github.com/thiagocorreanet/mestre-yoda/issues/10), [#11](https://github.com/thiagocorreanet/mestre-yoda/issues/11), and [#12](https://github.com/thiagocorreanet/mestre-yoda/issues/12)
- Approval basis: maintainer-authorized autonomous recommendation

## 1. Purpose

Issue #13 creates the executable measurement boundary between frozen Go v3
release `go-v3-v0.6.5` and the TypeScript candidate. A versioned scenario must
be materialized twice, executed in two independent sandboxes, observed through
the same capture pipeline, normalized only by rules declared in that scenario,
and compared without modifying the source checkout.

The harness proves what is equal and reports what is different. It never turns
an expected mismatch, a missing runner, a normalized-away field, or a recorded
oracle observation into a parity claim. The current TypeScript runtime only
implements its bootstrap CLI, so this issue delivers the comparison machinery
and a representative initial corpus without claiming that the broader runtime
or PRD flow already exists.

## 2. Design choice

Three approaches were considered:

| Approach | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| CLI-specific comparator | Small first implementation | Cannot represent PRD, adapters, migrations, state, or non-CLI drivers | Rejected |
| Container per runner | Strong process isolation | Requires an image toolchain, complicates local and public CI, and does not improve deterministic fixture semantics | Rejected |
| Declarative scenarios plus process sandboxes | Works offline, supports any executable driver, and keeps capture and comparison runtime-neutral | Requires a strict scenario contract and careful path controls | Selected |

The selected approach separates four responsibilities:

1. a scenario contract describes redistributable inputs, invocation, expected
   observations, normalization, disclosure, and parity contract IDs;
2. an isolated runner creates a fresh workspace and process environment for
   one executable without using a shell;
3. an observer captures process, filesystem, state, event, and Git effects into
   one canonical result;
4. a comparator applies allowlisted normalization and emits stable field-level
   mismatches.

## 3. Repository layout

```text
compatibility/
└── fixtures/
    └── differential/v1/
        ├── corpus.json
        └── scenarios/*.json
packages/
└── differential/
    └── src/
        ├── capture.ts
        ├── compare.ts
        ├── index.ts
        ├── normalize.ts
        ├── runner.ts
        └── scenario.ts
scripts/
└── run-differential.mjs
schemas/
└── compatibility/
    ├── differential-observation.v1.schema.json
    └── differential-scenario.v1.schema.json
tests/
├── differential-cli.test.ts
├── differential-comparator.test.ts
├── differential-contract.test.ts
└── differential-runner.test.ts
docs/compatibility/
└── differential-harness.md
```

The package contains reusable TypeScript primitives. The CLI is a thin public
entry point. Checked-in fixtures contain only original synthetic project data
and public metadata; no private predecessor code, prose, schemas, fixtures, or
help output is copied.

## 4. Scenario contract

Every scenario declares:

- `schemaVersion`, fixed at `1`;
- a stable lowercase `id` and nonempty `parityContractIds` from the issue #10
  matrix;
- `workspace`, a closed list of relative directories, UTF-8 files, executable
  files, and safe symbolic links to materialize below the sandbox root;
- `invocation`, containing literal arguments, optional UTF-8 stdin, a bounded
  timeout, and an allowlisted environment overlay;
- `capture`, selecting filesystem roots, JSON state/event files, and Git
  observations that are meaningful for the scenario;
- `normalization`, a closed list of field-scoped transformations;
- `disclosure`, which defaults all process and artifact contents to digest-only
  mismatch reporting;
- `expected`, a closed set of golden assertions for process outcome, stream
  bytes or digests, required and forbidden mutations, structured result fields,
  and Git effects.

Paths are POSIX-style repository-relative names. Empty segments, `.`, `..`,
backslashes, absolute paths, URLs, NUL, control characters, and paths escaping
through symbolic links are rejected before either workspace is created.
Duplicate and case-fold-colliding paths are invalid. Fixture files have
explicit size limits, and the full materialized workspace has a fixed limit.

Every scenario is an equality claim: both observations must satisfy the golden
assertions and must match each other after approved normalization. Seeded
differences live only in harness self-tests, must exit nonzero, and are never
valid matrix evidence. Golden assertions may use byte count and digest instead
of private or nondisclosable text.

## 5. Runner isolation and lifecycle

The CLI receives runner executables as explicit paths:

```text
node scripts/run-differential.mjs \
  --oracle <authorized-go-v3-binary> \
  --candidate <typescript-bundle> \
  --corpus compatibility/fixtures/differential/v1/corpus.json
```

It never searches home directories or downloads a runtime. The oracle path is
verified against the frozen Linux digest before a live Go comparison. The
candidate path is recorded by digest but may evolve between commits.

For each side, the runner:

1. creates a unique temporary root outside the repository;
2. materializes the same validated workspace without following links;
3. creates isolated `HOME`, `TMPDIR`, and Git configuration below that root;
4. spawns the executable directly with a literal argument vector, no shell,
   safe inherited platform variables, and only the declared environment
   overlay;
5. bounds wall time and stdout/stderr bytes, killing the process group on
   timeout or overflow;
6. captures observations even after nonzero exit, signal, timeout, crash, or
   partial mutation;
7. removes both roots in `finally`, reporting cleanup failure as a harness
   error.

The original repository is never the working directory and is not writable by
normal harness operations. The runner rejects scenario paths that identify it.
Tests additionally snapshot the developer checkout before and after execution.

## 6. Canonical observations

Both sides produce the same closed observation object:

- `process`: exit code or signal, timeout/crash classification, stdout and
  stderr byte counts, SHA-256 digests, and content only when disclosure allows;
- `filesystem`: a sorted manifest of relative path, type, mode class, size,
  digest, and safe link target, plus a before/after mutation classification;
- `structured`: selected JSON result, state, and event files parsed with exact
  JSON syntax validation and represented canonically;
- `git`: whether a repository exists, HEAD/ref identity, porcelain-v2 status,
  staged and unstaged patch digests, and a sorted ref manifest;
- `runner`: executable digest and bounded timing metadata that is recorded but
  excluded from parity comparison unless a scenario explicitly selects it.

Special files, sockets, devices, unsafe links, unreadable paths, manifest
overflow, invalid UTF-8 in a disclosed text field, and malformed selected JSON
are explicit observations or harness failures; they are never silently skipped.
Filesystem enumeration is deterministic and does not follow symlinks.

## 7. Normalization policy

Normalization is intentionally weaker than arbitrary search-and-replace. The
allowed operations are:

- convert CRLF to LF for an explicitly selected text field;
- replace the two generated sandbox roots with the token `<WORKSPACE>`;
- replace values at explicit JSON Pointers with a named stable token, such as
  `<TIMESTAMP>` or `<DURATION>`;
- sort an explicitly selected JSON array only when the scenario declares the
  stable identity key proving that order is not contractual;
- remove one explicitly selected observation field whose nondeterminism and
  justification are both named.

Rules are applied in declared order and included in the report. Wildcard JSON
Pointers, regular expressions, recursive key removal, rounding unknown numeric
fields, broad path stripping, and transformations of exit/reason/status fields
are forbidden. Normalization cannot erase an unexpected file, a mutation
classification, a process outcome, or a Git change.

## 8. Comparison and diagnostics

The comparator recursively compares canonical observations by type and emits a
stable sorted mismatch list. Each item contains:

- JSON Pointer to the differing field;
- mismatch kind such as missing, unexpected, type, value, timeout, crash, or
  partial mutation;
- oracle and candidate value summaries permitted by disclosure policy;
- affected parity contract IDs;
- scenario ID and normalization rules that touched the field.

Digest-only fields report byte count and digest, not private text. A normal
comparison mismatch exits `1`; malformed fixture, unsafe path, invalid option,
unverified oracle, or internal harness error exits `2`. A matching corpus exits
`0`. Reports use deterministic JSON by default and an optional concise human
renderer. They contain no caller-supplied absolute paths, environment secrets,
stack traces, or workspace contents beyond explicit disclosure.

## 9. Public CI and authorized oracle execution

Public CI cannot contain the private Go binary. Therefore the repository gate
runs the complete harness self-test corpus with two original test drivers that
exercise the same runner boundary. This proves isolation, capture, comparison,
normalization, diagnostics, and nonzero failures without pretending to be Go
parity.

Authorized local verification supplies the installed binary whose digest is
already frozen by issue #9 and the freshly built TypeScript bundle. The initial
live corpus covers public-safe bootstrap behavior and produces a redacted
comparison summary. Current known TypeScript differences remain failures and
do not update issue #10 matrix rows to `parity`.

The checked-in corpus catalog records for each scenario whether it is:

- `self-test`, safe and mandatory in public CI;
- `live`, requiring the authorized oracle and candidate;
- `planned`, requirement-complete metadata blocked on a missing candidate
  behavior and therefore lacking an executable scenario path or golden output.

A planned entry names real parity contract IDs and explicit observable
requirements, but it is not an executable scenario. It has no invented golden
observation, is not executed, and cannot count as evidence. It becomes a live
entry only after authorized oracle capture can provide a complete,
publication-safe golden observation and a candidate driver exists.

## 10. PRD compatibility boundary

PRD remains the highest-priority compatibility boundary. The design reserves
dedicated scenarios for all four frozen anchors:

- `PRD-RESEARCHER`;
- `PRD-OUTPUT-SCHEMA`;
- `PRD-PROBLEM-DISCOVERY`;
- `PRD-TEMPLATE`.

The planned PRD corpus covers sufficient and insufficient context, the
no-artifact `needs_input` outcome, blocking and deferred questions, adaptive
5 Whys applied and skipped, probable-root-cause handling, adaptive 5W2H applied
and skipped, invalid structured output, lineage drift, spec revision, and
content-bound approval. Comparisons include the structured result, whether an
artifact exists, artifact digest, state/event effects, and WHAT/WHY ownership.

Private prompt, reference, schema, and template expression stays outside the
public repository. Authorized runners may consume an external projection only
through explicit paths and may publish digests and permitted synthetic
observations only. The current manifest keeps `prd-output.schema.json` at
`migration-only`; issue #13 does not change it until the TypeScript PRD driver
exists and every required scenario passes byte-preserving differential checks.

This preserves the maintainer requirement that the new PRD process be 100%
compatible with the old process while preventing a premature parity claim.

## 11. Tests and evidence

Development is test-first. Required self-tests prove:

1. exact equality across process, filesystem, structured state/events, and Git;
2. an approved timestamp/path/newline normalization;
3. an unexpected file with a field-level path;
4. timeout classification and child-process termination;
5. crash/signal classification;
6. partial mutation retained after failure;
7. deterministic mismatch ordering and nonzero exit;
8. safe-path, symlink, case-collision, size, output, and disclosure limits;
9. source repository immutability and temporary-root cleanup;
10. matrix contract IDs and corpus classifications are real and unique;
11. a wrong oracle digest fails before scenario materialization;
12. diagnostic mismatches cannot become parity evidence.

The live evidence command runs the representative initial corpus against
`/home/thiago-botelho/.betaup/bin/yoda` and the newly built bundle. Its report
must identify the verified oracle as `go-v3-v0.6.5`, identify the candidate by
digest, remain redacted, and return nonzero for current behavioral differences.
That nonzero result is expected evidence of an honest harness, not a CI pass.

Repository verification adds a public `npm run differential:check` self-test
gate before the build/package checks. The final delivery also runs the complete
`npm run verify`, documentation lint, link validation, and Actionlint.

## 12. Scope boundaries

This issue does not implement missing runtime commands, PRD generation, host
adapters, state migration, containers, network orchestration, platform-native
execution, performance benchmarking, or issue #14 distribution semantics. It
does not copy or publish private legacy content and does not award parity to
any row without the complete unit, differential, integration, and E2E evidence
required by issue #10.
