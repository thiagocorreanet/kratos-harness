# Kratos system architecture

## 1. Analysis metadata

| Field | Value |
| --- | --- |
| Repository | `thiagocorreanet/kratos-harness` |
| Scope | Entire current repository |
| Branch | `main` |
| Commit | `1ada5701343061d6f32fd171d32147e30cd7e2c9` |
| Analysis date | 2026-08-15 |
| Method | Static, file-by-file reverse engineering plus bounded local verification |
| Diagram | [`system-architecture.drawio`](system-architecture.drawio) |
| Coverage | [`architecture-coverage.csv`](architecture-coverage.csv) |

Confidence labels used in this report:

- `CONFIRMED`: directly connected in source, tests, or executable output.
- `INFERRED`: consistent with the evidence, but not connected end to end.
- `PROPOSED`: documentation or design direction, not current behavior.
- `PENDING`: requires external evidence or a human decision.
- `NOT FOUND`: searched for without implementation evidence.

## 2. Executive summary

Kratos is a local-first development harness for Spec-Driven Development with AI
coding agents. It is not a prompt collection. A host-neutral TypeScript runtime
owns command interpretation, workflow transitions, gates, approvals, evidence,
replay, mutation, and recovery. Codex and Claude Code are integration surfaces,
not policy authorities. `CONFIRMED`

The architecture is a functional core behind explicit ports:

```text
Host → adapter/CLI → composition → pure domain decision → EffectPlan
     → durable ports/infrastructure → project-owned .brain state
```

The authoritative run history is an append-only canonical JSONL event stream.
Snapshots are derived by deterministic replay. Managed writes use staged,
fingerprinted transactions with a persistent journal; recoverable leases and
fencing tokens guard concurrent mutations. Inputs and public results cross
versioned schema and reason-code boundaries. `CONFIRMED`

The implementation is broad, but maturity is still experimental. The public
compatibility inventory reports `0 / 400`, real signed-in host E2E is pending,
and remote CI for issue #136 has not been observed. The current local
model-role acceptance and full-gate evidence is recorded separately from those
external claims. `CONFIRMED`

## 3. Scope and exclusions

The analysis covered runtime entry points, all workspace packages, schemas,
fixtures, scripts, quality configuration, current architecture and user
documentation, repository policy, CI definitions, and the relevant tests.

Excluded from current-behavior coverage:

- `docs/superpowers/**`: historical specifications and implementation plans;
  current code, contracts, and accepted architecture documents were treated as
  authoritative instead.
- `.superpowers/**`: local task-state material, not product architecture.
- `packages/contracts/src/generated/contracts.ts`: generated artifact. It was
  inspected for drift, but is excluded from authored-source coverage.
- `.git`, dependencies, builds, coverage output, caches, and temporary package
  output: generated or vendored material.

No secrets, credentials, environment files, production services, external
hosts, deployment, migration, or mutation commands were accessed during the
investigation.

## 4. Stack and repository organization

| Area | Technology / role | Evidence |
| --- | --- | --- |
| Workspace | npm monorepo, ESM, strict TypeScript 6 | [`package.json`](../../package.json), [`tsconfig.json`](../../tsconfig.json) |
| Runtime | Node.js 24, embedded JavaScript ESM | [`ADR 0002`](../adr/0002-embedded-esm-runtime.md), [`scripts/build.mjs`](../../scripts/build.mjs) |
| Validation | JSON Schema 2020-12, Ajv in development, offline subset in bundle | [`schema registry`](schema-registry.md), [`simple-ajv.ts`](../../packages/runtime/src/infra/schema/simple-ajv.ts) |
| Tests | Vitest, property tests, contract suites, fault campaigns | [`vitest.config.ts`](../../vitest.config.ts), [`tests`](../../tests) |
| Distribution | Separate Codex and Claude Code plugin packages | [`runtime distribution`](../compatibility/runtime-distribution.md) |
| Durable state | Project-relative files under `.brain/` | [`ADR 0003`](../adr/0003-project-local-brain-state.md) |

The four workspaces are:

- `@kratos/contracts`: version identities, reason catalog, compatibility, and
  generated declarations.
- `@kratos/runtime`: CLI, domain, ports, Node/fake infrastructure, and
  composition.
- `@kratos/adapters`: relay-only host adapter contract and two conforming
  factories.
- `@kratos/differential`: isolated oracle/candidate materialization, capture,
  normalization, and comparison.

