---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow through its embedded runtime.
---

# Kratos for Codex

Resolve this skill's own directory and invoke
`node scripts/kratos.mjs <arguments>`. The script is only a plugin-relative
bridge to the installed runtime. Do not copy it into the project, depend on a
global binary, or implement workflow policy in this skill.

## Scope activation

Immediately after valid reviewer prose is available, invoke
`node scripts/kratos.mjs scope record --root <absolute-project-root>` from this
skill directory before any implementation begins. The runtime alone translates
reviewer prose, validates scope, and decides whether recording may proceed;
stop and relay any refusal unchanged.

## Runtime workflow

Run a JSON handshake first, pass an explicit project `--root`, and relay the
runtime's result, reason code, evidence, and recovery unchanged. The normal
trail is `objective`, `start`, `continue`, content-bound `approve`,
`evidence record`, and `done`. During the `prd` and `spec` phases, propose
gaps as a `host.gap-proposal@1.0.0` document and hand it to
`gaps record <path>`. A gap is one of four things: a rule that admits two
readings which produce different code, a decision only the owner can make, a
contradiction between two passages, or an external dependency nobody has
confirmed. Propose nothing outside that set, and never decide whether a gap
blocks the run; the runtime derives that from what it recorded. Lifecycle cancellation, timeout, hook, and error
facts are sent to `hook --host codex` through the shared host contract.

Unknown model identity stays `null`. A user-provided model label is not an
observed host identity.

## Phase-agent relay boundary

For phase work, the Codex host integration must load
`scripts/phase-agent-relay.mjs`. Its runtime transport invokes the packaged
runtime with `--json handoff --root <absolute-project-root>` and passes the
returned handoff to the relay. Its launcher binds the native Codex phase-agent
call to the returned `model` and `effort` exactly. The record transport invokes
`agent record` with the adapter message produced by the relay, which keeps the
returned `assignmentDigest` outside agent output.

Declare exact model and effort selection unavailable when the native launcher
cannot bind either field. The relay then returns
`exact-selection-unsupported` before calling the launcher or `agent record`.
This is a host capability boundary, not a replacement workflow verdict; do not
choose another assignment. A missing host observation remains `null`.
