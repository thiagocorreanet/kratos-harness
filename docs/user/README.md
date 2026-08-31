# Kratos user documentation

Kratos is a local, deterministic development harness. A model or host proposes
work, the embedded runtime decides whether the transition is legal, and the
event log preserves the proof.

Read the guides in this order:

1. [Quickstart](quickstart.md)
2. [Concepts and architecture](concepts.md)
3. [Commands](commands.md)
4. [Configuration and `.brain`](configuration-and-state.md)
5. [Claude Code, Codex, and Google Antigravity](hosts.md)
6. [Migration, upgrades, and recovery](migration-and-recovery.md)
7. [Security and troubleshooting](security-and-troubleshooting.md)
8. [Uninstall and state preservation](uninstall.md)
9. [Glossary and writing style](glossary-and-style.md)

The [complete trail example](../examples/complete-trail.md) shows both a
successful path and recoverable failures. Architecture decisions are under
[`docs/architecture`](../architecture/runtime-boundaries.md), and schemas are
the normative machine contracts.