The build distributes contracts and runtime plus thin assets from
`distribution/`. The adapters and differential packages currently serve source
and test contracts; they are not bundled as those workspace modules into the
host packages. `CONFIRMED`

## 5. Context and actors

| Actor / system | Responsibility | Authority |
| --- | --- | --- |
| Developer / maintainer | States an objective, reviews evidence, grants approvals, operates recovery | Human authorization |
| AI coding agent | Proposes work and invokes supported operations | No direct workflow-transition authority |
| Codex / Claude Code | Hosts interaction and delivers normalized messages | Transport and rendering only |
| Kratos runtime | Decides transitions, gates, result policy, and managed effects | Canonical local authority |
| Git | Supplies read-only repository state used by policy | Observation only |
| Project filesystem | Stores `.brain` and bounded managed host surfaces | Durable local state |
| Go v3 oracle | Legacy behavior source for differential compatibility | Migration/parity reference only |

No remote database, API, broker, or mandatory cloud control plane was found in
the connected runtime. `NOT FOUND`

## 6. Containers and runtime

1. **Host package.** Codex and Claude Code packages contain thin integration
   assets and the same plugin-owned runtime.
2. **Preflight.** `runtime/boot/preflight.mjs` checks the runtime environment
   before loading the entry point.
3. **CLI entry.** [`runCli`](../../packages/runtime/src/cli.ts) delegates to the
   composed command pipeline.
4. **Composition root.** [`createRuntime`](../../packages/runtime/src/composition/index.ts)
   selects Node implementations, with explicit overrides only.
5. **Domain.** Pure policies decide results and return `EffectPlan` values.
6. **Durable services.** Node filesystem, Git, schema, transaction, and lock
   adapters perform effects behind ports.
7. **Project state.** `.brain/` owns workflow history and recovery records;
   `.claude/`, `.codex/`, `CLAUDE.md`, and `AGENTS.md` are bounded host-facing
   surfaces.

The package runtime is installed outside the application repository. A build
does not create a repository `dist/` directory and does not copy TypeScript,
runtime source, or `node_modules` into a user project. `CONFIRMED`

## 7. Domains and components

| ID | Component | Responsibility | Primary evidence |
| --- | --- | --- | --- |
| `CMP-CLI-001` | Command pipeline | Parse, observe, dispatch, apply, and publish | [`composition/cli.ts`](../../packages/runtime/src/composition/cli.ts) :: `runCommandLine` |
| `CMP-CONTRACTS-001` | Contract authority | Identities, compatibility, reason policy | [`compatibility.ts`](../../packages/contracts/src/compatibility.ts), [`reasons.ts`](../../packages/contracts/src/reasons.ts) |
| `CMP-SCHEMA-001` | Schema boundary | Select, compile, validate, and canonicalize contracts | [`domain/schema`](../../packages/runtime/src/domain/schema), [`infra/schema`](../../packages/runtime/src/infra/schema) |
| `CMP-PROJECT-001` | Project discovery | Canonical root, worktree, configuration precedence | [`domain/project`](../../packages/runtime/src/domain/project), [`composition/discovery.ts`](../../packages/runtime/src/composition/discovery.ts) |
| `CMP-INIT-001` | Initialization | Deterministic skeleton and managed sections | [`domain/init`](../../packages/runtime/src/domain/init), [`composition/init.ts`](../../packages/runtime/src/composition/init.ts) |
| `CMP-OBJECTIVE-001` | Objective lifecycle | Stable feature identity and replacement rules | [`domain/objective`](../../packages/runtime/src/domain/objective) |
| `CMP-WORKFLOW-001` | Workflow state machine | Start, continue, reject, resume, and complete | [`domain/workflow`](../../packages/runtime/src/domain/workflow) |
| `CMP-MODEL-ROLES-001` | Model-role policy | Fixed phase mapping, canonical resolution, independence, and assignment digest | [`domain/model-roles`](../../packages/runtime/src/domain/model-roles), [`composition/workflow.ts`](../../packages/runtime/src/composition/workflow.ts) |
| `CMP-GATES-001` | Gate policy | Ordered pure gate evaluation | [`evaluate.ts`](../../packages/runtime/src/domain/gates/evaluate.ts) |
| `CMP-EVIDENCE-001` | Approval and evidence | Digest binding, classification, and handoff | [`domain/approvals`](../../packages/runtime/src/domain/approvals), [`domain/evidence`](../../packages/runtime/src/domain/evidence) |
| `CMP-EVENTS-001` | Event store | Seal, verify, replay, and derive snapshot | [`domain/events`](../../packages/runtime/src/domain/events), [`composition/events.ts`](../../packages/runtime/src/composition/events.ts) |
| `CMP-TXN-001` | Transaction manager | Normalize, stage, publish, journal, and recover | [`domain/transactions`](../../packages/runtime/src/domain/transactions), [`composition/transactions.ts`](../../packages/runtime/src/composition/transactions.ts) |
| `CMP-LOCKS-001` | Concurrency authority | Claims, leases, fencing, takeover, and guards | [`domain/locks`](../../packages/runtime/src/domain/locks), [`composition/locks.ts`](../../packages/runtime/src/composition/locks.ts) |
| `CMP-GIT-001` | Git observation | Typed, read-only repository classification | [`domain/git`](../../packages/runtime/src/domain/git), [`composition/git.ts`](../../packages/runtime/src/composition/git.ts) |
| `CMP-RESULT-001` | Public results | Stable envelope, exit policy, rendering, sanitization | [`domain/result`](../../packages/runtime/src/domain/result) |
| `CMP-HOST-001` | Host protocol | Negotiation, delivery classification, operation messages | [`domain/host`](../../packages/runtime/src/domain/host), [`adapters`](../../packages/adapters/src/index.ts) |
| `CMP-MIGRATION-001` | Migration | Preview, authorize, receipt, rollback, upgrade primitives | [`domain/migration`](../../packages/runtime/src/domain/migration), [`composition/migration.ts`](../../packages/runtime/src/composition/migration.ts) |
| `CMP-OBS-001` | Diagnostics and observability | Status, doctor, audit, repair, bundles, dashboard | [`domain/diagnostics`](../../packages/runtime/src/domain/diagnostics), [`domain/observability`](../../packages/runtime/src/domain/observability) |
| `CMP-DIFF-001` | Differential harness | Isolated oracle/candidate comparison | [`packages/differential`](../../packages/differential/src) |

