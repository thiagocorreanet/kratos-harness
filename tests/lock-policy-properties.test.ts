import type { LockLeaseV1 } from "@mestre-yoda/contracts";
import {
  decideAcquire,
  decideRelease,
  decideRenew,
  decideTakeover,
  type LeasePolicyBinding,
  type LeasePolicyDecision,
} from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

function lease(changes: Partial<LockLeaseV1> = {}): LockLeaseV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    resource: "run:run-01",
    owner: "codex:session-01",
    leaseId: "lease-01",
    acquiredAt: "2026-08-11T00:00:00.000Z",
    expiresAt: "2026-08-11T00:00:30.000Z",
    fencingToken: 1,
    stateRevision: 7,
    ...changes,
  };
}

function transition(decision: LeasePolicyDecision): LeasePolicyBinding {
  expect(decision.kind).toBe("transition");
  if (decision.kind !== "transition") throw new Error("expected transition");
  return { action: decision.action, lease: decision.lease };
}

describe("lease transition policy", () => {
  it("keeps fencing tokens monotonic over generated action sequences", () => {
    let current: LeasePolicyBinding | null = null;
    const tokens: number[] = [];
    const actions: string[] = [];
    const now = new Date("2026-08-11T00:00:00.000Z");

    for (let index = 0; index < 24; index += 1) {
      const stateRevision = index;
      if (current === null || index % 4 === 0) {
        current = transition(
          decideAcquire({
            now,
            current,
            resource: "run:run-01",
            owner: "codex:session-01",
            leaseId: `lease-${String(index)}`,
            ttlMs: 5_000,
            stateRevision,
          }),
        );
        actions.push("acquire");
      } else if (index % 4 === 1) {
        current = transition(
          decideRenew({
            now,
            current,
            expectedIdentity: current.lease,
            ttlMs: 5_000,
            stateRevision,
          }),
        );
        actions.push("renew");
      } else if (index % 4 === 2) {
        const expired = {
          ...current,
          lease: { ...current.lease, expiresAt: "2026-08-10T23:59:55.000Z" },
        };
        current = transition(
          decideTakeover({
            now,
            current: expired,
            expectedIdentity: expired.lease,
            owner: "codex:session-02",
            leaseId: `lease-${String(index)}`,
            ttlMs: 5_000,
            stateRevision,
          }),
        );
        actions.push("takeover");
      } else {
        current = transition(
          decideRelease({
            now,
            current,
            expectedIdentity: current.lease,
            stateRevision,
          }),
        );
        actions.push("release");
      }
      tokens.push(current.lease.fencingToken);
    }

    expect(
      tokens.every((token, index) => {
        const priorToken = tokens.at(index - 1);
        return index === 0 || (priorToken !== undefined && token >= priorToken);
      }),
    ).toBe(true);
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens.at(index);
      const priorToken = tokens.at(index - 1);
      if (token === undefined || priorToken === undefined)
        throw new Error("token sequence is incomplete");
      const changed = token !== priorToken;
      expect(changed).toBe(
        actions.at(index) === "acquire" || actions.at(index) === "takeover",
      );
    }
  });

  it("returns frozen conflicts when authority or expiry forbids a transition", () => {
    const current = { action: "acquire" as const, lease: lease() };
    const decision = decideRenew({
      now: new Date("2026-08-11T00:00:30.000Z"),
      current,
      expectedIdentity: current.lease,
      ttlMs: 5_000,
      stateRevision: 8,
    });
    expect(decision).toEqual({ kind: "conflict" });
    expect(Object.isFrozen(decision)).toBe(true);
  });
});
