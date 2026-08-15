---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow through its embedded runtime.
---

# Kratos for Codex

Resolve this skill's own directory and invoke
`node scripts/kratos.mjs <arguments>`. The script is only a plugin-relative
bridge to the installed runtime. Do not copy it into the project, depend on a
global binary, or implement workflow policy in this skill.

Run a JSON handshake first, pass an explicit project `--root`, and relay the
runtime's result, reason code, evidence, and recovery unchanged. The normal
trail is `objective`, `start`, `continue`, content-bound `approve`,
`evidence record`, and `done`. Lifecycle cancellation, timeout, hook, and error
facts are sent to `hook --host codex` through the shared host contract.

Unknown model identity stays `null`. A user-provided model label is not an
observed host identity.
