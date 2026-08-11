import { types } from "node:util";

import type { LockLeaseV1 } from "@mestre-yoda/contracts";
import {
  LeaseIntegrityError,
  parseLockOperation,
  prepareLeaseTransition,
  validateTokenTransition,
  verifyLeaseBinding,
} from "@mestre-yoda/runtime/domain/locks";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  isPromise: types.isPromise,
  schemaRegistry: createSchemaRegistry(),
};

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

function preparedLease() {
  return prepareLeaseTransition(
    {
      action: "acquire",
      priorEvents: "",
      lease: lease(),
      leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
      eventId: "lock-event-01",
      occurredAt: "2026-08-11T00:00:00.000Z",
      observedIdentity: { host: "codex", model: null },
    },
    services,
  );
}

describe("lease lifecycle history", () => {
  it("binds the canonical lease digest and token into EventV1", () => {
    const prepared = preparedLease();

    expect(prepared.event.operation).toBe(
      `lock.acquire.t1.d${services.digests.sha256(prepared.leaseText)}`,
    );
    expect(prepared.event.priorRevision).toBe(0);
    expect(prepared.event.resultingRevision).toBe(1);
    expect(prepared.eventsText).toBe(`${canonicalizeJson(prepared.event)}\n`);
    expect(
      verifyLeaseBinding(prepared.eventsText, prepared.leaseText, services)
        .lease,
    ).toEqual(lease());
    expect(Object.isFrozen(prepared)).toBe(true);
  });

  it.each([
    ["acquire", 0, 1],
    ["renew", 1, 1],
    ["release", 1, 1],
    ["acquire", 1, 2],
    ["takeover", 2, 3],
  ] as const)("enforces %s token transition", (action, prior, next) => {
    expect(() => {
      validateTokenTransition(action, prior, next);
    }).not.toThrow();
  });

  it("rejects lease mutation not protected by the latest event digest", () => {
    const prepared = preparedLease();
    const mutated = canonicalizeJson({
      ...JSON.parse(prepared.leaseText),
      owner: "codex:other",
    });

    expect(() =>
      verifyLeaseBinding(prepared.eventsText, mutated, services),
    ).toThrow("Lease state integrity validation failed");
  });

  it("rejects non-canonical leases, malformed operations, and invalid action order", () => {
    const prepared = preparedLease();
    expect(() =>
      verifyLeaseBinding(
        prepared.eventsText,
        `${prepared.leaseText} `,
        services,
      ),
    ).toThrow(LeaseIntegrityError);
    expect(() => parseLockOperation("lock.acquire.t01.ddeadbeef")).toThrow(
      LeaseIntegrityError,
    );
    expect(() =>
      prepareLeaseTransition(
        {
          ...prepared,
          action: "renew",
          priorEvents: "",
          lease: lease(),
          leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
          eventId: "lock-event-02",
          occurredAt: "2026-08-11T00:00:01.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
  });
});
