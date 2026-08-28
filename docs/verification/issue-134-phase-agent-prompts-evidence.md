# Issue #134 phase-agent prompt evidence

Date: 2026-08-28

## Scope

Issue #134 installs five behaviorally complete phase-agent prompts in Codex
and Claude Code from one host-neutral catalog. It changes host assets and
initialization output only. Published schemas, contract versions, reason codes,
workflow transitions, state files, and migration behavior are unchanged.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Both distributions derive prompts from the same source | `phase-agent-prompts`: "renders every Codex definition from the canonical body" and `runtime-distribution`: "stages every Claude phase agent from the canonical body" decode each installed wrapper and compare it with `PHASE_AGENT_PROMPTS`. |
| Hosts cannot drift into different role behavior | The same tests compare exact canonical bodies for all five role ids; package verification requires all five Claude assets and all five initialized Codex definitions. |
| Genuine ambiguity returns questions and writes nothing | `fixtures/agent-output/v1/valid/spec.md` is a full `awaiting-input` reply with two typed questions and empty artifacts and changed files; `phase-agent-prompts` requires the same pre-write uncertainty rule in every body. |
| The implementer cannot mark a criterion complete | `phase-agent-prompts`: "keeps each role inside its distinct responsibility" requires the checkbox and completion-authority prohibitions in the implementer body. |
| The evaluator cites evidence for every judgment | The same role-boundary test requires file-and-line or exact-test citations, low-confidence failure, mapped tests, and edge-case thresholds; the review and acceptance reply fixtures carry evidence references. |
| Every prompt names runtime document paths | `phase-agent-prompts`: "gives every role the same documents and fail-closed uncertainty rule" compares all four paths derived from `FEATURE_DOCUMENTS`. |
| Prompt prose carries no runtime policy identifier | `phase-agent-prompts`: "contains no runtime policy identifier or unresolved placeholder" compares every body against the complete published reason catalog. |
| Prompts stay bounded and host neutral | `phase-agent-prompts`: "stays bounded and host neutral" checks the 12 KiB UTF-8 ceiling and rejects host-specific names. |
| Full valid and invalid replies cover every output | `agent-output-contract` extracts and validates complete Markdown replies for `prd`, `spec`, `plan`, `code`, `review`, and `acceptance`. |
| The orchestrator remains out of scope | `runtime-distribution`: "keeps the Claude orchestrator unchanged while adding phase agents" compares staged and source bytes. |

## Verification commands

```text
npx vitest run tests/phase-agent-prompts.test.ts tests/init-skeleton.test.ts tests/agent-output-contract.test.ts tests/agent-output-recording.test.ts tests/runtime-distribution.test.ts tests/package-boundaries.test.ts tests/package-verifier.test.ts
npm run build
npm run package:verify
npm run verify
```

The complete verification command exited zero on 2026-08-28. Its test stage
reported 163 files and 4,281 tests passing. Coverage reported 93.48% statements,
89.33% branches, 94.43% functions, and 93.87% lines. Mutation scoring was 3/3,
the contract and differential checks passed, clean-room package verification
passed for both hosts, and the final bundle measured 1,108,233 bytes.

## Impact

- Compatibility: additive host instructions; no published contract changes.
- State: Codex initialization updates managed agent-definition content; Claude
  adds package-local agent assets. Canonical `.brain` state shapes are
  unchanged.
- Security: unanswered ambiguity stops before writes, the evaluator is
  read-only, the implementer cannot claim acceptance, and prompt prose cannot
  reproduce stable runtime policy identifiers.
