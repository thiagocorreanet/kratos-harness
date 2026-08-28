# Objective Spec: Cross-Host Workflow Hooks

Date: 2026-08-28
Status: APPROVED
Approval source: GitHub issue #135 and the approved workflow-hooks design

## 1. Problem and desired outcome

The distributions expose hook directories and a hook ingress contract, but no
complete host-neutral lifecycle delivers session usage, tool failures, or
session finalization to runtime policy. The finished feature installs an
equivalent hook set for Claude Code and Codex, is inert outside initialized
Kratos projects, and makes stop-loss and failure capture deterministic.

## 2. Scope boundary

In scope:

- one declarative hook definition rendered for both hosts;
- published normalized observation and persisted-state contracts;
- run-global gross-token accounting and latched stop-loss behavior;
- explicit run-bound stop-loss unlock;
- #133 structured pre-write enforcement through the hook ingress;
- immutable, sanitized, exactly deduplicated failure candidates;
- session telemetry finalization and transient-cache cleanup;
- package, compatibility, security, documentation, and acceptance evidence.

Out of scope:

- statistics and budget reporting from issue #31;
- candidate promotion, near-duplicate curation, or confirmed memory from #140;
- inspection of arbitrary shell or MCP writes not covered by #133;
- model-assisted summarization or any hook network access.

## 3. Acceptance criteria

- [ ] Every hook exits zero and leaves no output or filesystem change when no
  Kratos state is discoverable.
- [ ] Both hosts render their hook sets from one declarative catalogue.
- [ ] Every native event is normalized and digest-pinned in the published host
  operation contract before runtime policy receives it.
- [ ] Gross usage accumulates across restarted and concurrent sessions for one
  active run without double-counting cached input or reasoning.
- [ ] Reaching the allocation latches the stop-loss gate, and retrying the same
  command or sample does not clear it.
- [ ] Missing or malformed measurement under a configured budget latches a
  measurement fault instead of assuming zero usage.
- [ ] Only confirmed `unlock stop-loss --run <id>` starts a new budget epoch and
  clears the latch.
- [ ] A refused structured write never reaches the filesystem.
- [ ] An identical tool failure produces one immutable sanitized candidate.
- [ ] Session end finalizes telemetry once and clears cache only after commit.
- [ ] Hooks call neither a model nor the network.
- [ ] Claude Code and Codex fixtures produce equivalent normalized operation
  messages for equivalent events.
- [ ] Focused verification and `npm run verify` pass.

## 4. Test strategy and failure modes

- Contract tests validate all new schemas, fixtures, generated types, closed
  catalogue registration, and predecessor immutability.
- Reducer tests cover threshold boundaries, retries, counter regression,
  restarts, concurrency, measurement faults, unlock confirmation, candidate
  sanitization/deduplication, and session-finalization recovery.
- Host conformance tests run equivalent native fixtures through both adapters
  and compare normalized bytes and runtime result identity.
- Package tests execute the full hook/state matrix, prove no-state inertness,
  prove pre-write denial before mutation, and prohibit network/model/process
  escape.
- Transaction fault tests prove partial publication cannot clear cache or
  publish inconsistent usage, gates, telemetry, candidates, or events.

## 5. Backward compatibility and risk

New schemas and lazily created state paths are additive. Existing operation and
gate contracts keep their v1 wire shapes, and existing projects need no state
migration. The deliberate behavior change is that `gates record` can no longer
clear stop-loss; recovery moves to the explicit legacy-compatible unlock
operation. Security-sensitive failure output is bounded and sanitized before
persistence, and pre-write handling remains fail-closed.
