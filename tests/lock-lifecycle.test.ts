import { types } from "node:util";

import type { LockLeaseV1 } from "@kratos/contracts";
import {
  LeaseIntegrityError,
  parseLockOperation,
  prepareLeaseTransition,
  validateTokenTransition,
  verifyLeaseBinding,
} from "@kratos/runtime/domain/locks";
import { sealEvent } from "@kratos/runtime/domain/events";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
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

function resealedAcquire(changes: Record<string, unknown>) {
  const first = preparedLease().event;
  const { eventHash, previousHash, ...draft } = first;
  void eventHash;
  void previousHash;
  return sealEvent(
    { ...draft, ...changes },
    { revision: 0, hash: null },
    services,
  );
}

describe("lease lifecycle history", () => {
  it("rejects a hash-valid prior stream with an invalid earlier lifecycle transition", () => {
    const first = preparedLease().event;
    const { eventHash, previousHash, ...draft } = first;
    void eventHash;
    void previousHash;
    const invalidSecond = sealEvent(
      {
        ...draft,
        eventId: "lock-event-invalid",
        priorRevision: 1,
        resultingRevision: 2,
        operation: `lock.acquire.t2.d${"a".repeat(64)}`,
      },
      { revision: 1, hash: first.eventHash },
      services,
    );
    const priorEvents = `${canonicalizeJson(first)}\n${canonicalizeJson(invalidSecond)}\n`;

    expect(() =>
      prepareLeaseTransition(
        {
          action: "renew",
          priorEvents,
          lease: lease({ fencingToken: 2 }),
          leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
          eventId: "lock-event-03",
          occurredAt: "2026-08-11T00:00:02.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
  });

  it("rejects non-canonical lock domains and a mismatched event artifact reference", () => {
    expect(() =>
      prepareLeaseTransition(
        {
          action: "acquire",
          priorEvents: "",
          lease: lease({
            resource: "not a resource",
            owner: "invalid:owner:shape",
          }),
          leaseRef: ".brain/locks/project/lease.json",
          eventId: "lock-event-04",
          occurredAt: "2026-08-11T00:00:00.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
    expect(() =>
      prepareLeaseTransition(
        {
          action: "acquire",
          priorEvents: "",
          lease: lease(),
          leaseRef: ".brain/locks/project/lease.json",
          eventId: "lock-event-05",
          occurredAt: "2026-08-11T00:00:00.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
  });

  it("snapshots and deeply freezes prepared and verified lease bindings", () => {
    const input = lease();
    const prepared = prepareLeaseTransition(
      {
        action: "acquire",
        priorEvents: "",
        lease: input,
        leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
        eventId: "lock-event-06",
        occurredAt: "2026-08-11T00:00:00.000Z",
        observedIdentity: { host: "codex", model: null },
      },
      services,
    );
    input.owner = "codex:mutated";
    const binding = verifyLeaseBinding(
      prepared.eventsText,
      prepared.leaseText,
      services,
    );

    expect(prepared.lease.owner).toBe("codex:session-01");
    expect(Object.isFrozen(prepared.lease)).toBe(true);
    expect(Object.isFrozen(prepared.event)).toBe(true);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.lease)).toBe(true);
    expect(Object.isFrozen(binding.event)).toBe(true);
    expect(Object.isFrozen(binding.events)).toBe(true);
  });

  it("accepts every valid lifecycle action ordering and rejects an empty binding", () => {
    const first = preparedLease();
    const renew = prepareLeaseTransition(
      {
        action: "renew",
        priorEvents: first.eventsText,
        lease: lease({ stateRevision: 8 }),
        leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
        eventId: "lock-event-09",
        occurredAt: "2026-08-11T00:00:01.000Z",
        observedIdentity: { host: "codex", model: null },
      },
      services,
    );
    const takeover = prepareLeaseTransition(
      {
        action: "takeover",
        priorEvents: renew.eventsText,
        lease: lease({ fencingToken: 2, stateRevision: 9 }),
        leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
        eventId: "lock-event-10",
        occurredAt: "2026-08-11T00:00:02.000Z",
        observedIdentity: { host: "codex", model: null },
      },
      services,
    );
    const release = prepareLeaseTransition(
      {
        action: "release",
        priorEvents: takeover.eventsText,
        lease: lease({ fencingToken: 2, stateRevision: 10 }),
        leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
        eventId: "lock-event-11",
        occurredAt: "2026-08-11T00:00:03.000Z",
        observedIdentity: { host: "codex", model: null },
      },
      services,
    );
    const acquire = prepareLeaseTransition(
      {
        action: "acquire",
        priorEvents: release.eventsText,
        lease: lease({ fencingToken: 3, stateRevision: 11 }),
        leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
        eventId: "lock-event-12",
        occurredAt: "2026-08-11T00:00:04.000Z",
        observedIdentity: { host: "codex", model: null },
      },
      services,
    );

    expect(
      verifyLeaseBinding(acquire.eventsText, acquire.leaseText, services)
        .action,
    ).toBe("acquire");
    expect(() =>
      verifyLeaseBinding("", preparedLease().leaseText, services),
    ).toThrow(LeaseIntegrityError);
  });

  it.each([
    ["event type", { eventType: "recovery" }],
    ["policy", { policyVersion: "other" }],
    ["reason", { reasonCode: "other" }],
    ["effect", { effect: "none" }],
    ["artifact count", { artifactRefs: [] }],
    ["artifact ref", { artifactRefs: [".brain/locks/project/lease.json"] }],
    ["evidence", { evidenceRefs: [".brain/evidence/one.json"] }],
  ] as const)(
    "rejects a lifecycle event with an invalid %s",
    (_name, changes) => {
      const event = resealedAcquire(changes);
      expect(() =>
        verifyLeaseBinding(
          `${canonicalizeJson(event)}\n`,
          canonicalizeJson(lease()),
          services,
        ),
      ).toThrow(LeaseIntegrityError);
    },
  );

  it("rejects invalid hashes, token transitions, and sealing input", () => {
    expect(() =>
      prepareLeaseTransition(
        {
          action: "acquire",
          priorEvents: "not-json\n",
          lease: lease(),
          leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
          eventId: "lock-event-07",
          occurredAt: "2026-08-11T00:00:00.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
    for (const [action, prior, next] of [
      ["acquire", -1, 0],
      ["renew", 1, 2],
      ["release", 1, Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      expect(() => {
        validateTokenTransition(action, prior, next);
      }).toThrow(LeaseIntegrityError);
    }
    expect(() =>
      parseLockOperation(`lock.acquire.t9007199254740992.d${"a".repeat(64)}`),
    ).toThrow(LeaseIntegrityError);
    expect(() =>
      verifyLeaseBinding(preparedLease().eventsText, "not-json", services),
    ).toThrow(LeaseIntegrityError);
    expect(() =>
      prepareLeaseTransition(
        {
          action: "acquire",
          priorEvents: "",
          lease: lease(),
          leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
          eventId: "?",
          occurredAt: "2026-08-11T00:00:00.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        services,
      ),
    ).toThrow(LeaseIntegrityError);
  });

  it("normalizes a schema-registry failure while snapshotting a lease", () => {
    const poisoned = Object.defineProperty(lease(), "resource", {
      enumerable: true,
      get() {
        throw new Error("untrusted getter");
      },
    });
    const poisonedServices = {
      ...services,
      schemaRegistry: {
        validate: () => ({ kind: "valid" as const, value: poisoned }),
      },
    } as typeof services;

    expect(() =>
      prepareLeaseTransition(
        {
          action: "acquire",
          priorEvents: "",
          lease: lease(),
          leaseRef: ".brain/locks/runs/cnVuLTAx/lease.json",
          eventId: "lock-event-08",
          occurredAt: "2026-08-11T00:00:00.000Z",
          observedIdentity: { host: "codex", model: null },
        },
        poisonedServices,
      ),
    ).toThrow(LeaseIntegrityError);
  });

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
