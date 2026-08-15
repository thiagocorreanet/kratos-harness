# Concurrency Locks and Recoverable Work Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable project/run write leases whose monotonic fencing tokens prevent stale workers from committing, while supporting renewal, release, explicit takeover, safe reads, and reproducible concurrency evidence.

**Architecture:** Pure lock-domain modules validate identities, time boundaries, lifecycle transitions, and hash-linked `EventV1` audit records. A composition service applies those decisions through the existing durable filesystem and managed transaction boundary; protected transactions persist and revalidate an exact `LeaseGuard` before publication and recovery. The same service runs over fake and Node durable filesystems, so policy exists once and adapters differ only at the existing effect boundary.

**Tech Stack:** TypeScript 6.0.2, Node.js 24.18.0, npm 11.16.0, Vitest 4.1.10, existing Ajv-backed schema registry, existing SHA-256/event/transaction primitives.

## Global Constraints

- Keep source, tests, fixtures, comments, errors, documentation, commits, and PR text in English.
- Keep `contractVersion` and `stateContract` at `1.0.0`; do not modify published state, event, transaction, or result schemas.
- Add no runtime or development dependency.
- Resources are exactly `project` or `run:<run-id>`; map them to `.brain/locks/project/` and `.brain/locks/runs/<encoded-run-id>/`, where the valid ASCII run ID uses canonical unpadded Base64URL.
- Owners are exactly `<host>:<session-id>` where each component matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`.
- Default lease TTL is 30 seconds, renewal threshold is 10 seconds, skew allowance is 5 seconds, accepted TTL range is 5 seconds through 5 minutes, and administrative claim TTL is 30 seconds.
- Expiry only permits explicit takeover; a durable fencing token remains the publication authority.
- Read-only work requires no lease only when transactions and canonical state are safe and the operation materializes no bytes.
- Never persist or render PID, raw hostname, absolute path, environment value, prompt, source content, credential, stack trace, or dependency error text.
- Follow strict RED → verify RED → GREEN → verify GREEN → commit for every task.
- Preserve 100% statement, branch, function, and line coverage.

## Specification Coverage Map

| Approved requirement | Owning task |
| --- | --- |
| Scope hierarchy, portable paths, owner identity, and exact time policy | Task 1 |
| `EventV1` lifecycle chain, lease digest binding, and monotonic token policy | Task 2 |
| Closed durable layout, claims, claim recovery, and sanitized inspection | Task 3 |
| Acquire, renew, release, takeover, admission, and fake/Node equivalence | Task 4 |
| Transaction guard persistence, stale-worker fencing, and recovery checks | Task 5 |
| Deterministic schedules and every durable fault boundary | Task 6 |
| Real multi-process contention, crash, renewal, takeover, and clock skew | Task 7 |
| Safe reads, public architecture, acceptance evidence, coverage, and full repository gates | Task 8 |

No approved requirement is deferred to a later issue. Later workflow issues
consume the lock API but cannot redefine authority, expiry, fencing, or
takeover.

---

### Task 1: Lock Domain Model, Scope, Identity, and Time Boundaries

**Files:**

- Create: `packages/runtime/src/domain/locks/model.ts`
- Create: `packages/runtime/src/domain/locks/scope.ts`
- Create: `packages/runtime/src/domain/locks/index.ts`
- Create: `tests/lock-model.test.ts`

**Interfaces:**

- Consumes: `LockLeaseV1` from `@mestre-yoda/contracts`; no effect port and no Node builtin.
- Produces: `LeaseResource`, `LeaseIdentity`, request/outcome types, `LeaseGuard`, `LockPaths`, `LeasePolicyError`, `lockPaths()`, `parseOwner()`, `validateTtl()`, and `classifyLeaseTime()`.

- [ ] **Step 1: Write the failing domain contract tests**

```ts
import {
  CLAIM_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  LEASE_RENEWAL_THRESHOLD_MS,
  LEASE_SKEW_MS,
  classifyLeaseTime,
  lockPaths,
  parseOwner,
  validateTtl,
} from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

