# Issue 135 workflow hook evidence

This evidence closes #135 and implements the host-neutral workflow hook set
promised by the Claude Code and Codex distributions.

## Compatibility, state, and security impact

- Compatibility: additive v1 hook-observation, run-usage,
  failure-candidate, and session-telemetry contracts. Existing projects need no
  migration because records are created lazily. `gates record --stop-loss
  clear` is deliberately refused; the compatible explicit recovery command is
  `unlock stop-loss --run ID`.
- State: run-global usage is stored at
  `.brain/02-features/<feature>/runs/<run>/usage.json`; candidate and telemetry
  records live under `.brain/03-memory/`; transient delivery files live only
  below `.brain/03-memory/.cache/hooks/<session>/`.
- Security: raw native events do not cross the runtime boundary, diagnostics
  are bounded and sanitized, candidate identifiers are deterministic, and the
  hook implementation imports no model or network client. Structured writes
  remain synchronously fail-closed before host tool execution.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Hooks are inert without Kratos state | `tests/workflow-hook-distribution.test.ts` executes all four logical hooks for both hosts with and without `.brain` and asserts zero exit, empty output, and no no-state files. |
| One declarative definition drives both hosts | The same test renders both checked manifests from `distribution/shared/hooks.v1.json`; `scripts/build.mjs` renders that definition into each package. |
| Observations cross the published operation contract | `tests/workflow-hook-adapters.test.ts` proves equivalent normalized observations; `tests/workflow-hook-runtime.test.ts` sends digest-pinned `host.operation-message` envelopes through the real command pipeline. |
| Budget overrun trips and retry holds | `tests/workflow-hook-runtime.test.ts` reaches the exact allocation, retries the same sample, and asserts unchanged usage with `stopLoss.exhausted=true`. |
| Explicit unlock is the only clearing act | The runtime test confirms `UNLOCK <run>` on standard input, observes epoch 2 with a preserved baseline, and verifies both flags clear. `tests/gate-facts.test.ts` covers the restricted gate vocabulary. |
| Refused writes never reach disk | `tests/pre-tool-relay-distribution.test.ts` executes both packaged synchronous relays and asserts the refused target never exists. |
| Identical failures deduplicate | `tests/workflow-hook-runtime.test.ts` delivers the same failure twice and asserts exactly one candidate; `tests/workflow-hook-domain.test.ts` proves time and session identity do not affect its fingerprint. |
| Session end finalizes and clears | `tests/workflow-hook-runtime.test.ts` asserts one telemetry record and no remaining files in the session cache. |
| No model or network | `tests/workflow-hook-distribution.test.ts` checks every shipped observation-hook source for forbidden model, URL, and networking imports. |
| Claude Code and Codex are equivalent | `tests/workflow-hook-adapters.test.ts` compares canonical observations for samples, failures, ends, and equivalent structured writes. |

## Verification commands

```text
npm run contracts:check
npx vitest run tests/workflow-hooks-contracts.test.ts tests/workflow-hook-domain.test.ts tests/workflow-hook-adapters.test.ts tests/workflow-hook-runtime.test.ts tests/workflow-hook-distribution.test.ts tests/pre-tool-relay-distribution.test.ts tests/gate-facts.test.ts tests/schema-registry-fixtures.test.ts
npm run verify
```

Final verification passed on 2026-08-28: 168 test files and 4,330 tests passed;
statement coverage was 93.5%, branch coverage was 89.17%, the mutation score
was 100%, all 27 contracts verified, and both packaged hosts passed package
verification.

The pull request should use the title `feat: ship host-neutral workflow hooks`,
link `Closes #135`, and include this document as its acceptance evidence.