Post-1.0 extensions for policy packs, independent judges, Control Tower, and
signed evidence are isolated pure modules. They have no connected CLI,
composition, or production adapter path. `CONFIRMED`

## 8. Frontend and views

Kratos has no connected web frontend. `NOT FOUND`

The local dashboard is generated static HTML with escaped content and a
script-free Content Security Policy. It is an operational view, not a separate
application runtime. `CONFIRMED` —
[`renderStaticDashboard`](../../packages/runtime/src/domain/observability/index.ts).

## 9. Backend and APIs

Kratos has no network API server. `NOT FOUND`

Its public application boundary is a CLI and versioned host-operation message
protocol. The command registry exposes orientation, initialization, workflow,
approval, evidence, migration, diagnostics, audit, repair, bundle, and dashboard
operations. Machine consumers use `--json`; human output is a deterministic
rendering of the same result policy. `CONFIRMED`

## 10. Data and persistence

| ID | Durable data | Role | Integrity |
| --- | --- | --- | --- |
| `DAT-PROJECT-001` | `.brain/config.json` | Project, contract, and canonical host-role configuration | Exact current schema plus migration-only legacy classification |
| `DAT-FEATURE-001` | `.brain/02-features/<feature>/...` | Objective, active run, human artifacts | Managed transaction |
| `DAT-EVENT-001` | `events.jsonl` | Authoritative append-only history | Canonical JSON, revisions, hash chain |
| `DAT-SNAPSHOT-001` | `state.json` | Replay-derived current state | Bound to event cursor and hash |
| `DAT-APPROVAL-001` | Approval records | Human decisions bound to content and policy | Digests and revisions |
| `DAT-EVIDENCE-001` | Evidence records | Classified references to observed artifacts | SHA-256 content addressing |
| `DAT-LOCK-001` | Lease and lock event files | Concurrent mutation authority | Fencing token and event binding |
| `DAT-TXN-001` | `.brain/transactions/<id>/` | Journal, manifest, staging, recovery | Fingerprints and monotonic phases |
| `DAT-MIGRATION-001` | Migration plan and receipt | Authorized migration and rollback trail | Digest-bound authorization |

There is no relational or document database. Persistence is local filesystem
state with explicit schemas, path rules, limits, and durability operations.
`CONFIRMED`

