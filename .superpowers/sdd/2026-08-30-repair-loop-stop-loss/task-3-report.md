# Task 3 Report: Acceptance Recording, Gates, and Handoff

Date: 2026-08-30
Base: `0a0ec0864eb7e80670e8e83a394e0d24ca77006e`
Status: implementation and required verification complete

## Outcome

Task 3 now connects the Task 2 repair-loop decision to the real acceptance
recording path. One transaction writes every criterion verdict, reconciles the
task document, writes any immutable repair-stop artifacts, stores the validated
agent output, and appends the acceptance decision event that drives the state
transition.

- An accepted verdict preserves the acceptance phase and does not reset prior
  attempts.
- A rejected verdict below the ceiling records all failed criterion attempts in
  task-document order and returns the run to `code`.
- A verdict at the ceiling requires one bounded `code | specification`
  classification and diagnosis for every simultaneously tripping criterion,
  records every stop, and blocks without creating another attempt.
- A missing, invalid, or unexpected fault report is refused before any effect.
- The gate reports every active repeated-rejection stop in stable order and can
  report rejection, token-budget, and legacy stop flags simultaneously with
  distinct reason codes.
- The current handoff exposes the frozen ceiling, ordered attempts,
  `faultsRequiredFor`, and digest-bound active `faults`.
- Claude Code and Codex pass the same complete runtime handoff to their launcher
  and return the same `host.agent-output@1.1.0` payload contract. Hosts do not
  compute repair-loop policy.

No repair-resolution command, restart ticket, new-run restart, or
`sdd.repair.resolve` production surface was added. No project-configuration or
workflow-reducer file was changed.

## Files

### Versioned contracts and compatibility

- `schemas/host/agent-output.v1.1.schema.json`
- `schemas/host/phase-handoff.v1.2.schema.json`
- `schemas/contracts/contract-manifest.v1.5.schema.json`
- `packages/contracts/catalogs/reason-codes.v1.10.json`
- `packages/contracts/catalogs/contract-families.v1.json`
- `packages/contracts/src/{compatibility,index,reasons}.ts`
- `packages/contracts/src/generated/contracts.ts`
- `packages/runtime/src/domain/schema/contracts.ts`
- `packages/runtime/src/infra/schema/catalog.ts`
- `scripts/check-contracts.mjs`
- `fixtures/contracts/v1.1/agent-output.json`
- `fixtures/contracts/v1.2/phase-handoff.json`

### Runtime, gates, prompts, and hosts

- `packages/runtime/src/composition/{cli,workflow}.ts`
- `packages/runtime/src/domain/agent/{coherence,model}.ts`
- `packages/runtime/src/domain/cli/{agent,diagnostics,spec}.ts`
- `packages/runtime/src/domain/gates/{evaluate,index,model}.ts`
- `packages/runtime/src/domain/phase-agents/model.ts`
- `packages/adapters/src/index.ts`

### Tests and fixtures

- New integration suites:
  `tests/repair-loop-acceptance-recording.test.ts` and
  `tests/repair-loop-host-integration.test.ts`
- Contract and publication coverage:
  `tests/{cli-contracts,contract-documentation,contract-manifest,contract-reason-catalog,contract-schemas,contract-type-generation,schema-registry-fixtures}.test.ts`
- Host/runtime regressions:
  `tests/{model-role-workflow,phase-agent-relay-distribution,runtime-distribution,workflow-run-lineage,cli-narrate}.test.ts`

### Documentation

- `docs/architecture/agent-output-contract.md`
- `docs/architecture/host-adapter-protocol.md`
- `docs/compatibility/contract-versioning.md`
- `docs/user/commands.md`
- `schemas/README.md`
- `fixtures/README.md`

## TDD evidence

### Cycle 1: contracts, gate aggregation, prompt, and host parity

RED:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-host-integration.test.ts
Test Files  1 failed (1)
Tests  6 failed (6)
```

The failures proved that agent-output 1.1 and handoff 1.2 did not exist, the
gate collapsed stop triggers, the evaluator prompt had no runtime-derived fault
context, and both host relays omitted the handoff while requesting payload 1.0.

GREEN:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-host-integration.test.ts
Test Files  1 passed (1)
Tests  6 passed (6)
```

### Cycle 2: real atomic acceptance recording

RED:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-acceptance-recording.test.ts
Test Files  1 failed (1)
Tests  3 failed (3)
```

The failures showed that the first rejection stayed in acceptance, missing
diagnoses were accepted, and a ceiling rejection still emitted the generic
`sdd.agent.record` event instead of a stop-loss decision. A test-fixture issue
found during GREEN reused immutable evidence paths; the fixture was corrected
to create distinct repair evidence without changing production policy.

GREEN, later expanded with accepted-verdict and handoff assertions:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-acceptance-recording.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)
```

