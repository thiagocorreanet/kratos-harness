# Fixtures

This directory owns stable compatibility inputs and golden scenarios shared by
differential, contract, migration, and black-box tests.

Fixture provenance and the Go-to-TypeScript compatibility policy are specified
by the
[Kratos Observable Architecture Specification](../docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md).

The [`contracts/v1`](contracts/v1) directory contains valid current examples:

- `project-config.json`;
- `snapshot.json`;
- `event.json`;
- `approval.json`;
- `evidence.json`;
- `gap.json`;
- `gates.json`;
- `lock.json`;
- `migration.json`;
- `transaction-manifest.json`;
- `transaction-progress.json`;
- `adapter-message.json`;
- `init-answers.json`;
- `gap-proposal.json`;
- `operation-approval.json`;
- `operation-hook.json`;
- `operation-timeout.json`;
- `operation-cancellation.json`;
- `operation-error.json`;
- `agent-output.json`.

The [`agent-output/v1`](agent-output/v1) directory contains the agent output
corpus: one valid and one invalid payload per phase agent under `valid/` and
`invalid/`, and whole agent replies under `replies/` covering a reply with no
machine block, a malformed block, a block followed by more prose, a decoy whose
ordinary fenced example must be ignored, and a schema-invalid block.

Its `version-cases.json` table covers current, previous, future, malformed,
untrimmed, non-string, and missing family identities. These fixtures are
independently authored public examples; they do not reproduce private Go v3
payloads.

The executable golden corpus lives at
[`compatibility/fixtures/differential/v1`](../compatibility/fixtures/differential/v1).
It contains one public synthetic self-test, digest-only live help/version
scenarios, and requirement-only PRD plans. Planned entries have no executable
path or invented golden output. See the
[differential harness guide](../docs/compatibility/differential-harness.md).
