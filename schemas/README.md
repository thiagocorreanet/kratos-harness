# Schemas

This directory owns Mestre Yoda's versioned public runtime contracts. These
machine-readable artifacts establish wire shapes and compatibility boundaries;
they do not make the current harness runtime usable.

The universal runtime-result family contains:

- [`result.v1.schema.json`](result.v1.schema.json), the closed result envelope;
- [`reason-catalog.v1.schema.json`](reason-catalog.v1.schema.json), the reason
  policy entry shape;
- [`reason-codes.v1.json`](../packages/contracts/catalogs/reason-codes.v1.json),
  the immutable 76-entry revision 1.0 ledger;
- [`reason-codes.v1.1.json`](../packages/contracts/catalogs/reason-codes.v1.1.json),
  which adds six plugin, state, and host compatibility reasons.

The state family contains:

- [`project-config.v1.schema.json`](state/project-config.v1.schema.json);
- [`snapshot.v1.schema.json`](state/snapshot.v1.schema.json);
- [`event.v1.schema.json`](state/event.v1.schema.json);
- [`approval.v1.schema.json`](state/approval.v1.schema.json);
- [`evidence.v1.schema.json`](state/evidence.v1.schema.json);
- [`lock.v1.schema.json`](state/lock.v1.schema.json);
- [`migration.v1.schema.json`](state/migration.v1.schema.json).

The host family contains
[`adapter-message.v1.schema.json`](host/adapter-message.v1.schema.json), and the
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
