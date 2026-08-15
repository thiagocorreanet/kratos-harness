import {
  prepareLeaseGuard,
  executeManagedMutation,
  TransactionFailure,
  type LeaseGuardBinding,
} from "@mestre-yoda/runtime/composition";
import { lockPaths } from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

import {
  callerPlan,
  guardedFixture as fixture,
  guardedRenewal,
} from "./support/lease-guard.js";
import {
  acquireRequest,
  renewRequest,
  takeoverRequest,
} from "./support/lock-contract.js";

describe("protected transaction lease guard", () => {
  it("publishes a caller mutation when the guard still holds authority", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );
    await executeManagedMutation(
      callerPlan(subject.storage),
      { rootMode: "existing", leaseGuard: binding },
      subject.services,
    );

    expect(
      subject.storage.snapshot().files[".brain/runs/run-01/result.json"],
    ).toBe("first");
  });

  it("prepends the renew event and the renewed lease to the caller's writes", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );
    await executeManagedMutation(
      callerPlan(subject.storage),
      { rootMode: "existing", leaseGuard: binding },
      subject.services,
    );

    // The lease lifecycle is renewed by the very transaction it protects, so a
    // caller cannot hold authority open without leaving a durable trace of it.
    const paths = lockPaths("run:run-01");
    expect(subject.storage.snapshot().files[paths.events]).toContain(
      "lock.renew.",
    );
    expect(subject.storage.snapshot().files[paths.lease]).toContain(
      '"fencingToken":1',
    );
  });

  it("refuses a guard whose fencing token a takeover has superseded", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );

    // The lease expires and a second worker takes it over, which advances the
    // durable fencing token past the one the binding was built from.
    subject.advance(60_000);
    const stolen = await subject.locks.takeover(
      takeoverRequest(held.guard, "codex:session-02"),
    );
    expect(stolen.kind).toBe("taken_over");

    await expect(
      executeManagedMutation(
        callerPlan(subject.storage),
        { rootMode: "existing", leaseGuard: binding },
        subject.services,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.lease_conflict" });

    // The refusal must be total: a stale worker publishes nothing at all.
    expect(subject.storage.snapshot().files).not.toHaveProperty(
      ".brain/runs/run-01/result.json",
    );
  });

  it("refuses a caller effect that targets the lock namespace itself", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );
    const paths = lockPaths("run:run-01");

    // Only `bindLeaseGuard` may write under `.brain/locks/**`. A caller that
    // reaches in directly would be able to forge its own authority.
    await expect(
      executeManagedMutation(
        callerPlan(subject.storage, paths.lease, "forged"),
        { rootMode: "existing", leaseGuard: binding },
        subject.services,
      ),
    ).rejects.toBeInstanceOf(TransactionFailure);
  });

  it("renumbers every caller effect behind the reserved lock writes", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );
    const content = "second";
    await executeManagedMutation(
      {
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs/run-02",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "write_file",
            path: ".brain/runs/run-02/result.json",
            expected: { kind: "missing" },
            result: {
              kind: "file",
              size: content.length,
              sha256: subject.storage.digests.sha256(content),
            },
            stagedPath: "staging/operation-0002.payload",
            content,
          },
        ],
      },
      { rootMode: "existing", leaseGuard: binding },
      subject.services,
    );

    const snapshot = subject.storage.snapshot();
    expect(snapshot.directories).toContain(".brain/runs/run-02");
    expect(snapshot.files[".brain/runs/run-02/result.json"]).toBe(content);
  });

  it("carries declared event-store preconditions alongside the guard", async () => {
    // The event store writes under the feature that opened the run, so this
    // test seeds that chain rather than the fixture's arbitrary caller path.
    const subject = fixture([".brain/02-features/sample-feature/runs/run-01"]);
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    const binding = await prepareLeaseGuard(
      guardedRenewal(held.guard),
      subject.services,
    );
    // The run's own event store is the ordinary caller of a guarded mutation,
    // so both authorities have to hold for the same transaction to publish.
    const events = ".brain/02-features/sample-feature/runs/run-01/events.jsonl";
    await executeManagedMutation(
      callerPlan(subject.storage, events, "{}\n"),
      {
        rootMode: "existing",
        eventStorePreconditions: [
          { path: events, expected: { kind: "missing" } },
          {
            path: ".brain/02-features/sample-feature/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
        ],
        leaseGuard: binding,
      },
      subject.services,
    );

    expect(subject.storage.snapshot().files[events]).toBe("{}\n");
  });

  it("refuses to prepare a guard for a lease that is no longer renewable", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    subject.advance(60_000);

    await expect(
      prepareLeaseGuard(guardedRenewal(held.guard), subject.services),
    ).rejects.toMatchObject({ reasonCode: "runtime.lease_conflict" });
  });

  it("refuses a renewal that would leave the lease byte-identical", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");

    // Same instant and same resulting revision: such a renewal publishes no
    // evidence that this transaction was ever authorized.
    await expect(
      prepareLeaseGuard(renewRequest(held.guard), subject.services),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each([
    ["missing guard", { renewedLease: {}, lifecycleEvent: {}, expected: [] }],
    ["extra key", { extra: true }],
    ["null binding", null],
    ["array binding", []],
  ])("refuses a %s binding before any durable write", async (_label, value) => {
    await expectRefusedBinding(value);
  });

  it.each([
    ["a number guard", { guard: 1 }],
    ["a null guard", { guard: null }],
    ["a proxied guard", { guard: new Proxy({}, {}) }],
    ["a prototype-less guard", { guard: bareObject() }],
    ["a non-string lease text", { leaseText: 1 }],
    ["a non-string events text", { eventsText: null }],
    ["a truncated expected pair", { expected: [] }],
    [
      "expected paths outside the lock namespace",
      {
        expected: [
          {
            path: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
            expected: FINGERPRINT,
          },
          { path: ".brain/runs/run-01/lease.json", expected: FINGERPRINT },
        ],
      },
    ],
  ])(
    "refuses %s in an otherwise well-formed binding",
    async (_label, overrides) => {
      const subject = fixture();
      const held = await subject.locks.acquire(acquireRequest());
      if (held.kind !== "acquired")
        throw new Error("Expected an acquired lease");
      const binding = await prepareLeaseGuard(
        guardedRenewal(held.guard),
        subject.services,
      );

      await expectRefusedBinding({ ...binding, ...overrides }, subject);
    },
  );
});

const FINGERPRINT = { kind: "missing" } as const;

/** An object with no prototype, which the shape validator must refuse. */
function bareObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/** Every rejected binding must be refused before a single durable call. */
async function expectRefusedBinding(
  value: unknown,
  existing?: ReturnType<typeof fixture>,
): Promise<void> {
  const subject = existing ?? fixture();
  if (existing === undefined) {
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected an acquired lease");
  }
  const before = subject.storage.calls().length;

  await expect(
    executeManagedMutation(
      callerPlan(subject.storage),
      {
        rootMode: "existing",
        leaseGuard: value as LeaseGuardBinding,
      },
      subject.services,
    ),
  ).rejects.toBeInstanceOf(TransactionFailure);

  expect(subject.storage.calls().length).toBe(before);
}
