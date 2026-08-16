# Issue #21 Event Store Evidence

Issue [#21](https://github.com/thiagocorreanet/kratos-harness/issues/21)
(`RUN-06`) records verification for the internal append-only event store. The
evidence below reports results captured by Tasks 1–7 and the final repository
gate. Durations appear only where the prior run captured one. This record does
not claim compatibility parity credit or a public command.

## Documentation-contract RED

Before the documentation and README changes, the following command exited 1:

```bash
npx vitest run tests/architecture.test.ts tests/readme-honesty.test.ts
```

The architecture suite could not open the absent
`docs/architecture/event-store.md`, and the README contract found no delivered
`RUN-06` row. The run reported 2 failed files, 1 failed test, 55 passed tests,
and 31 skipped tests in 376ms.

## Event-domain focused evidence

Task 1 recorded the following final focused command:

```bash
npx vitest run tests/event-sealing.test.ts tests/architecture.test.ts
```

It passed 2 files and 93 tests after the independent unsigned-field digest and
successor-predecessor coverage.

Task 2 recorded this final focused command:

```bash
npx vitest run tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-chain-properties.test.ts
```

It exited 0 with 3 files and 3,664 tests in 308.68 seconds. The focused
`tests/event-chain.test.ts` boundary run separately passed 1 file and 20 tests
in 601ms. Its deterministic campaign covers 200 generated streams of lengths
1 through 32, all protected scalar mutations, record deletion, duplication,
and adjacent swaps. A terminal deletion is a valid shorter prefix without an
external cursor; snapshot binding supplies that anchor at the event-store
boundary.

Task 3 recorded:

```bash
npx vitest run tests/event-reducer.test.ts tests/event-reducer-properties.test.ts tests/event-chain.test.ts
```

It passed 3 files and 31 tests. The 200-stream replay campaign, partitioned
into eight default-timeout tests, completed in 6.75 seconds; no custom timeout
was configured.

## Preparation and commit evidence

Task 4 recorded `tests/event-store-preparation.test.ts` passing 38 tests after
the follow-up hardening. Its earlier focused composition, architecture, and
package-boundary command passed 78 tests. The preparation checks both
run-scoped destinations before reading, remeasures read bytes against the
observed fingerprint, verifies stream replay and snapshot binding, and returns
exactly two writes without performing mutation.

Task 5 recorded the following final focused slice:

```bash
npx vitest run tests/event-store-transaction.test.ts tests/runtime-composition.test.ts tests/transaction-execution.test.ts tests/transaction-recovery.test.ts tests/transaction-normalization.test.ts tests/event-reducer-boundary.test.ts tests/event-reducer-properties.test.ts tests/event-store-preparation.test.ts tests/architecture.test.ts tests/package-boundaries.test.ts tests/result-validation.test.ts tests/cli-composition.test.ts
```

It passed 12 files and 485 tests. The earlier transaction and runtime
composition command passed 192 tests, and the architecture, package, result,
CLI, and normalization command passed 153 tests. The declarative pre-marker
preconditions re-inspect the exact event/snapshot pair before marker creation;
drift is `runtime.revision_conflict` and emits nothing.

## Persisted corruption and recovery evidence

Task 6's corruption matrix committed three LF-terminated records and a
snapshot bound to cursor 3 and the tail hash. It refused a fourth append with
paired `runtime.state_corrupt` evidence for 10 rows: protected-byte mutation;
first, middle, and stale-tail removal; adjacent reorder; duplication; changed
predecessor hash; changed event hash; changed snapshot cursor; and changed
snapshot hash. For every refusal, the filesystem snapshot remained exactly
equal, the mutation trace remained empty, and no transaction marker, staging
directory, write, or directory operation was created.

The focused commands recorded by Task 6 were:

```bash
npx vitest run tests/event-store-corruption.test.ts
npx vitest run tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts tests/runtime-distribution.test.ts
npx vitest run tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts tests/runtime-distribution.test.ts tests/event-store-transaction.test.ts tests/transaction-recovery.test.ts tests/node-transactions.test.ts tests/transaction-process-recovery.test.ts
```

They passed 10, 42, and 150 tests respectively. The mutation check temporarily
neutralized the snapshot-binding guard; exactly the snapshot-cursor and
snapshot-hash rows then failed, and the source was restored byte-for-byte before
the matrix passed again.

The successful fourth-append trace had 174 execution occurrences and injected
all 348 before/after execution boundaries. Prepared recovery reached 76
occurrences and 152 before/after boundaries; publishing recovery reached 100
occurrences and 200 boundaries. Together the execution and recovery campaigns
injected exactly 700 boundaries. Pre-publication states recover to the OLD
event/snapshot pair and `aborted`; publishing and committed states roll forward
to the NEW pair and `committed`. No mixed old/new pair is accepted.

The real Node filesystem scenarios committed two events, recreated ports,
replayed durable state, and appended a third event. They also refused escaping
stream and snapshot symlinks without changing outside sentinels, a
case-colliding run directory, a FIFO stream, and a Unicode run ID. The Unicode
case proved zero durable-port calls. Symlink setup skipped only when creation
returned the specific access-denied, operation-not-permitted, or
operation-not-supported filesystem code; FIFO coverage is Windows-gated, and
the read-only-directory case is gated only where host permissions cannot make
the assertion meaningful.

## Recorded checks before this final gate

Tasks 1–6 recorded successful `format:check`, `lint`, and `typecheck` runs;
Tasks 5 and 6 additionally recorded successful `spellcheck`, result-contract,
and package verification as applicable. Task 6 recorded `npm test` exit 0 but
did not capture a final Vitest summary, so this evidence intentionally does not
infer a test count from that run.

## Final repository gate

Command:

```bash
npm run verify
```

Result: exit 0. Formatting, spelling, lint, typecheck, full tests, coverage,
oracle verification, parity inventory, result-contract checks, contract drift,
differential checks, build, and package verification all completed
successfully. The command did not grant new parity credit.

## Final remediation note

Later review remediation makes verified streams opaque, deeply frozen values
with private in-module provenance; replay rejects structural copies and forged
streams. Append preparation snapshots the reducer registry before its first
durable await, binds both persisted and next replay snapshots to the requested
run ID, and treats cross-realm synchronous capability Promises as sanitized
failures after attaching a rejection handler. These protections do not turn
callback double-runs into a proof of determinism: the guarantee remains
conditional on caller-supplied reducers and materializers being pure and free
of ambient mutable state. This note supplements rather than rewrites the
historical task and gate records above.
