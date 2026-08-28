# Claude Code and Codex

Both host packages invoke the same embedded runtime by a package-relative path
and negotiate the same host contract. Neither requires a global legacy binary
or project `node_modules`.

## Pre-write relay boundary

Each package installs a synchronous `PreToolUse` relay for structured file
mutation only. Claude Code normalizes `Write`, `Edit`, and legacy `MultiEdit`;
Codex normalizes `apply_patch`. Both adapters produce the same
`host.pre-tool-use@1.0.0` request (`create`, `update`, `delete`, or ordered
`move` endpoints). It is a closed record with `contractVersion`, `hostContract`,
and an ordered `mutations` array; version 1 accepts 1–256 mutations. The
adapters invoke the embedded runtime guard and preserve the same
`host.operation-result@1.0.0` identity, reason code, exit code, evidence, and
state-change claim. Only the host-specific allow/deny rendering differs.

The relay is deliberately not a policy engine: it has no decision authority.
It allows only a valid success result with exit 0. Every non-success result,
malformed normalized request, invalid runtime response, timeout, or relay
failure is denied by the host. Bash and arbitrary MCP tools are outside this
contract because their file targets cannot be deterministically inspected at
this boundary; they are passed through rather than treated as guarded file
mutations.

The guard decides before the host invokes its filesystem tool, but it does not
own the subsequent host operation. An external host can change the filesystem
after Kratos returns, so this boundary has an honest time-of-check/time-of-use
limitation. The synchronous relay narrows the window and refuses known unsafe
targets; it is not a transaction or a filesystem lock around the host.

## Claude Code

The Claude Code package contains plugin metadata, the Kratos skill, an
orchestrator agent, hooks, templates, schemas, and the shared runtime. Hooks
submit versioned operation messages; the adapter renders the runtime result
without changing reason codes.

## Codex

The Codex package contains plugin metadata, a Kratos skill, project
instructions, an orchestrator definition, templates, schemas, and the same
runtime bytes. Generated instructions use managed sections so repeated setup is
idempotent.

## Capability differences

A host reports its capabilities during negotiation. An operation that requires
an unavailable approval, hook, timeout, or cancellation capability fails with
an explicit unsupported-capability result. It never falls back to a weaker
policy.

Pin a package version for reproducibility. Use the atomic installer for update,
rollback, commit, and uninstall so a partial activation cannot replace the
working version.