Event-store limits are 64 KiB per event, 64 MiB per stream, and 100,000 events.
Streams require canonical JSONL, a final newline, contiguous revisions, and
matching predecessor hashes. Reducers and materializers are run twice to detect
hidden nondeterminism before a snapshot is accepted. `CONFIRMED`

## 11. Integrations

- **Codex and Claude Code:** thin, relay-only host surfaces. Both share the
  versioned host contract and runtime policy. Their versioned catalogs supply
  concrete defaults, aliases, canonical models, and supported efforts; the
  runtime owns phase mapping and independence.
- **Git:** fixed read-only commands classify repository, worktree, in-progress
  operation, and changes. The port resolves to a typed outcome rather than
  rejecting.
- **Go v3 oracle:** differential scenarios compare isolated before/after process,
  filesystem, structured output, and Git observations.
- **Local filesystem:** the sole connected durable state integration.

No outbound application network integration was found. `NOT FOUND`

## 12. Events and jobs

Workflow and lease transitions are stored as append-only events. They are
synchronous parts of managed command execution, not broker messages. There is no
queue consumer, scheduler, or background worker in the connected runtime.
`CONFIRMED`

## 13. Security, authorization, and tenancy

- Project roots and managed paths are canonicalized and constrained.
- Absolute paths, traversal, unsafe control characters, escaping symlinks,
  special files, and case collisions fail closed.
- Managed payloads use no-follow inspection, exclusive creation, file sync, and
  directory sync where supported.
- Public results reject terminal escapes, stack traces, absolute paths, common
  secret patterns, and unsafe evidence references.
- Git disables prompts and ambient system/global configuration and uses fixed
  arguments, timeouts, and buffers.
- Approval binds the run, content digests, policy, and revision.
- Lease ownership is local runtime authority, not user identity authentication.

There is no multitenant data model or remote identity provider. `NOT FOUND`

The event hash chain detects tampering but does not authenticate authorship.
Evidence classification and redaction metadata do not encrypt the referenced
artifact. `CONFIRMED`

## 14. Deployment and operation

The build creates separate Codex and Claude Code packages outside the checkout.
Each package carries a preflight, modular embedded ESM runtime, contracts,
schemas, and host assets. Package verification executes installation and the
`init → objective → start → status` smoke path for both hosts. `CONFIRMED`

Repository definitions exist for CI, CodeQL, dependency review, docs,
compatibility, native platforms, nightly, security, and release. Local
verification does not establish a remote run; external CI execution for the
current branch remains `PENDING` until observed.

## 15. Flow catalog

### `FLW-CLI-001` — command execution

`argv → parse → version expectation → command registry → prerequisite
observation → pure handler → result/plan consistency → preview or apply →
transaction → output`

Unexpected errors become a sanitized `runtime.internal_failure`; output is
published only after a successful commit.

### `FLW-INIT-001` — initialize a project

`root selection → answers source → schema validation → stack markers → pure
skeleton → managed-section policy → transaction with initialize root mode →
created/updated/preserved result`

The second identical run converges to a no-op. Existing unmarked instruction
files require explicit `--merge` or `--force`.

### `FLW-WORKFLOW-001` — objective to acceptance

`objective → feature identity → start → observe event/snapshot/Git/policy →
continue → evaluate gates → bind artifacts/evidence/approval → append event →
replay snapshot → done`

The six phases are `prd`, `spec`, `plan`, `code`, `review`, and `acceptance`.

Before handoff, the runtime maps `prd/spec/plan` to `planner`, `code` to
`implementer`, and `review/acceptance` to `judge`. It resolves every configured
role against the active host catalog and blocks canonical implementer/judge
equality. Missing or invalid routing has no cross-role fallback.

### `FLW-MODEL-ROLE-001` — handoff to audited phase result

`current config bytes → run/phase/revision → active host catalog → canonical
three-role resolution → independence check → selected assignment digest → host
relay → nullable observed execution → config/run/catalog revalidation → event
append`

`resolvedAssignment` is runtime policy. `observedIdentity` is validated host
observation; missing model or effort stays `null`. Prompt prose and agent output
cannot author either field. Drift returns `model.assignment_stale`; a known
host mismatch returns `model.execution_mismatch`; neither appends an event.

### `FLW-EVENT-001` — append and replay

`draft → inert copy → revision check → previous hash → canonical digest → schema
validation → JSONL append → stream verification → double reducer/materializer →
snapshot validation`

