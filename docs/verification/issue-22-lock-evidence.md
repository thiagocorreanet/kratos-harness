# Issue #22 Concurrency Lock Evidence

Issue [#22](https://github.com/thiagocorreanet/mestre-yoda/issues/22)
(`RUN-07`) records verification for durable concurrency locks and recoverable
work leases. This record does not claim compatibility parity credit or a public
command.

## Environment

| | |
| --- | --- |
| Date | 2026-08-13 |
| Commit under test | `3addf0f9d88566909196a29eee8763d423a1e422` |
| Platform | Linux 7.0.0-28-generic |
| Node.js | v24.18.0 |
| npm | 11.16.0 |

## Documentation-contract RED

Before `docs/architecture/concurrency-locks.md` existed, this command exited 1:

```bash
npx vitest run tests/architecture.test.ts
```

The suite could not open the absent document. The run reported 1 failed file,
40 passed tests, and 45 skipped tests.

## Focused lock evidence

```bash
npx vitest run tests/lock-model.test.ts tests/lock-lifecycle.test.ts \
  tests/lock-policy-properties.test.ts tests/lock-claims.test.ts \
  tests/locks-contract.test.ts tests/lock-service.test.ts \
  tests/transaction-lease-guard.test.ts tests/transaction-fencing-recovery.test.ts \
  tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts \
  tests/architecture.test.ts tests/contract-documentation.test.ts
```

PASS — 12 files, 798 tests, 24.19s.

| Suite | Tests | Covers |
| --- | --- | --- |
| `lock-model` | 16 | Scope encoding, owner parsing, time classification |
| `lock-lifecycle` | 21 | Hash-linked trail, digest binding, token sequence |
| `lock-policy-properties` | 7 | Acquire, renew, release, and takeover decisions |
| `lock-claims` | 380 | Durable claim namespace, admission, recovery |
| `locks-contract` | 4 | One shared suite over both implementations |
| `lock-service` | 13 | Request validation before durable I/O |
| `transaction-lease-guard` | 20 | Guarded publication and binding refusal |
| `transaction-fencing-recovery` | 3 | Fencing across a crashed transaction |
| `lock-schedules` | 241 | Model-based interleaving |
| `lock-fault-campaign` | 2 | Crash boundaries and residue classification |

## Interleaving campaign

`tests/lock-schedules.test.ts` runs a state model written from the published
lease rules against the real service. The default corpus is the 240 schedules
of six actions that open with an acquisition; the outcome, the authoritative
fencing token, and the owner are checked after every step of every schedule.

Schedules whose leading actions all conflict reach the same state as the
schedule with that prefix removed, so they are redundant rather than
unexplored. All 720 permutations run under
`YODA_TEST_EXHAUSTIVE_LOCK_SCHEDULES=1`, which was verified separately at 721
tests in 48.19s.

Both default runs reported identical case counts (243) with no seed dependency.

## Fault campaign

`tests/lock-fault-campaign.test.ts` interrupts an acquire-then-guarded-commit
scenario at all 328 mutating durable boundaries it reaches. Two facts hold at
every one: a caller effect is whole or absent, and every failure names an
artifact under `.brain/transactions/` or `.brain/locks/`.

| Class | Count | Meaning |
| --- | --- | --- |
| Unchanged | 240 | Nothing published; recovery settled the residue |
| Published | 74 | The effect landed; recovery rolled it forward |
| Explicit recovery | 8 | A person must run the recovery this subsystem offers |
| Repair | 4 | Claim bytes no protocol can interpret; `OBS-02` (#45) |
| Inert | 2 | The call's own effect throws first, so the fault cannot fire |

The distribution is pinned in the test. A protocol change that moves boundaries
between these classes has to be acknowledged rather than passing unnoticed.

## Acceptance criteria

| Criterion | Proven by |
| --- | --- |
| At most one valid writer commits a protected transition | `lock-schedules` — owner and token asserted after every step of 240 schedules; `locks-contract` |
| A stale worker cannot commit after a newer fencing token exists | `transaction-lease-guard` — "refuses a guard whose fencing token a takeover has superseded"; `transaction-fencing-recovery` — "refuses to publish once a newer fencing token owns the lock" |
| Conflict output identifies owner, scope, whether a retry is safe, and the next action without leaking secrets | `lock-service`, `locks-contract`; `lock-fault-campaign` asserts every failure names an actionable artifact |
| Lock scope, owner, lease duration, fencing token, conflict result, stale detection defined | `docs/architecture/concurrency-locks.md`; `lock-model`, `lock-policy-properties` |
| Locks acquired atomically before mutation with lifecycle events recorded | `lock-lifecycle`, `lock-claims`, `transaction-lease-guard` |
| Read-only operations during safe states, explicit recovery of stale leases | `locks-contract`, `lock-claims`; takeover is explicit in `lock-policy-properties` |
| PID-only assumptions cannot break across containers or hosts | Owner identity is `<host>:<session-id>`; no PID is read anywhere in `packages/runtime/src` |
| Deterministic interleaving and model tests | `lock-schedules` |
| Multi-process contention, crash, renewal, stale takeover, clock skew | **Partial** — see below |

## Known boundary

Multi-process contention is not proven here. Writing that suite exposed two
defects the single-threaded fake could not reach, both fixed in
`fix: stop reading concurrent cleanup as corruption`: `createDirectory` losing
an `EEXIST` race, and candidate validation reading a vanished entry as
corruption.

What remains is that real OS-level interleaving can still misclassify a worker
that loses the admission election, reporting `runtime.internal_failure` instead
of a conflict. Mutual exclusion is not affected — exactly one contender
acquires in every observed round — but the losers' classification is.
Issue [#99](https://github.com/thiagocorreanet/mestre-yoda/issues/99) owns
finishing that work, and the worker and harness it will build on are preserved
on the `spike/multi-process-lock-harness` branch.

Seven concurrency branches in `composition/locks.ts` carry coverage directives
rather than tests. An entry whose name a listing just returned always still
exists in a single process, so no test in this repository can schedule the
interleaving that reaches them.

## Final repository gate

Each command was run separately from a clean tree at the commit above. The
documentation commit carrying this record adds only documents and test
assertions; `npm test` and `npm run test:coverage` were re-run on it and
reported identical totals.

| Command | Result |
| --- | --- |
| `npm test` | PASS — 107 files, 3298 tests, 133.85s |
| `npm run test:coverage` | PASS — 100% statements (4251/4251), branches (2969/2969), functions (617/617), lines (3775/3775) |
| `npm run format:check` | PASS |
| `npm run spellcheck` | PASS — 81 files, 0 issues |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run oracle:verify` | PASS — 12 surfaces, 4 PRD anchors, 3 binaries |
| `npm run parity:check` | PASS — 0 / 400 (0.00%), unchanged |
| `npm run result:check` | PASS — 76 reasons, exits 0–5, 6 examples |
| `npm run contracts:check` | PASS — 10 schemas, 14 legacy profiles, generated types current |
| `npm run differential:check` | PASS — self-test equal |
| `npm run build` | PASS |
| `npm run package:verify` | PASS |

Parity is unchanged at 0 / 400. This issue delivers runtime semantics, not a
command surface, so no frozen parity row moves.
