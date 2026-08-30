# Schemas

This directory owns Kratos's versioned public runtime contracts. These
machine-readable artifacts establish wire shapes and compatibility boundaries;
they are enforced by the runtime before domain use and persistence.

The universal runtime-result family contains:

- [`result.v1.schema.json`](result.v1.schema.json), the closed result envelope;
- [`reason-catalog.v1.schema.json`](reason-catalog.v1.schema.json), the reason
  policy entry shape;
- [`reason-codes.v1.json`](../packages/contracts/catalogs/reason-codes.v1.json),
  the immutable 76-entry revision 1.0 ledger;
- [`reason-codes.v1.1.json`](../packages/contracts/catalogs/reason-codes.v1.1.json),
  which adds six plugin, state, and host compatibility reasons;
- [`reason-codes.v1.2.json`](../packages/contracts/catalogs/reason-codes.v1.2.json),
  which adds `runtime.node_unsupported`;
- [`reason-codes.v1.3.json`](../packages/contracts/catalogs/reason-codes.v1.3.json),
  which adds `runtime.orientation_ok`;
- [`reason-codes.v1.5.json`](../packages/contracts/catalogs/reason-codes.v1.5.json),
  which adds checkable PRD structure failures;
- [`reason-codes.v1.6.json`](../packages/contracts/catalogs/reason-codes.v1.6.json),
  which adds `guard.path_escape` and `guard.target_uninspectable` for pre-write
  target inspection;
- [`reason-codes.v1.7.json`](../packages/contracts/catalogs/reason-codes.v1.7.json),
  which adds the eight fail-closed `model.*` routing,
  independence, handoff, execution, and configuration-migration reasons;
- [`reason-codes.v1.8.json`](../packages/contracts/catalogs/reason-codes.v1.8.json),
  which adds `policy.language_incomplete` and
  `policy.language_convention_mismatch_advisory`.
- [`reason-codes.v1.9.json`](../packages/contracts/catalogs/reason-codes.v1.9.json),
  the current revision, which adds the curated-memory refusal and recovery
  reasons.

The state family contains:

- [`acceptance-criteria-snapshot.v1.schema.json`](state/acceptance-criteria-snapshot.v1.schema.json);
- [`acceptance-verdict.v1.schema.json`](state/acceptance-verdict.v1.schema.json);
- [`project-config.v1.schema.json`](state/project-config.v1.schema.json);
- [`project-config.v1.1.schema.json`](state/project-config.v1.1.schema.json);
- [`project-config.v1.2.schema.json`](state/project-config.v1.2.schema.json), the
  current configuration with closed per-artifact language policy;
- [`requirement-discovery.v1.schema.json`](state/requirement-discovery.v1.schema.json),
  the applied/skip outcomes embedded in a requirement document;
- [`snapshot.v1.schema.json`](state/snapshot.v1.schema.json);
- [`event.v1.schema.json`](state/event.v1.schema.json);
- [`event.v1.1.schema.json`](state/event.v1.1.schema.json), the current event
  envelope with runtime-selected and nullable host-observed execution metadata;
- [`approval.v1.schema.json`](state/approval.v1.schema.json);
- [`evidence.v1.schema.json`](state/evidence.v1.schema.json);
- [`gap.v1.schema.json`](state/gap.v1.schema.json), one recorded gap and the
  answer it carries;
- [`gates.v1.schema.json`](state/gates.v1.schema.json), the derived facts the
  gates read;
- [`feature.v1.schema.json`](state/feature.v1.schema.json);
- [`feature-scope.v1.schema.json`](state/feature-scope.v1.schema.json), the
  ordered active-feature allow and deny glob record;
- [`guardrails.v1.schema.json`](state/guardrails.v1.schema.json), including
  optional project `writeBlocks` that extend immutable write blocks;
- [`lock.v1.schema.json`](state/lock.v1.schema.json);
- [`migration.v1.schema.json`](state/migration.v1.schema.json);
- [`migration.v1.1.schema.json`](state/migration.v1.1.schema.json), the current
  replacement migration and rollback receipt;
- [`transaction-manifest.v1.schema.json`](state/transaction-manifest.v1.schema.json);
- [`transaction-progress.v1.schema.json`](state/transaction-progress.v1.schema.json).
- [`curated-memory.v1.schema.json`](state/curated-memory.v1.schema.json), the
  committed confirmed-lesson and archive-tombstone ledger.

The host family contains
[`adapter-message.v1.schema.json`](host/adapter-message.v1.schema.json) and the
current [`adapter-message.v1.1.schema.json`](host/adapter-message.v1.1.schema.json),
[`gap-proposal.v1.schema.json`](host/gap-proposal.v1.schema.json), and
[`init-answers.v1.schema.json`](host/init-answers.v1.schema.json) plus its
[`init-answers.v1.1.schema.json`](host/init-answers.v1.1.schema.json) and
current [`init-answers.v1.2.schema.json`](host/init-answers.v1.2.schema.json)
per-artifact language policy revision, plus
[`operation-message.v1.schema.json`](host/operation-message.v1.schema.json) for
approval, hook, timeout, cancellation, and error delivery, and
[`agent-output.v1.schema.json`](host/agent-output.v1.schema.json), the machine
block one phase agent appends to its reply, plus
[`pre-tool-use.v1.schema.json`](host/pre-tool-use.v1.schema.json) for normalized
structured file mutations, and
[`phase-handoff.v1.1.schema.json`](host/phase-handoff.v1.1.schema.json) for the
digest-bound resolved assignment, plus the explicit v1.2
[`memory-capture.v1.2.schema.json`](host/memory-capture.v1.2.schema.json),
[`memory-change.v1.2.schema.json`](host/memory-change.v1.2.schema.json),
[`memory-migration.v1.2.schema.json`](host/memory-migration.v1.2.schema.json),
[`agent-output.v1.2.schema.json`](host/agent-output.v1.2.schema.json), and
[`phase-handoff.v1.2.schema.json`](host/phase-handoff.v1.2.schema.json)
contracts. The last two bind the phase-constrained curated-memory observation.
See the
[agent output contract](../docs/architecture/agent-output-contract.md) for the
delimiter, the envelope, and the extraction rules. The
current registry format is
[`contract-manifest.v1.3.schema.json`](contracts/contract-manifest.v1.3.schema.json).
The immutable predecessors remain
[`contract-manifest.v1.2.schema.json`](contracts/contract-manifest.v1.2.schema.json)
and
[`contract-manifest.v1.1.schema.json`](contracts/contract-manifest.v1.1.schema.json).

The compatibility test family contains the closed
[`differential-scenario.v1.schema.json`](compatibility/differential-scenario.v1.schema.json)
and
[`differential-observation.v1.schema.json`](compatibility/differential-observation.v1.schema.json)
contracts. They bound isolated inputs, capture selection, normalization,
disclosure, and golden observations; they do not claim runtime parity.
See the [contract versioning guide](../docs/compatibility/contract-versioning.md)
for compatibility windows, provenance, and PRD guarantees.

Run `npm run contracts:generate` after an intentional schema change and
`npm run contracts:check` to verify strict compilation, complete registration,
and generated TypeScript drift without modifying the checkout.
