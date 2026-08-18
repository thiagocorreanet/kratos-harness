# Configuration and `.brain` state

## Configuration layers

Kratos resolves explicit command flags first, then project configuration, then
documented defaults. It rejects contradictory ownership or unsupported
contract versions instead of guessing.

The project configuration records plugin and host contracts, language, policy
mode, enabled hosts, and managed state paths. Secrets, tokens, prompts, and
private keys are prohibited.

## Managed layout

| Path | Ownership | Purpose |
| --- | --- | --- |
| `.brain/config.json` | Kratos-managed | Versioned project configuration |
| `.brain/events.jsonl` | Append-only | Canonical event history |
| `.brain/02-features/` | Managed state | Objectives, runs, and materialized snapshots |
| `.brain/approvals/` | Managed state | Content-bound decisions |
| `.brain/evidence/` | Managed metadata | Digests, classification, and references |
| `.brain/02-features/<feature>/runs/<run>/gaps/` | Managed state | One record per detected gap and the answer it carries |
| `.brain/02-features/<feature>/runs/<run>/gates.json` | Derived state | The facts the gates read, derived from the records |
| `.brain/migrations/` | Managed recovery | Plans, receipts, backups, and rollback records |
| `.claude/` | Mixed/managed sections | Claude Code integration |
| `.codex/` and `AGENTS.md` | Mixed/managed sections | Codex integration |

Commit configuration, events, and non-sensitive evidence metadata when project
policy requires an auditable trail. Ignore local dashboards, transient locks,
and sensitive external evidence. Never add a broad ignore rule that hides the
entire `.brain` directory without an explicit governance decision.

Managed markers protect user-authored content. Reconciliation preserves bytes
outside marked sections and reports a conflict before changing an ambiguous
file.
