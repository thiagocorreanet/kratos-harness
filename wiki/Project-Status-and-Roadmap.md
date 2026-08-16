# Project status and roadmap

Kratos is an experimental development snapshot. The repository contains a large
implemented foundation, but implementation is not the same as externally
accepted evidence.

## Implemented foundation

- Strict TypeScript workspace and deterministic source-first build.
- Versioned contracts, schemas, reason catalog, and universal results.
- CLI registry, structured output, and project discovery.
- Project initialization and managed-section preservation.
- Objective lifecycle and six-phase event-sourced workflow.
- Ordered gates, approvals, evidence, lineage, handoff, and completion.
- Append-only event integrity and deterministic snapshot replay.
- Atomic transactions, persistent journal, fault recovery, leases, and fencing.
- Typed read-only Git observation.
- Migration planning, receipt, rollback, audit, repair preview, evidence bundle,
  and static dashboard.
- Codex and Claude Code package assembly using the same runtime policy.
- Differential harness, compatibility inventory, quality budgets, and community
  governance documents.

## External graduation evidence still pending

- Behavioral parity with Go v3: `0 / 400` in the public inventory.
- Representative signed-in Codex and Claude Code end-to-end runs.
- Public-beta pilots with recorded go/no-go evidence.
- Protected release configuration and exercised rollback.
- Published checksums, SBOM, and provenance for a public release.
- Human approval to promote through Preview, Beta, and Stable.

## Known current inconsistencies

These findings describe the analyzed workspace, not a permanent project promise:

1. The complete `npm run verify` path is not green.
2. Generated TypeScript contracts drift from current schemas.
3. Existing-run `start` retry reads operation history from the wrong object
   location and fails its idempotency test.
4. Three extension tests import Kratos functions from `node:crypto`.
5. CI contract tests do not match the current workflow set and permissions.
6. Some command-routing, host-package, and schema-bundle documentation has
   drifted from the current build.
7. Host negotiation and delivery primitives are broader than the connected
   `hook` command.
8. Post-1.0 extensions are isolated modules, not stable connected commands.
9. Repository remote and policy links do not consistently use the same final
   repository name.

See the [risk catalog](../docs/architecture/system-architecture.md#21-risks-debt-and-contradictions)
for evidence and impact.

## Maturity model

| Stage | Meaning |
| --- | --- |
| Experimental | Architecture and contracts are being proven; no production claim |
| Preview | Reproducible core flows and host evidence are available to early evaluators |
| Beta | Compatibility, pilots, security, and release controls meet published gates |
| Stable | Human-approved, regression-governed release with sustained evidence |

No calendar date or feature demo promotes Kratos. Promotion is based on the
evidence gates in the [maturity roadmap](../ROADMAP.md).

## How to help

High-value contribution areas include:

- resolve contract-generation drift;
- repair workflow retry idempotency;
- align CI definitions and contract tests;
- strengthen connected host protocol behavior;
- add authorized host E2E evidence;
- close parity rows with reproducible differential observations;
- reduce lock/transaction complexity without weakening invariants;
- reconcile public naming and publication metadata.

Before selecting work, read [Contributing and governance](Contributing-and-Governance.md)
and the [delivery ledger](../KRATOS_BACKLOG.md).
