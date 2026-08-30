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

A recognized mutation also needs a non-empty absolute native `cwd`. A missing,
relative, control-bearing, or otherwise malformed root is denied before the
runtime can evaluate policy; neither adapter substitutes the process working
directory. Codex patch preambles that identify an environment without exposing
an effective root the relay can inspect are likewise denied. The packaged relay
requires the supported Node.js runtime documented in the quickstart.

The guard decides before the host invokes its filesystem tool, but it does not
own the subsequent host operation. An external host can change the filesystem
after Kratos returns, so this boundary has an honest time-of-check/time-of-use
limitation. The synchronous relay narrows the window and refuses known unsafe
targets; it is not a transaction or a filesystem lock around the host.

## Workflow observations

Both packages render four logical hooks from
`distribution/shared/hooks.v1.json`: `tool.before`, `tool.failed`,
`session.sample`, and `session.end`. A native event is normalized into
`host.hook-observation@1.0.0`, staged beneath the session cache, and referenced
by path and SHA-256 from `host.operation-message@1.0.0`. Raw host payloads never
enter runtime policy or canonical state.

Session usage is gross processed input plus output. Each session reports a
monotonic cumulative value; the runtime adds only its increase to the active
run. Reaching the configured allocation latches the gate, and a missing sample
under a configured budget latches a measurement fault. Retrying or restarting
does not clear either condition. The only release is
`unlock stop-loss --run ID` with the exact `UNLOCK ID` confirmation on standard
input, which preserves the total and starts a new budget epoch.

Before a selected phase agent launches, both Claude Code and Codex obtain the
runtime handoff and relay the same closed `host.phase-lifecycle@1.0.0` phase
start. The normalized payload carries the trusted session and correlation IDs,
occurrence time, and runtime assignment digest. A refused or invalid start
prevents launch. Host syntax differs, but the lifecycle message and ordering do
not.

The runtime re-resolves the digest-bound assignment and is authoritative for
phase, role, canonical model, effort, token delta, duration, deduplication, and
recovery. Agent prose cannot set or change those values. Nullable model and
effort observed by a host are retained only as separate provenance. Adapters do
not map phases, select assignments, calculate counters, or repair measurements.

Failed tools create immutable, digest-addressed candidate records containing a
bounded sanitized diagnostic. Identical failures address the same record and
do not duplicate it. `session.end` publishes the final session telemetry and
clears its transient files in one managed transaction. Candidate promotion is
not performed by hooks.

Every hook exits zero outside initialized Kratos projects and creates nothing.
Observation hooks are fail-open for the host action; the synchronous structured
write guard remains fail-closed. Hook code calls neither a model nor the
network.

## Claude Code

The Claude Code package contains plugin metadata, the Kratos skill, an
orchestrator agent, five phase agents, hooks, templates, schemas, and the shared
runtime. The phase-agent Markdown bodies come from the runtime's canonical
catalog during package staging. Hooks submit versioned operation messages; the
adapter renders the runtime result without changing reason codes.

## Codex

The Codex package contains plugin metadata, a Kratos skill, project
instructions, an orchestrator definition, templates, schemas, and the same
runtime bytes. Project initialization renders five `.codex/agents/*.toml`
definitions from the same canonical prompt catalog used by Claude Code.
Generated instructions use managed sections so repeated setup is idempotent.

Both hosts install a researcher, planner, reviewer, implementer, and evaluator.
Their shared instructions require unanswered blocking questions to stop before
any write. The implementer cannot mark acceptance criteria complete, and the
evaluator must cite file-and-line or named-test evidence for every judgment.
Host syntax differs; role behavior does not.

## Capability differences

A host reports its capabilities during negotiation. An operation that requires
an unavailable approval, hook, timeout, or cancellation capability fails with
an explicit unsupported-capability result. It never falls back to a weaker
policy.

Pin a package version for reproducibility. Use the atomic installer for update,
rollback, commit, and uninstall so a partial activation cannot replace the
working version.
