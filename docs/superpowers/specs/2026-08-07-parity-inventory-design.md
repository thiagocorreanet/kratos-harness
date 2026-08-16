# Exhaustive Go v3 Parity Inventory Design

- Status: Approved
- Decision date: 2026-08-07
- Tracking issue: [#10](https://github.com/thiagocorreanet/kratos-harness/issues/10)
- Parent epic: [#8](https://github.com/thiagocorreanet/kratos-harness/issues/8)
- Depends on: [frozen Go v3 v0.6.5 baseline](../../compatibility/go-v3-v0.6.5-baseline.md)
- Approval basis: maintainer-authorized autonomous recommendation

## 1. Purpose

Issue #9 proved which private Go release is authoritative. This change defines
what must be reproduced from that release, item by item, without publishing its
private implementation. It creates a living traceability matrix whose
completeness and parity percentage are deterministic rather than editorial.

The inventory is a compatibility planning contract. It does not implement Go
behavior, create golden payloads, or declare parity. Every row starts without
parity credit until later work supplies passing evidence.

## 2. Design choice

Three representations were considered:

| Approach | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| Markdown-only table | Easy to browse and edit | Weak typing, fragile references, and ambiguous percentage calculation | Rejected |
| Inventory generated from the private repository in CI | Always source-derived | Public CI cannot depend on private access and would violate the offline boundary | Rejected |
| Frozen discovery snapshot plus living contract matrix | Separates source completeness from implementation progress; works offline; supports authorized private revalidation | Requires a small original checker and two coordinated catalogs | Selected |

The selected model has three layers:

1. a metadata-only discovery snapshot records every mechanically discoverable
   legacy surface at the frozen tag;
2. a living matrix maps every discovery key and every manually identified
   behavioral contract to a stable compatibility row;
3. one checker validates both layers, verifies evidence references, and reports
   objective parity.

## 3. Files and ownership

```text
compatibility/inventory/go-v3-v0.6.5/
├── discovery.json       # immutable, source-derived names and paths only
└── matrix.json          # living compatibility rows and progress
scripts/
└── check-parity-inventory.mjs
tests/
├── parity-inventory-contract.test.ts
└── parity-inventory-checker.test.ts
docs/compatibility/
└── parity-inventory.md
```

`discovery.json` is tied to the immutable Go tag and changes only if the
capture algorithm was wrong. `matrix.json` evolves as specifications,
implementations, fixtures, and tests land. The checker is original public code
and treats both files as untrusted input.

## 4. Discovery snapshot

The snapshot contains no source text, prompt text, schema bodies, fixture
payloads, help prose, customer data, private URL, or local path. It records only
the public oracle ID, discovery algorithm version, source-relative references,
names, counts, and a provenance ID.

The discovery namespaces are:

- `commands`, `command_forms`, `aliases`, `global_flags`, `flags`,
  `io_contracts`, `exit_codes`, and `retired_commands`: the exhaustive CLI
  grammar, command-scoped options, stream boundaries, process outcomes, and
  intentionally unavailable phase commands;
- `packages`: every non-test Go package in the frozen module, including both
  binaries and embedded-data packages;
- `schemas`: every embedded schema filename;
- `generated_files`: every project file or managed view produced by init,
  Codex agent generation, view synchronization, migration, or trail execution;
- `plugin_files`: manifests, skills, agents, providers, hook declarations, and
  embedded templates shipped by the distribution;
- `workflows`: CI, deep verification, distribution synchronization, release,
  and runner-smoke workflows;
- `reason_codes`: stable decision, loop, judge, guard, completion, and recovery
  codes discoverable as closed constants;
- `phases`, `human_gates`, and `state_transitions`: the ordered SDD trail and
  its explicit approval or lifecycle boundaries;
- `benchmarks` and `documentation`: executable benchmark families and public
  operational contract families.

Each entry has a stable discovery key such as `commands.objective` or
`schemas.prd-output.schema.json`, plus one or more repository-relative legacy
references. Names and paths are metadata permitted by the issue #9 publication
boundary; private file contents remain denied.

The checker supports an optional paired `--source <checkout> --dist-source
<checkout>` mode. It requires clean detached checkouts at both immutable
commits, reruns deterministic source and distribution discovery, verifies all
catalog references against those trees, compares the sets, and emits only
category counts and pass/fail status. The default public mode is offline and
never searches for a private checkout. A pinned semantic digest makes the
published discovery snapshot immutable and prevents its own references from
becoming a self-authorizing allowlist.

## 5. Matrix row contract

Every row contains these mandatory fields:

```json
{
  "id": "CLI-OBJECTIVE",
  "category": "command",
  "title": "Create or replace the active objective",
  "legacy_refs": ["cmd/yoda/trailcli.go#runObjective"],
  "covers": ["commands.objective"],
  "expected_behavior": "Preserve the requested objective and apply the documented replace and no-Brain behavior.",
  "priority": "P0",
  "typescript_owner": "@mestre-yoda/runtime",
  "verification": {
    "unit": { "id": "UNIT-CLI-OBJECTIVE", "status": "planned", "path": null },
    "differential": { "id": "DIFF-CLI-OBJECTIVE", "status": "planned", "path": null },
    "integration": { "id": "INT-CLI-OBJECTIVE", "status": "planned", "path": null },
    "e2e": { "id": "E2E-CLI-OBJECTIVE", "status": "planned", "path": null }
  },
  "status": "not_started",
  "intentional_difference": null
}
```

Contract IDs are uppercase ASCII and never reused. Prefixes identify the
domain: `CLI`, `STATE`, `FILE`, `SCHEMA`, `SKILL`, `AGENT`, `PROVIDER`, `HOOK`,
`PKG`, `BENCH`, `CI`, `RELEASE`, `DOC`, and `PRD`. One row may cover several
discovery keys only when they form one indivisible observable contract; every
key must be covered exactly once.

`expected_behavior` describes externally relevant behavior without copying
private expression. Command rows state observable output, state, failure, and
edge results. Flag rows state type, default, exact effect, parsing, and
precedence rather than deferring those facts to “legacy behavior.”
`legacy_refs` identify the source of the observation.
`typescript_owner` is one of `@mestre-yoda/contracts`,
`@mestre-yoda/runtime`, `@mestre-yoda/adapters`, or `plugin`.

## 6. Verification and progress model

Every row, regardless of priority, names four stable verification cases:

- `unit`: isolated TypeScript behavior;
- `differential`: the same scenario executed against the frozen Go oracle and
  the TypeScript candidate;
- `integration`: interaction across the owning package boundary;
- `e2e`: final bundled runtime behavior in a clean project fixture.

Case status is `planned` or `passed`. A planned case has `path: null`. A passed
case must reference a repository-relative existing test or fixture path. Case
IDs are globally unique. This makes future evidence addressable without
creating empty placeholder tests today.

Row status is one of:

- `not_started`: no implementation claim;
- `in_progress`: implementation or evidence is incomplete;
- `parity`: all four cases passed and their paths exist;
- `intentional_difference`: a deliberate incompatibility approved by an
  accepted ADR, explained by an existing migration note, and proven by all four
  passed replacement-behavior cases.

P0 and P1 rows must also state concrete verification requirements for normal,
failure, and edge behavior in `expected_behavior`; generic statements such as
“works like legacy” are invalid. P2 rows follow the same evidence structure but
may describe a narrower non-critical contract.

## 7. Intentional incompatibilities

An intentional difference is not a free-form waiver. Its object must contain:

- an accepted public ADR path;
- an existing public migration-note path;
- a concise replacement behavior;
- maintainer approval evidence as a public issue or pull-request URL.

The project-local `.brain/` decision in ADR 0003 is the first known intentional
layout difference. The matrix records both the legacy sibling layout and the
replacement project-local layout, but it receives parity credit only after the
migration note and relevant tests exist. Missing or invalid approval artifacts
fail completeness checking.

## 8. Objective completeness and parity

Completeness is binary. The checker fails when:

- a required field, category, discovery namespace, or provenance value is
  missing or unknown;
- a discovery key is uncovered or covered more than once;
- a row, verification case, or legacy reference is duplicated;
- a source-relative reference is absolute, traverses upward, or names an
  unknown frozen file;
- a P0/P1 row lacks explicit normal, failure, or edge requirements;
- a passed case points to a missing public file;
- a parity row lacks four passed evidence cases;
- an intentional difference lacks its complete approval chain;
- a URL, local path, credential marker, payload field, or private content is
  introduced into the discovery snapshot.

Parity uses no weighting or subjective partial credit:

```text
credited rows = rows with status parity and four passed cases
              + valid intentional_difference rows with four passed cases
parity percent = credited rows / all rows * 100
```

The checker reports integer numerator and denominator plus a percentage rounded
to two decimal places. It also reports the same figures for P0 and P1. The
initial matrix must report `0 / N (0.00%)`; inventory completion is not behavior
parity.

## 9. Inventory scope and granularity

The initial matrix accounts for all required issue categories:

- CLI dispatch, aliases, flags, stdin/stdout/stderr routing, and exit classes;
- trail phases, gates, state transitions, locks, transactions, recovery,
  budgets, approvals, evidence, views, and migration;
- all Go packages and closed reason-code families;
- every schema and generated or managed project file;
- skills, agents, providers, host adapters, hooks, and plugin manifests;
- init, migration, benchmark, CI, distribution, release, and documentation
  contracts;
- PRD research, structured result, no-write `needs_input`, completed artifact,
  adaptive discovery, language, and WHAT/WHY boundaries as dedicated P0 rows.

Rows are behavioral units, not a copy of every Go function or test. Package
rows guarantee ownership and traceability for internal surfaces; behavior rows
capture externally observable contracts. This avoids both false completeness
from a short command list and an unusable one-row-per-function catalog.

## 10. Checker interface and failures

The public command is:

```text
npm run parity:check
```

Optional authorized revalidation is:

```text
node scripts/check-parity-inventory.mjs \
  --source <authorized-source-checkout> \
  --dist-source <authorized-distribution-checkout>
```

`--matrix` and `--discovery` accept explicit files for mutation tests. Private
source and distribution options must appear together. Options must be
option/value pairs and unknown options fail with exit 2. Validation failures
use exit 1 and concise public IDs; successful checks use exit 0. The checker
never prints private file contents or caller-supplied paths.

## 11. Testing strategy

Tests are contract-first:

1. a matrix contract test fails while catalogs are absent, then proves required
   coverage, exact identity, PRD priority, verification shapes, and initial
   zero-percent status;
2. checker mutation tests remove a row or verification case, duplicate a
   discovery mapping or legacy reference, falsify a passed evidence path,
   weaken a P0 requirement, remove a priority population, invent a source
   reference, and inject Unix or Windows absolute paths; every mutation fails;
3. an authorized private run cross-checks command/package/schema/plugin/file
   discovery at the frozen tag;
4. the repository verification chain runs the offline checker before build and
   packaging.

The PR records the private cross-check only as identities, counts, and status.

## 12. Compatibility and publication boundary

This change is additive and changes no current runtime behavior. It freezes the
worklist that subsequent issues must satisfy. Issue #11 owns universal result,
reason, and exit-code semantics; issue #12 owns versioned runtime schemas; issue
Issue #13 owns executable golden payloads and differential execution. This issue
names those requirements without preempting their contract designs.

All public implementation, tests, catalog organization, and prose are original.
Private Go v3 contributes only observable names, source-relative references,
counts, identities, and hashes. The checker remains fail-closed against private
payload publication.