### Integration fallout

The first 21-file focused run produced 12 failures out of 607 tests. They were
all expected current-contract fallout: predecessor payload-envelope fixtures,
packaged launch expectations, schema fixture inventory, CLI handoff schema, and
contract documentation. After alignment:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-host-integration.test.ts tests/repair-loop-acceptance-recording.test.ts tests/acceptance.test.ts tests/agent-output-contract.test.ts tests/agent-output-recording.test.ts tests/gate-evaluator.test.ts tests/gate-facts.test.ts tests/phase-agent-prompts.test.ts tests/host-adapter-contract.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/result-contract-rendering.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/contract-schemas.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/cli-contracts.test.ts tests/contract-documentation.test.ts tests/phase-agent-relay-distribution.test.ts tests/model-role-workflow.test.ts
Test Files  21 passed (21)
Tests  619 passed (619)
```

`contracts:check` then supplied another RED because the immutable current
manifest v1.4 closed its inventory at 43 schemas and reason catalog 1.9. The
fix added manifest v1.5 rather than rewriting v1.4. A first full-suite run found
two legitimate regressions: the generated-contract count and a historical
acceptance tamper test that now had to complete the required repair route. A
second full-suite run found only two five-second timeouts in CPU-bound contract
generator subprocess tests under parallel load; their limits now match the
existing 30-second heavy test in the same file, with assertions unchanged.

## Verification evidence

Final full suite:

```text
npx --yes npm@11.16.0 test
Test Files  198 passed (198)
Tests  4891 passed (4891)
Duration  318.22s
```

Final required gates:

```text
npx --yes npm@11.16.0 run contracts:check
contract families v1.0.0: verified (45 schemas; 14 legacy profiles; generated types current)

npx --yes npm@11.16.0 run result:check
result contract v1.0.0: verified (76 reasons; exits 0,1,2,3,4,5; 6 examples)

npx --yes npm@11.16.0 run parity:check
discovery go-v3-v0.6.5: verified
parity overall: 0 / 400 (0.00%)

npx --yes npm@11.16.0 run typecheck
exit 0

npx --yes npm@11.16.0 run lint
exit 0

npx --yes npm@11.16.0 run format:check
All matched files use Prettier code style!

npx --yes npm@11.16.0 run english:check
English-only source check passed.

git diff --check
exit 0
```

## Compatibility and security audit

- Published predecessors remain unchanged. Verified SHA-256 values include
  `contract-manifest.v1.4` =
  `ec51f226d07ce9c0d2ceb98a087afcee0c26b47990b47e51d11aed679a045970`,
  `reason-codes.v1.9` =
  `6e0cff6baa48284446851fe53c282cc107e417c5ee6367ce3dd549dcb7852786`,
  `agent-output.v1` =
  `7d95ea2c2541c12b8e960094bb3bd197b35f5f55ffd6412581449efacde54d3a`,
  and `phase-handoff.v1.1` =
  `b9c65a4852253487c65e7b41a1203c2ea3937c77248523cc1510c508aa92a557`.
- Agent-output 1.0 and handoff 1.1 remain registered readable predecessors;
  current writes use 1.1 and 1.2 respectively. Unknown or future host versions
  are classified from the declared `hostContract`, not coerced to current.
- Reason catalog 1.10 is an append-only extension of 1.9 and adds only
  `blocked.stop_loss_rejections`.
- Diagnoses are schema-bounded to 2,048 printable characters. They live in
  immutable repair-stop artifacts and typed handoff views; events contain only
  classification plus digest-bound references and do not embed diagnosis or
  prompt/source content.
- Stop artifacts are revalidated for schema, run ID, criterion ID, attempt,
  classification, file digest, and event binding before becoming gate/handoff
  context. An unreadable or changed artifact fails the context closed.
- The transaction writes artifacts before appending the event, with the event
  last in the same atomic effect plan. Missing semantic fault data produces an
  empty plan.
- Task-document ordering drives both failed-attempt metadata and simultaneous
  stop order. Gate aggregation preserves that order and does not use locale or
  host-specific sorting.
- Claude Code and Codex receive the same runtime-built object. Prompt and host
  code only relay and render `faultsRequiredFor`; neither duplicates
  `decideRepairLoop`.

## Deviations and concerns

- Necessary compatibility deviation: adding two registered host schemas and a
  new reason exceeded the closed v1.4 manifest. A new v1.5 manifest was added,
  and the checker now targets it; v1.4 was not edited.
- Test-harness deviation: two CPU-bound subprocess tests received explicit
  30-second limits after exceeding the default 5 seconds only during the full
  parallel suite. Their behavior and assertions are unchanged.
- No unresolved Task 3 concern remains. Task 4 still owns explicit resolution,
  selective reset, restart tickets, and specification-run creation; this task
  intentionally provides none of those surfaces.
