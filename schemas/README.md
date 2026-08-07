# Schemas

This directory owns Mestre Yoda's versioned public runtime contracts. It will
contain machine-readable input, output, state, event, and configuration schemas
introduced by the compatibility-contract work.

The first published family is the universal runtime-result contract:

- [`result.v1.schema.json`](result.v1.schema.json) defines the closed result and
  evidence-reference wire shape;
- [`reason-catalog.v1.schema.json`](reason-catalog.v1.schema.json) defines the
  reason-policy ledger shape;
- [`reason-codes.v1.json`](../packages/contracts/catalogs/reason-codes.v1.json)
  is the complete version `1.0.0` ledger.

The catalog contract version is independent of the package version. Issue
[#12](https://github.com/thiagocorreanet/mestre-yoda/issues/12) owns the
remaining plugin, state, and host schema families. The canonical ownership and
compatibility rules live in the
[Yoda Observable Architecture Specification](../docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md).