### `FLW-TXN-001` — managed mutation and recovery

`EffectPlan → allowlist → normalize/no-op → fingerprints → preflight → begun →
stage and sync → manifest → prepared → authorization/fencing → publishing →
ordered publication → committed → cleanup`

Recovery aborts before publication, rolls forward monotonically after publication,
and refuses ambiguous state.

### `FLW-MIGRATION-001` — legacy Brain and configuration migration

`read-only discovery → source contract declaration → conflict/sensitivity scan →
digest-bound plan → explicit authorization → transaction → receipt → optional
verified rollback`

For project configuration, the answers explicitly confirm enabled hosts and
the preview binds source, exact answer bytes, host catalogs, plan time, and six
final write bytes. Apply replaces only `.brain/config.json` plus its audit
bundle. Rollback verifies the current destination and exact prior-byte backup.

### `FLW-DIFF-001` — differential compatibility

`scenario → isolated oracle/candidate workspaces → bounded execution → before/after
capture → explicit normalization → structured comparison → digest-safe report`

Public scenarios prove the harness mechanism, not Go/TypeScript parity.

## 16. Business-rule catalog

| ID | Rule | Confidence |
| --- | --- | --- |
| `BR-CLI-001` | `--expect` is checked before command resolution. | CONFIRMED |
| `BR-PROJECT-001` | Explicit root never silently falls back to an ancestor. | CONFIRMED |
| `BR-PROJECT-002` | Legacy sibling Brain state is migration-only, never implicit current state. | CONFIRMED |
| `BR-INIT-001` | Answers from stdin and `--answers` are mutually exclusive. | CONFIRMED |
| `BR-INIT-002` | Managed sections preserve user-owned bytes outside markers. | CONFIRMED |
| `BR-OBJECTIVE-001` | Feature identity derives only from normalized objective text. | CONFIRMED |
| `BR-OBJECTIVE-002` | A divergent active objective requires explicit replacement. | CONFIRMED |
| `BR-WORKFLOW-001` | Start requires an active objective and clean worktree. | CONFIRMED |
| `BR-WORKFLOW-002` | Continue requires the current revision and matching run/feature. | CONFIRMED |
| `BR-WORKFLOW-003` | Missing artifacts, evidence, or passed gates records rejection. | CONFIRMED |
| `BR-MODEL-001` | The phase-to-role map is fixed and runtime-owned; prompts and adapters cannot remap it. | CONFIRMED |
| `BR-MODEL-002` | Bare model names normalize to effort `medium`; missing or invalid routing never falls back. | CONFIRMED |
| `BR-MODEL-003` | Canonical implementer/judge equality is a strict refusal, not a warning. | CONFIRMED |
| `BR-MODEL-004` | Handoff and append bind current config, run, revision, phase, host, role, model, and effort. | CONFIRMED |
| `BR-MODEL-005` | Unknown host execution remains nullable and cannot be inferred from configured or agent-authored text. | CONFIRMED |
| `BR-GATE-001` | Gate failures have stable precedence from context through acceptance. | CONFIRMED |
| `BR-APPROVAL-001` | Approval binds exact run, content, policy, and revision digests. | CONFIRMED |
| `BR-ACCEPTANCE-001` | Done requires acceptance phase, approval, evidence, lineage, and passing gates. | CONFIRMED |
| `BR-SCHEMA-001` | Version selection and inert structural validation precede domain use. | CONFIRMED |
| `BR-EVENTS-001` | Every event advances exactly one revision and binds its predecessor hash. | CONFIRMED |
| `BR-EVENTS-002` | A snapshot is valid only when reproducible from the verified stream. | CONFIRMED |
| `BR-EVIDENCE-001` | Evidence is content-addressed; restricted evidence cannot verify with no redaction. | CONFIRMED |
| `BR-RESULT-001` | The reason catalog owns status, exit, retry, recovery, and evidence policy. | CONFIRMED |
| `BR-TXN-001` | Callers mutate only `.brain`, `.claude`, `.codex`, `AGENTS.md`, and `CLAUDE.md` within closed rules. | CONFIRMED |
| `BR-TXN-002` | Destination fingerprints are checked immediately before publication. | CONFIRMED |
| `BR-TXN-003` | Recovery aborts before publishing and only rolls forward afterward. | CONFIRMED |
| `BR-LOCKS-001` | Renew/release require exact identity and a still-writable lease. | CONFIRMED |
| `BR-LOCKS-002` | Takeover is explicit and only legal after expiry plus skew. | CONFIRMED |
| `BR-LOCKS-003` | Fencing tokens never decrease and advance for a new ownership epoch. | CONFIRMED |
| `BR-GIT-001` | Git observation is read-only and resolves every failure as typed data. | CONFIRMED |
| `BR-MIGRATION-001` | Migration never overwrites divergent current project content. | CONFIRMED |
| `BR-MIGRATION-002` | Configuration migration changes only config plus its audit bundle and preserves historical bytes. | CONFIRMED |
| `BR-OBS-001` | Repair requires exact plan digest and immediate re-observation. | CONFIRMED |

