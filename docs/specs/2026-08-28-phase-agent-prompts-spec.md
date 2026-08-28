# Objective Spec: Shared Phase Agent Prompts

Date: 2026-08-28
Status: APPROVED
Approval source: GitHub issue #134 and the user's approved brainstorming design

## 1. Problem and desired outcome

Kratos installs five Codex agent definitions that carry only a name,
description, and state path, while the Claude Code package installs no matching
phase agents. The desired outcome is one host-neutral behavioral source for the
researcher, planner, reviewer, implementer, and evaluator, rendered into each
host's native format without duplicating workflow policy.

## 2. Architecture and interfaces

- A pure runtime-domain catalog owns each role identifier, description, allowed
  `host.agent-output@1.0.0` discriminator, and canonical instruction body.
- Shared prompt sections define uncertainty handling, runtime authority,
  document paths, mutation boundaries, and the final machine block. Role
  sections define only the behavior that distinguishes one role from another.
- Codex initialization renders project-local `.codex/agents/*.toml` files and
  places the canonical body in `developer_instructions`.
- Claude Code package staging renders `agents/*.md` with host front matter and
  the same canonical body. The existing orchestrator remains unchanged.
- The catalog is an internal runtime interface. No persisted schema, contract
  version, reason code, CLI surface, gate, or workflow order changes.

The role-to-output mapping is:

| Installed role | Runtime output |
| --- | --- |
| `prd-researcher` | `prd` |
| `spec-planner` | `spec` |
| `spec-reviewer` | `plan` |
| `code-implementer` | `code` |
| `implementation-evaluator` | `review`, `acceptance` |

## 3. Prompt behavior

Every role completes its read and analysis preflight before its first write. A
genuine ambiguity that could change the artifact or implementation produces
typed blocking questions, `awaiting-input` with the `wait` routing hint, no
artifacts, no changed files, and no filesystem write. The role never guesses.

- The researcher reads project context and existing code, then writes only
  `00-prd.md`. It separates the validated problem from a proposed solution and
  writes neither design nor code.
- The planner reads `00-prd.md`, then writes `01-design.md` and `02-tasks.md`.
  When the PRD records a validated problem, acceptance criteria measure that
  problem rather than assuming the requested solution is correct.
- The reviewer audits requirements, design, and tasks before code. It separates
  evidence-resolvable gaps from owner-only gaps, closes only the former, and
  writes `03-summa.md`. Any owner-only blocking gap takes the no-write question
  path. Its surface checklist covers interface error statuses, validation,
  timeouts, and payload limits; storage constraint failures, rollback, and pool
  exhaustion; authentication expiry, refresh, and lockout; external timeout,
  retry with backoff, and fallback; and UI loading, error, empty, and offline
  states. The runtime derives `scope.json` from the reviewer document.
- The implementer executes exactly one reviewed plan step, stays inside the
  reviewer contract, follows surrounding code, maps tests to declared
  acceptance criterion identifiers, and runs the project's own focused and
  complete test and lint commands. It never edits criterion checkboxes or
  declares its work complete.
- The evaluator is read-only. A review passes only with direct high-confidence
  evidence for every applicable judgment, passing mapped tests for every
  criterion, reviewer-contract compliance, and no unhandled applicable edge
  case. Remediable defects request changes. A specification contradiction,
  out-of-scope implementation, or evidence too weak for a reliable judgment
  fails review. Acceptance requires every current criterion to carry valid
  evidence and outcome `passed`; a missing test, low-confidence judgment,
  `failed`, `not-run`, or unhandled edge case rejects acceptance. Every prose
  judgment cites `path:line` or an exact test name.

Every reply ends with exactly one role-appropriate machine block. The prompts
describe its published envelope and payload fields, but never contain a stable
reason-code string, reproduce a gate decision, or prescribe a transition.
Routing values remain non-authoritative hints that the runtime evaluates.

## 4. Document paths and limits

All prompts name the same active-feature documents, derived from the existing
`FEATURE_DOCUMENTS` identifiers:

- `.brain/02-features/<feature>/00-prd.md`
- `.brain/02-features/<feature>/01-design.md`
- `.brain/02-features/<feature>/02-tasks.md`
- `.brain/02-features/<feature>/03-summa.md`

Each canonical UTF-8 prompt body is at most 12 KiB. Prompt bodies contain no
host-specific tool names or host-specific filesystem paths.

## 5. Test strategy and acceptance

- [x] Both installed distributions carry bodies decoded from the same catalog,
      proven by a built-package and initialized-project conformance test.
- [x] All five prompts implement the shared no-write uncertainty behavior.
- [x] Role boundaries, reviewer surface coverage, implementer authority limits,
      and evaluator evidence thresholds are represented in the canonical
      prompts and in valid behavior fixtures.
- [x] Full Markdown reply fixtures cover valid and invalid `prd`, `spec`,
      `plan`, `code`, `review`, and `acceptance` machine blocks.
- [x] No rendered prompt contains a published reason-code string, a
      host-specific tool name, or unresolved placeholder text.
- [x] Every prompt stays within 12 KiB and names the canonical feature document
      paths.
- [x] Focused tests, package build and verification, and `npm run verify` pass.

## 6. Compatibility, state, and security

Compatibility is additive at the host-asset layer. Existing contract and state
versions remain byte-identical. Initialization remains deterministic and pure;
Claude package generation consumes only the compiled pure catalog. Security is
tightened by requiring uncertainty to stop before mutation, keeping evaluator
roles read-only, separating artifacts from changed files, and preventing prompt
prose from becoming a second policy engine.
