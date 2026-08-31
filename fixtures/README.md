# Fixtures

[`feature-documents/complete`](feature-documents/complete) contains one filled,
host-neutral example for each generated feature document. These examples show
the required structure without defining the acceptance identifier grammar
owned by a later issue.

[`requirement-discovery`](requirement-discovery) contains complete PRDs for a
vague solution-shaped request, a simple demand that skips both techniques, and
a demand where both techniques run. Each embeds a valid current discovery
record, and the first is the worked example used by the architecture guide.

This directory owns stable compatibility inputs and golden scenarios shared by
differential, contract, migration, and black-box tests.

Fixture provenance and the Go-to-TypeScript compatibility policy are specified
by the
[Kratos Observable Architecture Specification](../docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md).

The [`contracts/v1`](contracts/v1) directory contains valid current examples:

- `project-config.json`;
- `requirement-discovery.json`;
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
- `agent-output.json`;
- `repair-loop-stop.json`;
- `repair-resolution.json`;
- `repair-restart.json`.

[`contracts/v1.1`](contracts/v1.1) adds the predecessor `agent-output.json`
fixture, plus current repair-stop and repair-resolution fixtures with non-blank
human text. [`contracts/v1.2`](contracts/v1.2) adds the current
`agent-output.json` fixture, the predecessor `phase-handoff.json` fixture, and
the workflow-v2 event fixture with run-frozen limits and acceptance decisions.
[`contracts/v1.3`](contracts/v1.3) adds the current `phase-handoff.json` fixture
and the predecessor event fixture for repair resolution and specification
restart. [`contracts/v1.4`](contracts/v1.4) adds the explicit policy-upgrade
event fixture plus project configuration and initialization-answer fixtures for
the optional acceptance attempt ceiling. Published predecessor fixtures remain
unchanged.

The [`contracts/v1.2`](contracts/v1.2) directory adds the explicit current
agent-output and phase-handoff curated-memory observations, plus the memory
capture, change, and migration proposals.

The [`agent-output/v1`](agent-output/v1) directory contains the agent output
corpus: one complete valid and one complete invalid Markdown reply per runtime
output under `valid/` and `invalid/`, and extraction-specific replies under
`replies/` covering a reply with no
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