## 17. Symbol catalog

The complete per-file symbol inventory is in
[`architecture-coverage.csv`](architecture-coverage.csv). Architecturally
central public symbols include:

- `runCli`, `runCommandLine`, `parseInvocation`, `dispatch`, `DEFAULT_REGISTRY`;
- `createRuntime`, `createRuntimeAt`, `applyPlan`, `previewPlan`;
- `resolveProject`, `resolveRoot`, `observeWorkspace`;
- `resolveInitAnswers`, `skeletonEffects`, `planManagedFile`;
- `featureIdentity`, `decideObjective`;
- `decideStartWorkflow`, `decideContinueWorkflow`, `reduceWorkflow`;
- `PHASE_MODEL_ROLE`, `resolvePhaseAssignmentDetailed`,
  `validateHostIndependence`, `digestPhaseAssignment`;
- `evaluateGates`, `issueApproval`, `decideDone`;
- `sealEvent`, `verifyEventStream`, `replayEventStream`;
- `normalizeManagedMutationPlan`, `executeManagedMutation`, `decideRecovery`;
- `createLocks`, `prepareLeaseGuard`, `decideTakeover`;
- `compileSchemaRegistry`, `canonicalizeJson`;
- `resultFor`, `validateResult`, `renderResultJson`;
- `createHostAdapter`, `runScenario`, `compareObservations`.

## 18. Dependency matrix

| Source | Target | Type | Sync | Data / protocol | Failure policy |
| --- | --- | --- | --- | --- | --- |
| Host package | Runtime CLI | process / message | Yes | argv, stdin, host contract | Stable result envelope |
| CLI composition | Schema registry | function | Yes | versioned unknown input | Fail closed and sanitize |
| Composition | Domain | function | Yes | explicit observations | Typed decision/refusal |
| Domain | Ports | type dependency | Yes | capabilities only | No implementation access |
| Composition | Node infrastructure | dependency injection | Yes | RuntimePorts | Errors mapped at boundary |
| Transaction manager | Durable filesystem | filesystem | Yes | journal, staging, fingerprints | Recover or block ambiguity |
| Event store | Digests / schema | function | Yes | canonical event and snapshot | Corruption refusal |
| Lock service | Transaction/event store | filesystem/event | Yes | lease, fencing, claim | Conflict/recovery reason |
| Git composition | Git process runner | subprocess | Yes | fixed porcelain v2 commands | Typed non-throwing outcome |
| Adapters | Contracts | import/message | Yes | adapter-message@1.1, catalog and nullable execution facts | Negotiation or model refusal |
| Differential harness | Oracle/candidate | subprocess | Yes | bounded scenario contract | Timeout/resource mismatch |

Enforced direction: `domain → domain/ports/contracts`, `ports → domain`,
`infra → ports/domain`, `composition → all lower layers`, and only entry points
may import composition. [`tests/architecture.test.ts`](../../tests/architecture.test.ts)
checks the dependency graph. `CONFIRMED`

## 19. Errors, retries, and transactions

Public errors are policy objects, not arbitrary exception strings. The current
reason catalog contains success, failure, and blocked outcomes with stable exit
codes, retryability, recovery text, evidence policy, and state-change limits.

Key operational outcomes:

- `runtime.revision_conflict`: observation changed before commit or preview.
- `runtime.recovery_required`: an incomplete managed transaction blocks work.
- `runtime.state_corrupt`: ambiguity or integrity mismatch requires inspection.
- `runtime.lease_conflict`: another valid lease owns the resource.
- `guard.outside_allow`: requested mutation crosses a managed boundary.
- `runtime.internal_failure`: sanitized unexpected failure with no internal data.
- `model.config_migration_required`: current execution requires a role-aware
  project configuration.
