import type { Locks } from "@kratos/runtime/ports";
import type {
  AcquireLeaseRequest,
  LeaseGuard,
  LeaseOutcome,
  RenewLeaseRequest,
  TakeoverLeaseRequest,
} from "@kratos/runtime/domain/locks";
import { describe, expect, it } from "vitest";

export interface LockFixture {
  readonly locks: Locks;
  readonly advance: (milliseconds: number) => void;
  readonly dispose: () => Promise<void>;
}

export type LockFactory = () => Promise<LockFixture>;

export function acquireRequest(
  overrides: Partial<AcquireLeaseRequest> = {},
): AcquireLeaseRequest {
  return {
    resource: "run:run-01",
    owner: "codex:session-01",
    ttlMs: 30_000,
    stateRevision: 1,
    observedIdentity: { host: "codex", model: null },
    ...overrides,
  };
}

export function renewRequest(guard: LeaseGuard): RenewLeaseRequest {
  return {
    observed: guard,
    ttlMs: 30_000,
    resultingStateRevision: guard.stateRevision,
    observedIdentity: { host: "codex", model: null },
  };
}

export function releaseRequest(guard: LeaseGuard) {
  return {
    observed: guard,
    observedIdentity: { host: "codex", model: null },
  } as const;
}

export function takeoverRequest(
  guard: LeaseGuard,
  owner: string,
): TakeoverLeaseRequest {
  return {
    observed: guard,
    owner,
    ttlMs: 30_000,
    stateRevision: guard.stateRevision,
    observedIdentity: { host: "codex", model: null },
  };
}

function acquired(
  outcome: LeaseOutcome,
): Extract<LeaseOutcome, { kind: "acquired" }> {
  if (outcome.kind !== "acquired")
    throw new Error("Expected an acquired lease");
  return outcome;
}

export function describeLocksContract(
  label: string,
  factory: LockFactory,
): void {
  describe(`Locks contract: ${label}`, () => {
    it("acquires, renews, releases, and reacquires with monotonic fencing", async () => {
      const fixture = await factory();
      try {
        const first = acquired(await fixture.locks.acquire(acquireRequest()));
        fixture.advance(20_000);
        const renewed = await fixture.locks.renew(renewRequest(first.guard));
        expect(renewed.kind).toBe("renewed");
        if (renewed.kind !== "renewed") return;
        const released = await fixture.locks.release(
          releaseRequest(renewed.guard),
        );
        expect(released.kind).toBe("released");
        const second = await fixture.locks.acquire(
          acquireRequest({ stateRevision: 2 }),
        );
        expect(second.kind).toBe("acquired");
        if (second.kind === "acquired") {
          expect(second.lease.fencingToken).toBe(first.lease.fencingToken + 1);
        }
      } finally {
        await fixture.dispose();
      }
    });

    it("requires explicit takeover after skew allowance", async () => {
      const fixture = await factory();
      try {
        const held = acquired(await fixture.locks.acquire(acquireRequest()));
        fixture.advance(35_000);
        expect(
          (
            await fixture.locks.acquire(
              acquireRequest({ owner: "codex:other" }),
            )
          ).kind,
        ).toBe("conflict");
        const taken = await fixture.locks.takeover(
          takeoverRequest(held.guard, "codex:other"),
        );
        expect(taken.kind).toBe("taken_over");
        if (taken.kind === "taken_over") {
          expect(taken.lease.fencingToken).toBe(held.lease.fencingToken + 1);
        }
      } finally {
        await fixture.dispose();
      }
    });
  });
}
