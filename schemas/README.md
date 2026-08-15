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
  the current workflow and diagnosis revision.

The state family contains:

- [`project-config.v1.schema.json`](state/project-config.v1.schema.json);
- [`snapshot.v1.schema.json`](state/snapshot.v1.schema.json);
- [`event.v1.schema.json`](state/event.v1.schema.json);
- [`approval.v1.schema.json`](state/approval.v1.schema.json);
- [`evidence.v1.schema.json`](state/evidence.v1.schema.json);
- [`feature.v1.schema.json`](state/feature.v1.schema.json);
- [`lock.v1.schema.json`](state/lock.v1.schema.json);
- [`migration.v1.schema.json`](state/migration.v1.schema.json);
- [`transaction-manifest.v1.schema.json`](state/transaction-manifest.v1.schema.json);
- [`transaction-progress.v1.schema.json`](state/transaction-progress.v1.schema.json).

The host family contains
[`adapter-message.v1.schema.json`](host/adapter-message.v1.schema.json) and
[`init-answers.v1.schema.json`](host/init-answers.v1.schema.json), plus
[`operation-message.v1.schema.json`](host/operation-message.v1.schema.json) for
approval, hook, timeout, cancellation, and error delivery. The
registry format is
[`contract-manifest.v1.schema.json`](contracts/contract-manifest.v1.schema.json).

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
