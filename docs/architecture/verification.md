# Architecture Verification Evidence

Date: 2026-08-06

Scope: [Kratos Observable Architecture Specification](../superpowers/specs/2026-08-06-yoda-observable-architecture-design.md)

This record satisfies the architecture issue's required manual trace. It traces
one successful content-bound spec approval and one rejected gate token from host
invocation to user response. It verifies component boundaries and state effects;
the Compatibility Contract milestone owns final JSON Schema property enums and
the complete reason/exit-code catalog.

## Preconditions

- A Kratos project is initialized with project-owned `.brain/` state.
- Run `0001-login` is at `AwaitingSpecApproval` after valid `research`, `prd`,
  `spec`, and `review` phases.
- `prd-output.json` and `spec-output.json` validate against their recorded
  contract versions.
- The current PRD and spec canonical hashes match the reviewed artifacts.
- The run event chain and snapshot cursor verify successfully.
- No active write lease owns the run.
- Policy permits the transition and there are no unresolved business-gap or
  partition checkpoints.

## Successful trace

Input from Claude Code or Codex:

```text
continue --gate aprovacao_spec
```

The legacy-compatible gate identifier remains stable until the Compatibility
Contract publishes a versioned replacement.

1. **Host adapter:** The adapter records the host capability context and observed
   identity available from the host. It normalizes the invocation without
   selecting a phase or mutating `.brain/`.
2. **Command boundary:** The parser recognizes `continue`, validates the exact
   gate argument, rejects extra phase-selection arguments, and produces a typed
   operation.
3. **Project locator:** The runtime resolves the repository root and confines all
   managed paths to `.brain/`. It rejects traversal and symlink substitution
   before reading state.
4. **Lock and state loader:** The runtime obtains a fenced write lease, validates
   configuration and contract versions, verifies the event hash chain, and
   reconciles `state.json` with its event cursor.
5. **Decision engine:** The pure engine receives validated state, hashes,
   policies, and normalized input. It confirms that the current human gate is
   exactly `aprovacao_spec`, the reviewed PRD/spec lineage is current, and the
   legal resulting lifecycle state is `Code`.
6. **Effect planner:** The runtime produces an ordered plan to record approval,
   bind it to the PRD/spec hashes and policy version, append the decision event,
   and advance the snapshot. No application source file is part of the plan.
7. **Transaction manager:** The runtime stages the approval and new snapshot,
   appends the event through the recoverable transaction boundary, durably
   publishes the state, and releases the fenced lease. An interruption leaves a
   transaction marker for deterministic recovery.
8. **Event store:** The approval event records the normalized operation, prior
   and resulting state identities, contract and policy versions, stable reason
   code, PRD/spec digests, human-approval evidence reference, effect summary,
   and observed host/model identity when available. Sensitive artifact content
   is not copied into the event.
9. **Result renderer:** The host receives a successful structured result with
   exit code 0, `stateChanged: true`, approval/event evidence references, and
   recovery semantics indicating that no retry is required. The human summary
   states that the current spec is approved and the next runtime-selected phase
   is `code`.
10. **Host response:** Claude Code or Codex relays the result. Neither adapter
    edits state, reinterprets the decision, nor claims that a model approved the
    spec.

The trace maps to specification Sections 6, 7.2, 7.3, and 8. It preserves the
Go v3 invariant that no code starts before content-bound human approval.

## Negative trace

Input while the current gate is `aprovacao_spec`:

```text
continue --gate gaps_abertos
```

The command boundary and state loader perform the same safe validation steps.
The decision engine rejects the mismatched token deterministically. The result
is blocked, `stateChanged` is false, and recovery names the exact current gate.
No approval record, lifecycle transition, or other state-changing event is
committed. A diagnostic observation may be emitted only if its event contract
cannot be confused with an accepted transition.

## Architecture assertions

- The host adapter translates; it does not decide.
- The pure decision engine decides; it does not perform effects.
- The transaction boundary commits state and event evidence together.
- The event stream proves the observed decision history; the snapshot and
  Markdown views remain derived.
- Approval is human, explicit, exact-gate, and bound to reviewed content.
- The same normalized input and validated state produce the same outcome on
  Claude Code and Codex.

## Reproducible documentation checks

Markdown lint:

```bash
npx --yes markdownlint-cli2@0.23.2 '**/*.md'
```

Workflow semantics:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/docs.yml
```

Link validation uses Lychee 0.24.2 from its immutable release archive:

```bash
lychee --config .lychee.toml './**/*.md'
```

Placeholder and whitespace checks:

```bash
rg -n '\b(T[O]DO|T[B]D|F[I]XME|X[X]X)\b' README.md docs .github || true
git diff --check origin/main...HEAD
```

Expected result: zero lint issues, zero actionlint findings, zero failed links,
no placeholder matches, and no whitespace errors.

## Rendered document review

The integration PR's first Documentation workflow completed successfully. The
two Mermaid blocks were also parsed and rendered with the official Mermaid CLI
11.16.0 into a sequence-diagram image and a state-diagram image. Manual image
inspection confirmed that participants, transitions, labels, branches, and
terminal states are visible and preserve the source order without a syntax or
layout failure. An independent read-only review then reported no remaining
Critical, Important, or Minor findings.