describe("lock domain boundaries", () => {
  it.each([
    ["project", ".brain/locks/project"],
    ["run:run-01", ".brain/locks/runs/cnVuLTAx"],
    ["run:group:run-01", ".brain/locks/runs/Z3JvdXA6cnVuLTAx"],
  ] as const)("maps %s without exposing contract separators", (resource, root) => {
    expect(lockPaths(resource)).toEqual({
      root,
      lease: `${root}/lease.json`,
      events: `${root}/events.jsonl`,
      claim: `${root}/claim`,
      claimRecord: `${root}/claim/claim.json`,
      admissionClaim: ".brain/locks/.admission/claim",
      admissionRecord: ".brain/locks/.admission/claim/claim.json",
    });
  });

  it.each(["run:", "run:a/b", "run:a\\b", "Project", ".admission"])(
    "rejects invalid resource %s",
    (resource) => expect(() => lockPaths(resource)).toThrow("Lock input is invalid"),
  );

  it("closes owner and duration policy", () => {
    expect(parseOwner("codex:session-01")).toEqual({
      host: "codex",
      sessionId: "session-01",
      value: "codex:session-01",
    });
    expect(() => parseOwner("codex:session:01")).toThrow("Lock input is invalid");
    expect(validateTtl(5_000)).toBe(5_000);
    expect(validateTtl(300_000)).toBe(300_000);
    expect(() => validateTtl(4_999)).toThrow("Lock input is invalid");
    expect(() => validateTtl(300_001)).toThrow("Lock input is invalid");
    expect({
      CLAIM_TTL_MS,
      DEFAULT_LEASE_TTL_MS,
      LEASE_RENEWAL_THRESHOLD_MS,
      LEASE_SKEW_MS,
    }).toEqual({
      CLAIM_TTL_MS: 30_000,
      DEFAULT_LEASE_TTL_MS: 30_000,
      LEASE_RENEWAL_THRESHOLD_MS: 10_000,
      LEASE_SKEW_MS: 5_000,
    });
  });

  it.each([
    ["2026-08-11T00:00:29.999Z", "writable"],
    ["2026-08-11T00:00:30.000Z", "skew"],
    ["2026-08-11T00:00:34.999Z", "skew"],
    ["2026-08-11T00:00:35.000Z", "takeover_eligible"],
  ] as const)("classifies %s as %s", (now, expected) => {
    expect(
      classifyLeaseTime(
        new Date(now),
        new Date("2026-08-11T00:00:30.000Z"),
      ),
    ).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `npx vitest run tests/lock-model.test.ts`

Expected: FAIL because `@mestre-yoda/runtime/domain/locks` does not exist.

- [ ] **Step 3: Implement the closed model and validators**

```ts
// packages/runtime/src/domain/locks/model.ts
import type { EventV1, LockLeaseV1 } from "@mestre-yoda/contracts";
import type { PathFingerprint } from "../transactions/index.js";

export const DEFAULT_LEASE_TTL_MS = 30_000;
export const LEASE_RENEWAL_THRESHOLD_MS = 10_000;
export const LEASE_SKEW_MS = 5_000;
export const MIN_LEASE_TTL_MS = 5_000;
export const MAX_LEASE_TTL_MS = 300_000;
export const CLAIM_TTL_MS = 30_000;

export type LeaseResource = "project" | `run:${string}`;
export type LeaseTimeState = "writable" | "skew" | "takeover_eligible";
export type LeaseSuccessKind = "acquired" | "renewed" | "released" | "taken_over";

export interface LeaseIdentity {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly stateRevision: number;
}

export interface LeaseGuard extends LeaseIdentity {
  readonly leaseFingerprint: PathFingerprint;
  readonly eventsFingerprint: PathFingerprint;
}

export interface LeaseObservation {
  readonly kind: "empty" | "active" | "released" | "skew" | "takeover_eligible";
  readonly lease: LockLeaseV1 | null;
  readonly guard: LeaseGuard | null;
}

export interface AcquireLeaseRequest {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly ttlMs: number;
  readonly stateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface RenewLeaseRequest {
  readonly observed: LeaseGuard;
  readonly ttlMs: number;
  readonly resultingStateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface ReleaseLeaseRequest {
  readonly observed: LeaseGuard;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface TakeoverLeaseRequest {
  readonly observed: LeaseGuard;
  readonly owner: string;
  readonly ttlMs: number;
  readonly stateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface LeaseConflict {
  readonly owner: string;
  readonly resource: LeaseResource;
  readonly expiresAt: string;
  readonly retryable: true;
  readonly recovery: "wait_or_takeover";
}

export type LeaseOutcome =
  | {
      readonly kind: LeaseSuccessKind;
      readonly lease: LockLeaseV1;
      readonly guard: LeaseGuard;
      readonly event: EventV1;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "conflict"; readonly conflict: LeaseConflict }
  | {
      readonly kind: "recovery_required" | "revision_conflict" | "corrupt" | "internal_failure";
      readonly evidence: readonly string[];
    };

export class LeasePolicyError extends Error {
  public constructor(public readonly kind: "invalid_input" | "invalid_transition") {
    super("Lock input is invalid");
    this.name = "LeasePolicyError";
  }
}
```

```ts
// packages/runtime/src/domain/locks/scope.ts
import {
  LEASE_SKEW_MS,
  MAX_LEASE_TTL_MS,
  MIN_LEASE_TTL_MS,
  LeasePolicyError,
  type LeaseResource,
  type LeaseTimeState,
} from "./model.js";

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ownerPart = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;
const base64url = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeRunId(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : null;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : null;
    encoded += base64url[first >> 2]!;
    encoded += base64url[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!;
    if (second !== null)
      encoded += base64url[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!;
    if (third !== null) encoded += base64url[third & 0x3f]!;
  }
  return encoded;
}

export interface LockPaths {
  readonly root: string;
  readonly lease: string;
  readonly events: string;
  readonly claim: string;
  readonly claimRecord: string;
  readonly admissionClaim: string;
  readonly admissionRecord: string;
}

export function lockPaths(input: string): LockPaths {
  const root =
    input === "project"
      ? ".brain/locks/project"
      : input.startsWith("run:") && id.test(input.slice(4))
        ? `.brain/locks/runs/${encodeRunId(input.slice(4))}`
        : null;
  if (root === null) throw new LeasePolicyError("invalid_input");
  return {
    root,
    lease: `${root}/lease.json`,
    events: `${root}/events.jsonl`,
    claim: `${root}/claim`,
    claimRecord: `${root}/claim/claim.json`,
    admissionClaim: ".brain/locks/.admission/claim",
    admissionRecord: ".brain/locks/.admission/claim/claim.json",
  };
}

export function parseOwner(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2 || !ownerPart.test(parts[0] ?? "") || !ownerPart.test(parts[1] ?? ""))
    throw new LeasePolicyError("invalid_input");
  return { host: parts[0]!, sessionId: parts[1]!, value } as const;
}

export function validateTtl(ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_LEASE_TTL_MS || ttlMs > MAX_LEASE_TTL_MS)
    throw new LeasePolicyError("invalid_input");
  return ttlMs;
}

export function classifyLeaseTime(now: Date, expiresAt: Date): LeaseTimeState {
  const current = now.getTime();
  const expiry = expiresAt.getTime();
  if (!Number.isFinite(current) || !Number.isFinite(expiry)) throw new LeasePolicyError("invalid_input");
  if (current < expiry) return "writable";
  return current < expiry + LEASE_SKEW_MS ? "skew" : "takeover_eligible";
}
```

Export every symbol from `domain/locks/index.ts`.

- [ ] **Step 4: Verify GREEN and domain layering**

Run: `npx vitest run tests/lock-model.test.ts tests/architecture.test.ts && npm run typecheck`

Expected: both test files PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the lock model**

```bash
git add packages/runtime/src/domain/locks tests/lock-model.test.ts
git commit -m "feat: define recoverable lease model"
```

### Task 2: Hash-Linked Lease Lifecycle and Pure Transition Policy

**Files:**

- Create: `packages/runtime/src/domain/locks/lifecycle.ts`
- Create: `packages/runtime/src/domain/locks/policy.ts`
- Modify: `packages/runtime/src/domain/locks/index.ts`
- Create: `tests/lock-lifecycle.test.ts`
- Create: `tests/lock-policy-properties.test.ts`

**Interfaces:**

- Consumes: Task 1 types, `sealEvent()`, `verifyEventStream()`, `canonicalizeJson()`, injected `Clock`, `Digests`, and `SchemaRegistry`.
- Produces: `LockLifecycleAction`, `PreparedLeaseTransition`, `prepareLeaseTransition()`, `verifyLeaseBinding()`, `decideAcquire()`, `decideRenew()`, `decideRelease()`, and `decideTakeover()`.

- [ ] **Step 1: Write lifecycle golden and transition tests**

```ts
it("binds the canonical lease digest and token into EventV1", () => {
  const prepared = prepareLeaseTransition({
    action: "acquire",
    priorEvents: "",
    lease: lease({ fencingToken: 1, stateRevision: 7 }),
    leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
    eventId: "lock-event-01",
    occurredAt: "2026-08-11T00:00:00.000Z",
    observedIdentity: { host: "codex", model: null },
  }, services);

  expect(prepared.event.operation).toBe(
    `lock.acquire.t1.d${services.digests.sha256(prepared.leaseText)}`,
  );
  expect(prepared.event.priorRevision).toBe(0);
  expect(prepared.event.resultingRevision).toBe(1);
  expect(prepared.eventsText).toBe(`${canonicalizeJson(prepared.event)}\n`);
  expect(verifyLeaseBinding(prepared.eventsText, prepared.leaseText, services).lease)
    .toEqual(lease({ fencingToken: 1, stateRevision: 7 }));
});

it.each([
  ["acquire", 0, 1],
  ["renew", 1, 1],
  ["release", 1, 1],
  ["acquire", 1, 2],
  ["takeover", 2, 3],
] as const)("enforces %s token transition", (action, prior, next) => {
  expect(validateTokenTransition(action, prior, next)).toBeUndefined();
});

it("rejects lease mutation not protected by the latest event digest", () => {
  const prepared = preparedLease();
  const mutated = canonicalizeJson({ ...JSON.parse(prepared.leaseText), owner: "codex:other" });
  expect(() => verifyLeaseBinding(prepared.eventsText, mutated, services))
    .toThrow("Lease state integrity validation failed");
});
```

Add property cases that generate action sequences and assert tokens never decrease, only acquire/takeover increment, and renew/release preserve the epoch.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npx vitest run tests/lock-lifecycle.test.ts tests/lock-policy-properties.test.ts`

Expected: FAIL because lifecycle and policy exports are missing.

- [ ] **Step 3: Implement canonical lifecycle preparation and verification**

```ts
export type LockLifecycleAction = "acquire" | "renew" | "release" | "takeover";
const operationPattern = /^lock\.(acquire|renew|release|takeover)\.t(0|[1-9][0-9]*)\.d([a-f0-9]{64})$/u;

export interface LockLifecycleServices extends EventServices {}

export interface PrepareLeaseTransitionInput {
  readonly action: LockLifecycleAction;
  readonly priorEvents: string;
  readonly lease: LockLeaseV1;
  readonly leaseRef: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface PreparedLeaseTransition {
  readonly event: EventV1;
  readonly lease: LockLeaseV1;
  readonly leaseText: string;
  readonly eventsText: string;
}

export class LeaseIntegrityError extends Error {
  public constructor() {
    super("Lease state integrity validation failed");
    this.name = "LeaseIntegrityError";
  }
}

function validateLease(value: unknown, schemaRegistry: SchemaRegistry): LockLeaseV1 {
  const result = schemaRegistry.validate({
    id: "state.lock",
    version: "1.0.0",
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (result.kind !== "valid") throw new LeaseIntegrityError();
  return result.value;
}

export function validateTokenTransition(
  action: LockLifecycleAction,
  priorToken: number,
  nextToken: number,
): void {
  const expected = action === "acquire" || action === "takeover" ? priorToken + 1 : priorToken;
  if (!Number.isSafeInteger(nextToken) || nextToken !== expected) throw new LeaseIntegrityError();
}

export function prepareLeaseTransition(input: PrepareLeaseTransitionInput, services: LockLifecycleServices): PreparedLeaseTransition {
  const prior = verifyEventStream(input.priorEvents, services);
  const lease = validateLease(input.lease, services.schemaRegistry);
  const leaseText = canonicalizeJson(lease);
  const digest = services.digests.sha256(leaseText);
  const draft: EventDraftV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: input.eventId,
    eventType: input.action === "takeover" ? "recovery" : "operation",
    occurredAt: input.occurredAt,
    operation: `lock.${input.action}.t${String(lease.fencingToken)}.d${digest}`,
    policyVersion: "locks-v1",
    priorRevision: prior.cursor.revision,
    resultingRevision: prior.cursor.revision + 1,
    reasonCode: "trail.ok",
    effect: "state",
    artifactRefs: [input.leaseRef],
    evidenceRefs: [],
    observedIdentity: input.observedIdentity,
  };
  const event = sealEvent(draft, prior.cursor, services);
  return Object.freeze({
    event,
    lease,
    leaseText,
    eventsText: `${prior.canonical}${canonicalizeJson(event)}\n`,
  });
}

export function parseLockOperation(operation: string) {
  const match = operationPattern.exec(operation);
  if (match === null) throw new LeaseIntegrityError();
  const token = Number(match[2]);
  if (!Number.isSafeInteger(token)) throw new LeaseIntegrityError();
  return { action: match[1] as LockLifecycleAction, token, digest: match[3]! };
}
```

`verifyLeaseBinding()` must verify the complete event hash chain, the closed operation form, action ordering, token transitions, canonical `LockLeaseV1`, final digest equality, and final token equality. `policy.ts` must return immutable decisions and never read time or state itself; callers pass `now`, current binding, expected identity, and requested state revision.

- [ ] **Step 4: Verify GREEN, properties, and coverage**

Run: `npx vitest run tests/lock-lifecycle.test.ts tests/lock-policy-properties.test.ts --coverage`

Expected: both files PASS and the new `domain/locks` files report 100% statements, branches, functions, and lines.

- [ ] **Step 5: Commit lifecycle policy**

```bash
git add packages/runtime/src/domain/locks tests/lock-lifecycle.test.ts tests/lock-policy-properties.test.ts
git commit -m "feat: seal lease lifecycle history"
```

### Task 3: Durable Namespace, Inspection, and Recoverable Claims

**Files:**

- Create: `packages/runtime/src/composition/locks.ts`
- Create: `tests/lock-claims.test.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `tests/architecture.test.ts`

**Interfaces:**

- Consumes: Task 2 lifecycle verification, `DurableFileSystem`, `Clock`, `Ids`, `Digests`, and `SchemaRegistry`.
- Produces: `LockServices`, `LeaseObservation`, `inspectLease()`, `acquireClaim()`, `releaseClaim()`, and `recoverClaim()`.

- [ ] **Step 1: Write failing claim and inspection tests over memory storage**

```ts
it("creates only the closed namespace and an exclusive canonical claim", async () => {
  const storage = lockStorage();
  const claim = await acquireClaim(
    { resource: "run:run-01", owner: "codex:session-01", observed: null },
    services(storage),
  );
  const snapshot = storage.snapshot();
  expect(claim.claimId).toBe("claim-1");
  expect(snapshot.directories).toEqual(expect.arrayContaining([
    ".brain/locks",
    ".brain/locks/.admission",
    ".brain/locks/.admission/claim",
    ".brain/locks/runs",
    ".brain/locks/runs/run-01",
    ".brain/locks/runs/run-01/claim",
  ]));
  expect(JSON.parse(snapshot.files[lockPaths("run:run-01").claimRecord]!)).toMatchObject({
    claimId: "claim-1",
    resource: "run:run-01",
    owner: "codex:session-01",
  });
});

it("does not flatten corrupt claim paths into contention", async () => {
  const storage = lockStorage({ directories: [lockPaths("project").claimRecord] });
  await expect(acquireClaim(projectClaim, services(storage))).rejects.toMatchObject({
    reasonCode: "runtime.state_corrupt",
    evidence: [{ kind: "artifact", ref: lockPaths("project").claimRecord }],
  });
});

it("recovers only an exact expired claim with no publishing transaction", async () => {
  const storage = expiredClaimStorage();
  await expect(recoverClaim(observedClaim, services(storage))).resolves.toEqual({ kind: "recovered" });
  await expect(recoverClaim(observedClaim, services(storage))).resolves.toEqual({ kind: "absent" });
});
```

- [ ] **Step 2: Run claim tests and verify RED**

Run: `npx vitest run tests/lock-claims.test.ts tests/architecture.test.ts`

Expected: FAIL because `composition/locks` is missing.

- [ ] **Step 3: Implement exact inspection and claim lifecycle**

Implement `ensureLockNamespace()` with inspect-before-create, no-follow durable paths, explicit directory sync, and exact allowed layouts. Implement a closed internal claim record:

```ts
interface LockClaimRecord {
  readonly claimId: string;
  readonly resource: LeaseResource | "admission";
  readonly owner: string;
  readonly leaseId: string | null;
  readonly fencingToken: number | null;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}
```

Write `claim.json` with `writeSynced()`, inspect its fingerprint after the write, and remove only the exact canonical file followed by its exact empty directory. Map exclusive-create contention to a verified `LeaseOutcome`, and map symlink/special/unknown layouts to `runtime.state_corrupt`. Before claim recovery, call `inspectManagedTransactions()` and refuse any non-terminal or cleanup-residue marker.

- [ ] **Step 4: Verify GREEN and fault boundaries**

Run: `npx vitest run tests/lock-claims.test.ts tests/fake-transactions.test.ts tests/node-transaction-security.test.ts tests/architecture.test.ts`

Expected: all listed suites PASS.

- [ ] **Step 5: Commit durable claims**

```bash
git add packages/runtime/src/composition/locks.ts packages/runtime/src/composition/index.ts tests/lock-claims.test.ts tests/architecture.test.ts
git commit -m "feat: add recoverable lock claims"
```

### Task 4: Acquire, Renew, Release, Takeover, and Scope Admission

**Files:**

- Create: `packages/runtime/src/ports/locks.ts`
- Modify: `packages/runtime/src/ports/index.ts`
- Modify: `packages/runtime/src/composition/locks.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/src/infra/fake/index.ts`
- Modify: `packages/runtime/src/infra/node/index.ts`
- Create: `tests/support/lock-contract.ts`
- Create: `tests/locks-contract.test.ts`
- Create: `tests/lock-service.test.ts`

**Interfaces:**

- Consumes: Tasks 1–3 and `executeManagedMutation()`.
- Produces: the final `Locks` port with `inspect`, `acquire`, `renew`, `release`, and `takeover`; `createLocks()` shared composition; production and memory factories using the same service.

- [ ] **Step 1: Write the shared adapter contract and lifecycle integration tests**

```ts
export function describeLocksContract(label: string, factory: LockFactory): void {
  describe(`Locks contract: ${label}`, () => {
    it("acquires, renews, releases, and reacquires with monotonic fencing", async () => {
      const fixture = await factory();
      try {
        const first = await fixture.locks.acquire(acquireRequest());
        expect(first.kind).toBe("acquired");
        if (first.kind !== "acquired") return;
        fixture.advance(20_000);
        const renewed = await fixture.locks.renew(renewRequest(first.guard));
        expect(renewed.kind).toBe("renewed");
        if (renewed.kind !== "renewed") return;
        const released = await fixture.locks.release(releaseRequest(renewed.guard));
        expect(released.kind).toBe("released");
        const second = await fixture.locks.acquire(acquireRequest({ stateRevision: 2 }));
        expect(second.kind).toBe("acquired");
        if (second.kind === "acquired")
          expect(second.lease.fencingToken).toBe(first.lease.fencingToken + 1);
      } finally {
        await fixture.dispose();
      }
    });

    it("requires explicit takeover after skew allowance", async () => {
      const fixture = await factory();
      const held = await fixture.locks.acquire(acquireRequest());
      if (held.kind !== "acquired") throw new Error("missing fixture lease");
      fixture.advance(35_000);
      expect((await fixture.locks.acquire(acquireRequest({ owner: "codex:other" }))).kind)
        .toBe("conflict");
      const taken = await fixture.locks.takeover(takeoverRequest(held.guard, "codex:other"));
      expect(taken.kind).toBe("taken_over");
      if (taken.kind === "taken_over")
        expect(taken.lease.fencingToken).toBe(held.lease.fencingToken + 1);
    });
  });
}
```

Run the contract against `memoryTransactionStorage()` and a real temporary directory through `nodeDurableFileSystem()`.

- [ ] **Step 2: Run service tests and verify RED**

Run: `npx vitest run tests/locks-contract.test.ts tests/lock-service.test.ts tests/ports-contract.test.ts`

Expected: FAIL because the expanded `Locks` interface and `createLocks()` do not exist.

- [ ] **Step 3: Implement the final port and service orchestration**

```ts
// packages/runtime/src/ports/locks.ts
export interface Locks {
  inspect(resource: LeaseResource): Promise<LeaseObservation>;
  acquire(request: AcquireLeaseRequest): Promise<LeaseOutcome>;
  renew(request: RenewLeaseRequest): Promise<LeaseOutcome>;
  release(request: ReleaseLeaseRequest): Promise<LeaseOutcome>;
  takeover(request: TakeoverLeaseRequest): Promise<LeaseOutcome>;
}
```

`createLocks()` must snapshot every request before I/O, acquire admission before scope claims for acquire/takeover, verify project-versus-run conflicts in sorted path order, call the pure decision functions, prepare lifecycle bytes, normalize the exact event/lease writes, execute one managed transaction, and remove only matching claims. A lifecycle transaction that rejects after a durable marker returns `runtime.recovery_required`; it never fabricates a conflict.

Replace the placeholder `memoryLocks` and `nodeLocks` policy bodies. Keep convenience exports, but have both create the same composition service over their respective durable filesystem implementations. Update the old `describeLocksContract` calls rather than retaining tests for the obsolete two-method API.

- [ ] **Step 4: Verify lifecycle GREEN and cross-adapter parity**

Run: `npx vitest run tests/lock-model.test.ts tests/lock-lifecycle.test.ts tests/lock-claims.test.ts tests/locks-contract.test.ts tests/lock-service.test.ts tests/ports-contract.test.ts tests/runtime-composition.test.ts`

Expected: every listed suite PASS.

- [ ] **Step 5: Commit the lease service**

```bash
git add packages/runtime/src/ports packages/runtime/src/composition packages/runtime/src/infra/fake/index.ts packages/runtime/src/infra/node/index.ts tests/support/lock-contract.ts tests/locks-contract.test.ts tests/lock-service.test.ts tests/ports-contract.test.ts tests/runtime-composition.test.ts
git commit -m "feat: implement recoverable work leases"
```

### Task 5: Protected Transaction Lease Guard and Recovery Fencing

**Files:**

- Modify: `packages/runtime/src/composition/transactions.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/src/domain/transactions/model.ts`
- Create: `tests/transaction-lease-guard.test.ts`
- Create: `tests/transaction-fencing-recovery.test.ts`
- Modify: `tests/transaction-execution.test.ts`
- Modify: `tests/transaction-recovery.test.ts`

**Interfaces:**

- Consumes: `LeaseGuard`, lifecycle preparation, `ManagedMutationPlan`, and existing transaction recovery.
- Produces: `LeaseGuardBinding`, `bindLeaseGuard()`, `assertLeaseAuthority()`, and guarded execute/recover options without changing `TransactionManifestV1`.

- [ ] **Step 1: Write stale-worker and recovery RED tests**

```ts
it("refuses token n before publishing after token n+1 becomes authoritative", async () => {
  const fixture = await guardedFixture();
  const first = await fixture.acquire("codex:first");
  const plan = fixture.plan(".brain/runs/run-01/result.json", "first");
  fixture.pauseBeforePublishing();
  const pending = fixture.execute(plan, first.guard);
  await fixture.waitUntilPaused();
  await fixture.expireAndTakeover(first.lease, "codex:second");
  fixture.resumePublishing();
  await expect(pending).rejects.toMatchObject({ reasonCode: "runtime.lease_conflict" });
  expect(fixture.snapshot().files).not.toHaveProperty(".brain/runs/run-01/result.json");
});

it("persists the guard in reserved v1 manifest operations", async () => {
  const fixture = await guardedFixture();
  const held = await fixture.acquire("codex:first");
  await fixture.execute(fixture.plan(".brain/value.json", "new"), held.guard);
  const manifest = fixture.manifest();
  expect(manifest.operations.slice(0, 2).map(({ path }) => path)).toEqual([
    lockPaths("run:run-01").events,
    lockPaths("run:run-01").lease,
  ]);
  expect(manifest).not.toHaveProperty("leaseGuard");
});

it("revalidates the persisted guard before every recovery publication", async () => {
  const fixture = await publishingCrashFixture();
  const newer = await fixture.installHigherToken();
  await expect(fixture.recover()).rejects.toMatchObject({
    reasonCode: "runtime.lease_conflict",
    evidence: [{ kind: "artifact", ref: newer.leaseRef }],
  });
});
```

- [ ] **Step 2: Run guarded transaction tests and verify RED**

Run: `npx vitest run tests/transaction-lease-guard.test.ts tests/transaction-fencing-recovery.test.ts`

Expected: FAIL because transaction options cannot carry or persist a lease guard.

- [ ] **Step 3: Implement guard binding through reserved managed writes**

Add a closed option:

```ts
export interface LeaseGuardBinding {
  readonly guard: LeaseGuard;
  readonly renewedLease: LockLeaseV1;
  readonly lifecycleEvent: EventV1;
  readonly expected: readonly [EventStorePrecondition, EventStorePrecondition];
}

export interface ExecuteManagedMutationOptions {
  readonly rootMode: "existing" | "initialize";
  readonly eventStorePreconditions?: readonly EventStorePrecondition[];
  readonly leaseGuard?: LeaseGuardBinding;
}
```

`freezeExecuteOptions()` must reject accessors, proxies, extra keys, invalid lock paths, mismatched resource/path mappings, unsafe fingerprints, and a lease/event digest mismatch before I/O. `bindLeaseGuard()` prepends the exact-prefix renew event write and renewed lease write; caller effects targeting `.brain/locks/**` are refused.

Call `assertLeaseAuthority()` before marker creation, while holding the matching claim before persisting `publishing`, before every destination publication, and inside recovery before publishing or accepting terminal results. Derive the persisted guard from the two reserved manifest operations and staged lease payload; do not add a manifest property or change its schema.

Add `runtime.lease_conflict` to `TransactionFailure` and preserve relative lock evidence only.

- [ ] **Step 4: Verify GREEN and existing recovery semantics**

Run: `npx vitest run tests/transaction-lease-guard.test.ts tests/transaction-fencing-recovery.test.ts tests/transaction-execution.test.ts tests/transaction-recovery.test.ts tests/event-store-transaction.test.ts`

Expected: all listed suites PASS; existing unguarded internal lifecycle transactions remain bounded to lock-owned paths, while protected caller transactions require a valid binding.

- [ ] **Step 5: Commit fencing integration**

```bash
git add packages/runtime/src/composition/transactions.ts packages/runtime/src/composition/index.ts packages/runtime/src/domain/transactions/model.ts tests/transaction-lease-guard.test.ts tests/transaction-fencing-recovery.test.ts tests/transaction-execution.test.ts tests/transaction-recovery.test.ts
git commit -m "feat: fence protected transaction commits"
```

### Task 6: Deterministic Interleaving and Fault-Injection Campaign

**Files:**

- Create: `tests/lock-schedules.test.ts`
- Create: `tests/lock-fault-campaign.test.ts`
- Modify: `packages/runtime/src/infra/fake/transactions.ts` only if a missing existing filesystem observation seam is proven by a RED test.

**Interfaces:**

- Consumes: final `Locks`, guarded transactions, `FailureRule`, injected clock/IDs, and memory snapshots.
- Produces: exhaustive bounded schedules and crash-boundary evidence; no new production API unless the existing fake durable filesystem cannot observe a required boundary.

- [ ] **Step 1: Write the generated schedule model**

```ts
const actions = ["acquire-a", "acquire-b", "renew-a", "release-a", "takeover-b", "commit-a"] as const;

it.each(permutations(actions))("preserves fencing for schedule %j", async (schedule) => {
  const model = createLeaseModel();
  const runtime = createLeaseFixture();
  for (const action of schedule) {
    model.apply(action);
    await runtime.apply(action);
    expect(runtime.authoritativeTokens()).toEqual(model.authoritativeTokens());
    expect(runtime.committedByStaleToken()).toBe(false);
    expect(runtime.activeWriters("run:run-01")).toBeLessThanOrEqual(1);
  }
});
```

Bound generation to unique meaningful schedules and print the schedule in every assertion message.

- [ ] **Step 2: Write the fault matrix and verify RED**

Generate before/after failures for `create_directory_exclusive`, `write_file`, `sync_file`, `replace_file`, `remove_file`, `remove_empty_directory`, and `sync_directory` across claim, lifecycle preparation, lease publication, claim cleanup, and guarded publication. For every injected failure assert one of:

```ts
expect(observation).toMatchObject({ kind: "unchanged" });
// or
expect(observation).toMatchObject({
  kind: "recoverable",
  reasonCode: "runtime.recovery_required",
  evidenceRef: expect.stringMatching(/^\.brain\/transactions\//u),
});
```

Run: `npx vitest run tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts`

Expected: FAIL at the first uncovered scheduling or fault boundary.

- [ ] **Step 3: Make the minimum seam or classification corrections**

If RED proves a missing fake observation, add the exact existing `DurableOperation` event rather than a lock-specific test hook. If RED proves policy drift, correct the shared domain/composition implementation; do not special-case tests or adapters.

- [ ] **Step 4: Verify GREEN and campaign determinism**

Run twice:

```bash
npx vitest run tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts --reporter=verbose
npx vitest run tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts --reporter=verbose
```

Expected: both runs PASS with identical case counts and no random seed dependency.

- [ ] **Step 5: Commit model and fault evidence**

```bash
git add tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts packages/runtime/src/infra/fake/transactions.ts packages/runtime/src/domain/locks packages/runtime/src/composition/locks.ts packages/runtime/src/composition/transactions.ts
git commit -m "test: prove lease scheduling and crash safety"
```

### Task 7: Real Multi-Process Contention, Renewal, Crash, and Clock Skew

**Files:**

- Create: `tests/fixtures/locks/worker.ts`
- Create: `tests/lock-process-contention.test.ts`
- Create: `tests/node-lock-security.test.ts`
- Modify: `packages/runtime/src/infra/node/transactions.ts` only for a RED-proven portable filesystem defect.

**Interfaces:**

- Consumes: production `createLocks()`, `nodeDurableFileSystem()`, guarded transactions, and a worker JSON-lines protocol.
- Produces: real-process acceptance evidence for contention, crash, renewal, takeover, skew, unusual paths, and stale publication.

- [ ] **Step 1: Write the worker protocol and contention tests**

Worker stdin accepts one canonical line:

```ts
type WorkerCommand =
  | { readonly kind: "acquire"; readonly root: string; readonly owner: string; readonly now: string }
  | { readonly kind: "renew"; readonly root: string; readonly lease: LockLeaseV1; readonly now: string }
  | { readonly kind: "takeover"; readonly root: string; readonly observed: LeaseGuard; readonly owner: string; readonly now: string }
  | { readonly kind: "guarded_commit"; readonly root: string; readonly guard: LeaseGuard; readonly pause: "before_publishing" | null };
```

Worker stdout emits exactly one canonical outcome line; diagnostics go to stderr and never contain `root`.

```ts
it("allows one winner among simultaneous contenders", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => runWorker({
      kind: "acquire",
      root,
      owner: `codex:worker-${String(index)}`,
      now: "2026-08-11T00:00:00.000Z",
    })),
  );
  expect(results.filter(({ kind }) => kind === "acquired")).toHaveLength(1);
  expect(results.filter(({ kind }) => kind === "conflict")).toHaveLength(7);
});
```

- [ ] **Step 2: Add crash, stale-worker, renewal, and skew cases and verify RED**

Cover: kill after claim creation, kill after durable transaction marker, renew before threshold, reject renewal after expiry, takeover at `expiresAt + 4_999ms`, takeover at `expiresAt + 5_000ms`, two simultaneous takeovers, independent run commits, project-versus-run conflict, and token-`n` worker resumption after token `n+1`.

Run: `npx vitest run tests/lock-process-contention.test.ts tests/node-lock-security.test.ts`

Expected: FAIL until the Node path handles every real scheduling boundary.

- [ ] **Step 3: Correct only RED-proven Node adapter defects**

Keep changes within existing no-follow durable primitives: exact exclusive directory creation, synced canonical claim writes, same-root replacement, exact empty-directory removal, and identity revalidation. Do not add advisory OS locks, PID checks, shell interpolation, or platform-wide catch blocks.

- [ ] **Step 4: Verify multi-process GREEN repeatedly**

Run:

```bash
npx vitest run tests/lock-process-contention.test.ts tests/node-lock-security.test.ts --reporter=verbose
npx vitest run tests/lock-process-contention.test.ts tests/node-lock-security.test.ts --reporter=verbose
npx vitest run tests/locks-contract.test.ts tests/node-transaction-security.test.ts
```

Expected: all three commands PASS; both contention runs report identical scenario counts.

- [ ] **Step 5: Commit real-process evidence**

```bash
git add tests/fixtures/locks/worker.ts tests/lock-process-contention.test.ts tests/node-lock-security.test.ts packages/runtime/src/infra/node/transactions.ts
git commit -m "test: prove multi-process lease fencing"
```

### Task 8: Architecture Documentation, Evidence, and Repository Gate

**Files:**

- Create: `docs/architecture/concurrency-locks.md`
- Create: `docs/verification/issue-22-lock-evidence.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/architecture/atomic-transactions.md`
- Modify: `tests/architecture.test.ts`
- Modify: `tests/contract-documentation.test.ts`
- Modify: `.cspell.json` only for unavoidable approved technical terms.

**Interfaces:**

- Consumes: all completed implementation and exact command output.
- Produces: public architecture contract, reproducible issue evidence, documentation assertions, and final verification record.

- [ ] **Step 1: Write failing documentation assertions**

```ts
it.each([
  "run:<run-id>",
  ".brain/locks/project",
  ".brain/locks/runs/<encoded-run-id>",
  "Base64URL",
  "30 seconds",
  "10 seconds",
  "5 seconds",
  "runtime.lease_conflict",
  "runtime.recovery_required",
  "explicit takeover",
  "fencing token",
  "read-only",
])("publishes the lock boundary: %s", (required) => {
  expect(concurrencyLocksGuide).toContain(required);
});
```

Run: `npx vitest run tests/architecture.test.ts tests/contract-documentation.test.ts`

Expected: FAIL because `docs/architecture/concurrency-locks.md` is absent.

- [ ] **Step 2: Write the architecture and evidence documents**

`concurrency-locks.md` must document scope admission, owner identity, durable layout, lifecycle digest binding, exact time table, claim recovery, guarded publication ordering, result mapping, read-only rules, threat boundary, and no public command addition. Link it from runtime and transaction guides.

`issue-22-lock-evidence.md` must contain the date, commit under test, platform/toolchain, exact commands, test/file counts, fault and process scenario counts, coverage totals, known threat boundary, and a checklist mapping every issue acceptance criterion to a named test.

- [ ] **Step 3: Run narrow and static gates**

Run:

```bash
npm run format:check
npm run spellcheck
npm run lint
npm run typecheck
npx vitest run tests/lock-model.test.ts tests/lock-lifecycle.test.ts tests/lock-policy-properties.test.ts tests/lock-claims.test.ts tests/locks-contract.test.ts tests/lock-service.test.ts tests/transaction-lease-guard.test.ts tests/transaction-fencing-recovery.test.ts tests/lock-schedules.test.ts tests/lock-fault-campaign.test.ts tests/lock-process-contention.test.ts tests/node-lock-security.test.ts tests/architecture.test.ts tests/contract-documentation.test.ts
```

Expected: every command exits 0.

- [ ] **Step 4: Run the full repository verification suite**

Run each command separately and record its fresh output in the evidence document:

```bash
npm test
npm run test:coverage
npm run oracle:verify
npm run parity:check
npm run result:check
npm run contracts:check
npm run differential:check
npm run build
npm run package:verify
```

Expected: all commands exit 0; tests report no failures; coverage reports 100% statements, branches, functions, and lines; parity changes only if a committed fixture explicitly covers an existing frozen lock row.

- [ ] **Step 5: Update evidence with exact results and commit**

```bash
git add docs/architecture/concurrency-locks.md docs/architecture/runtime-boundaries.md docs/architecture/atomic-transactions.md docs/verification/issue-22-lock-evidence.md tests/architecture.test.ts tests/contract-documentation.test.ts .cspell.json
git commit -m "docs: publish concurrency lock evidence"
```

- [ ] **Step 6: Final clean-tree verification**

Run:

```bash
git status --short
git log --oneline --decorate main..HEAD
```

Expected: `git status --short` prints nothing and the branch log contains only the approved design plus Task 1–8 commits.
