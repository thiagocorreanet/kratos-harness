---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow through its embedded runtime.
---

# Kratos for Antigravity

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

## Initialization interview

Before `kratos init`, run
`node scripts/kratos.mjs --json profile derive --root <absolute-project-root>`
from this skill directory. Its `host.project-profile@1.0.0` payload is the only
source of interview candidates. Then load `scripts/project-profile-relay.mjs`
from this skill directory.

Record an answer the payload reports as `derived` exactly as it stands, with
its value and its evidence string, and ask the operator nothing about it. Ask
only the `projectProfileQuestions` entries the payload reports as `unresolved`,
in order, and ask those blank. Never present a candidate the payload does not
carry, and never add a description the payload does not carry. The runtime
derives these, and a suggestion you author makes one repository answer
differently for different operators.

Record an answer the operator gives as `resolved`, an item the operator
explicitly omits as `not-applicable` with a reason, and anything still blank as
`unresolved`. Commands are exact single-line strings run from the project root,
paths are project-relative lists, and implementation languages are programming
languages rather than the human-language policy.

Pass the keyed answers to `relayProjectProfileAnswers`, place its returned
value in `host.init-answers@1.6.0` as `projectProfile`, and pipe that complete
document to:

```bash
node scripts/kratos.mjs init --host antigravity --root <absolute-project-root>
```

The relay shapes values only. It does not validate readiness, parse generated
Markdown, or execute any configured command.

## Runtime workflow

1. Run `node scripts/kratos.mjs handshake --json` from this skill directory
   before the first stateful command.
2. Pass `--root` explicitly for every project operation.
3. Use `objective`, `start`, `continue`, `approve`, `evidence record`, and
   `done` in that order as the runtime state requires.
4. During the `prd` and `spec` phases, propose gaps as a
   `host.gap-proposal@1.0.0` document and hand it to `gaps record <path>`. A
   gap is one of four things: a rule that admits two readings which produce
   different code, a decision only the owner can make, a contradiction between
   two passages, or an external dependency nobody has confirmed. Propose
   nothing outside that set, and never decide whether a gap blocks: the
   runtime derives that.
5. Relay stable reason codes and recovery text exactly. Ask the user only when
   the runtime requests approval or returns a non-retryable decision.
6. Forward cancellation, timeout, hook, and error observations only after
   converting them to the published Kratos host-operation contract. Never pipe
   a raw Antigravity hook event directly into the runtime.

Treat model identity as observed metadata. If the host does not expose it, use
`null`; never infer a model name from conversational text.

## Phase-agent relay boundary

For phase work, the Antigravity host integration must load
`scripts/phase-agent-relay.mjs`. Its runtime transport invokes the packaged
runtime with `--json handoff --root <absolute-project-root>` and passes the
returned handoff to the relay. Its launcher binds the native Antigravity
phase-agent call to the returned `model` and `effort` exactly. The record
transport invokes `agent record` with the adapter message produced by the
relay, which keeps the returned `assignmentDigest` outside agent output.

Declare exact model and effort selection unavailable when the native launcher
cannot bind either field. The relay then returns
`exact-selection-unsupported` before calling the launcher or `agent record`.
This is a host capability boundary, not a replacement workflow verdict; do not
choose another assignment. A missing host observation remains `null`.