- `model.independence_violation`: implementer and judge share one canonical
  identity; strict refusal replaced the contradictory warning proposal.
- `model.assignment_stale` / `model.execution_mismatch`: a returned handoff or
  known host observation does not match the current runtime selection.

Retry is safe only where the reason catalog allows it and the operation carries
idempotency or current-revision context. Transaction recovery is content-bound;
after partial publication Kratos does not attempt an optimistic rollback.

## 20. Tests and evidence

The repository contains unit, property, contract, filesystem, real Git,
real-process contention, fault injection, package, documentation, and
differential tests. Shared contract suites exercise Node and fake port
implementations.

Issue #136 has a criterion-by-criterion local evidence record at
[`issue-136-model-role-evidence.md`](../verification/issue-136-model-role-evidence.md).
It records the exact focused command, the complete `npm run verify` gate, and
`git diff --check` from the final implementation state. That local evidence is
not a claim that remote CI or signed-in host E2E passed.

## 21. Risks, debt, and contradictions

| ID | Status | Finding | Evidence / impact |
| --- | --- | --- | --- |
| `RSK-006` | CONFIRMED | Host negotiation/delivery primitives are not fully wired through `hook`. | Protocol domain is broader than the connected command path |
| `RSK-007` | CONFIRMED | Compatibility remains `0 / 400`; real host E2E and public pilots are pending. | Experimental maturity only |
| `RSK-008` | CONFIRMED | Hash chains do not authenticate authors; evidence metadata does not encrypt content. | Security boundary must remain explicit |
| `RSK-009` | CONFIRMED | Lock and transaction composition concentrate more than 6,000 lines of complex concurrency code. | High maintenance and regression surface |
| `RSK-010` | CONFIRMED | Some fixtures prove schema shape, not lifecycle semantics or real digest validity. | Examples must not be read as verified histories |
| `RSK-011` | CONFIRMED | Runtime/toolchain minimums differ across package, pins, and distributed preflight. | Contributor and deployment ambiguity |
| `RSK-012` | CONFIRMED | Remote is `kratos-harness`; policy links also reference `kratos`. | Public repository naming should be reconciled before release |

## 22. Gaps, assumptions, and pending decisions

- `PENDING`: Decide the final public repository name and canonical URLs.
- `PENDING`: Choose and execute representative signed-in Codex and Claude Code
  E2E scenarios.
- `PENDING`: Produce public-beta pilot evidence and human graduation approval.
- `PENDING`: Decide which `.brain/` surfaces teams should version, ignore,
  encrypt, or synchronize.
- `INFERRED`: “Open-source development harness” is the clearest public category
  for the implemented architecture; it is product positioning, not a runtime
  behavior.

## 23. Evidence index

Primary architecture evidence:

- [`runtime boundaries`](runtime-boundaries.md)
- [`event store`](event-store.md)
- [`atomic transactions`](atomic-transactions.md)
- [`concurrency locks`](concurrency-locks.md)
- [`workflow state machine`](workflow-state-machine.md)
- [`gates, approvals, and evidence`](gates-approvals-evidence.md)
- [`host adapter protocol`](host-adapter-protocol.md)
- [`project discovery`](project-discovery.md)
- [`project initialization`](project-initialization.md)
- [`schema registry`](schema-registry.md)
- [`threat model`](../security/threat-model.md)
- [`runtime package`](../../packages/runtime/src)
- [`contract package`](../../packages/contracts)
- [`test suite`](../../tests)
- [`repository wiki`](../../wiki/Home.md)

## 24. Coverage statistics

The initial conservative inventory discovered 524 source/configuration/document
files. This report and the repository wiki add thirteen eligible Markdown
artifacts, producing a final 537 classified files:

| Status | Count | Meaning |
| --- | ---: | --- |
| `analyzed` | 486 | Current authored source, tests, configuration, and documentation examined for architectural responsibility |
| `partial` | 0 | No partially classified files |
| `excluded-out-of-scope` | 50 | Historical planning or local task-state material |
| `excluded-generated` | 1 | Generated contract declarations |
| `blocked-sensitive` | 0 | No sensitive content was required or opened |
| `blocked-unreadable` | 0 | No unreadable eligible file |

Coverage of the included analysis set is `486 / 486 = 100%`. This is repository
investigation coverage, not runtime test coverage and not a production-readiness
claim.
