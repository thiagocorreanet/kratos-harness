---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow without changing runtime decisions.
---

# Kratos for Claude Code

Resolve this skill's own directory and invoke
`node scripts/kratos.mjs <arguments>`. The script is only a plugin-relative
bridge to the installed runtime. Never copy it into the project, require a
global `kratos` binary, or reproduce a gate decision in the prompt.

1. Run `node scripts/kratos.mjs handshake --json` from this skill directory
   before the first stateful command.
2. Pass `--root` explicitly for every project operation.
3. Use `objective`, `start`, `continue`, `approve`, `evidence record`, and
   `done` in that order as the runtime state requires.
4. Relay stable reason codes and recovery text exactly. Ask the user only when
   the runtime requests approval or returns a non-retryable decision.
5. Forward cancellation, timeout, hook, and error observations only after
   converting them to the published Kratos host-operation contract. Never pipe
   a raw Claude Code hook event directly into the runtime.

Treat model identity as observed metadata. If the host does not expose it, use
`null`; never infer a model name from conversational text.
