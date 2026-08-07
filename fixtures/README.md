# Fixtures

This directory owns stable compatibility inputs and golden scenarios shared by
differential, contract, migration, and black-box tests.

Fixture provenance and the Go-to-TypeScript compatibility policy are specified
by the
[Yoda Observable Architecture Specification](../docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md).

The [`contracts/v1`](contracts/v1) directory contains valid current examples:

- `project-config.json`;
- `snapshot.json`;
- `event.json`;
- `approval.json`;
- `evidence.json`;
- `lock.json`;
- `migration.json`;
- `adapter-message.json`.

Its `version-cases.json` table covers current, previous, future, malformed,
untrimmed, non-string, and missing family identities. These fixtures are
independently authored public examples; they do not reproduce private Go v3
payloads.
