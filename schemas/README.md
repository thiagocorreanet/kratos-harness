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
  which adds `profile.config_migration_required`;
- [`reason-codes.v1.10.json`](../packages/contracts/catalogs/reason-codes.v1.10.json),
- [`reason-codes.v1.11.json`](../packages/contracts/catalogs/reason-codes.v1.11.json),
  the current revision, which adds `blocked.stop_loss_rejections`.
  the current revision, which adds the curated-memory refusal and recovery
  reasons.

The state family contains:

- [`acceptance-criteria-snapshot.v1.schema.json`](state/acceptance-criteria-snapshot.v1.schema.json);
- [`acceptance-verdict.v1.schema.json`](state/acceptance-verdict.v1.schema.json);
- [`project-config.v1.schema.json`](state/project-config.v1.schema.json);
- [`project-config.v1.1.schema.json`](state/project-config.v1.1.schema.json);
- [`project-config.v1.2.schema.json`](state/project-config.v1.2.schema.json), the
  configuration with closed per-artifact language policy;
- [`project-config.v1.3.schema.json`](state/project-config.v1.3.schema.json), the
  configuration with complete project-profile answers;
- current [`project-config.v1.4.schema.json`](state/project-config.v1.4.schema.json),
  which requires the closed partial `gateModes` map and optionally carries the
  positive `acceptanceAttemptCeiling` override;
- [`requirement-discovery.v1.schema.json`](state/requirement-discovery.v1.schema.json),
  the applied/skip outcomes embedded in a requirement document;
- [`snapshot.v1.schema.json`](state/snapshot.v1.schema.json);
- [`event.v1.schema.json`](state/event.v1.schema.json);
- [`event.v1.1.schema.json`](state/event.v1.1.schema.json), the event revision
  that introduced runtime-selected and nullable host-observed execution metadata;
- [`event.v1.2.schema.json`](state/event.v1.2.schema.json), which adds
  run-frozen limits and acceptance-decision metadata;
- [`event.v1.3.schema.json`](state/event.v1.3.schema.json), which adds
  repair-resolution and specification-restart metadata;
- current [`state.event@1.4.0`](state/event.v1.4.schema.json), which adds
  the persisted legacy-policy upgrade boundary;
- [`repair-loop-stop.v1.schema.json`](state/repair-loop-stop.v1.schema.json) and
  current [`repair-loop-stop.v1.1.schema.json`](state/repair-loop-stop.v1.1.schema.json),
  [`repair-resolution.v1.schema.json`](state/repair-resolution.v1.schema.json)
  and current [`repair-resolution.v1.1.schema.json`](state/repair-resolution.v1.1.schema.json),
  plus [`repair-restart.v1.schema.json`](state/repair-restart.v1.schema.json),
  the immutable repair artifacts; the current stop and resolution schemas
  reject whitespace-only human text;
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
- [`curated-memory.v1.1.schema.json`](state/curated-memory.v1.1.schema.json),
  which adds classification, dependency, observation counts, dates, and scored
  archive evidence without changing predecessor bytes.

The host family contains
[`adapter-message.v1.schema.json`](host/adapter-message.v1.schema.json) and the
current [`adapter-message.v1.1.schema.json`](host/adapter-message.v1.1.schema.json),
[`host.doctor-report@1.0.0`](host/doctor-report.v1.schema.json), the read-only
effective-mode diagnostic report,
[`gap-proposal.v1.schema.json`](host/gap-proposal.v1.schema.json), and
[`init-answers.v1.schema.json`](host/init-answers.v1.schema.json) plus its
[`init-answers.v1.1.schema.json`](host/init-answers.v1.1.schema.json) and
[`init-answers.v1.2.schema.json`](host/init-answers.v1.2.schema.json), plus
[`init-answers.v1.3.schema.json`](host/init-answers.v1.3.schema.json) with
partial project-profile answers, plus
[`init-answers.v1.4.schema.json`](host/init-answers.v1.4.schema.json), which
sets a positive ceiling, clears it with `null`, or preserves it when omitted,
plus current [`host.init-answers@1.5.0`](host/init-answers.v1.5.schema.json),
which adds the optional closed per-gate `gateModes` map,
plus
[`operation-message.v1.schema.json`](host/operation-message.v1.schema.json) for
approval, hook, timeout, cancellation, and error delivery, and
[`agent-output.v1.schema.json`](host/agent-output.v1.schema.json),
[`agent-output.v1.1.schema.json`](host/agent-output.v1.1.schema.json),
[`agent-output.v1.2.schema.json`](host/agent-output.v1.2.schema.json), and
current [`host.agent-output@1.3.0`](host/agent-output.v1.3.schema.json),
the machine block one phase agent appends to its reply, plus
[`pre-tool-use.v1.schema.json`](host/pre-tool-use.v1.schema.json) for normalized
structured file mutations, and
[`phase-handoff.v1.1.schema.json`](host/phase-handoff.v1.1.schema.json),
[`phase-handoff.v1.2.schema.json`](host/phase-handoff.v1.2.schema.json), and
[`phase-handoff.v1.3.schema.json`](host/phase-handoff.v1.3.schema.json), plus
current [`host.phase-handoff@1.4.0`](host/phase-handoff.v1.4.schema.json)
for the digest-bound resolved assignment, acceptance attempt context, and
effective gate-failure trace. The current memory schemas are
[`host.memory-capture@1.2.0`](host/memory-capture.v1.2.schema.json),
[`host.memory-change@1.4.0`](host/memory-change.v1.4.schema.json),
[`host.memory-curation@1.4.0`](host/memory-curation.v1.4.schema.json), and
[`host.memory-migration@1.4.0`](host/memory-migration.v1.4.schema.json).
See the
[agent output contract](../docs/architecture/agent-output-contract.md) for the
delimiter, the envelope, and the extraction rules. The
current registry format is
[`contract-manifest.v1.9.schema.json`](contracts/contract-manifest.v1.9.schema.json).
The immutable predecessors remain
[`contract-manifest.v1.8.schema.json`](contracts/contract-manifest.v1.8.schema.json),
[`contract-manifest.v1.7.schema.json`](contracts/contract-manifest.v1.7.schema.json),
[`contract-manifest.v1.6.schema.json`](contracts/contract-manifest.v1.6.schema.json),
[`contract-manifest.v1.5.schema.json`](contracts/contract-manifest.v1.5.schema.json),
[`contract-manifest.v1.4.schema.json`](contracts/contract-manifest.v1.4.schema.json),
[`contract-manifest.v1.3.schema.json`](contracts/contract-manifest.v1.3.schema.json),
[`contract-manifest.v1.2.schema.json`](contracts/contract-manifest.v1.2.schema.json),
and [`contract-manifest.v1.1.schema.json`](contracts/contract-manifest.v1.1.schema.json).

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
