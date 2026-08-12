import { createLocks } from "@mestre-yoda/runtime/composition";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { lockPaths } from "@mestre-yoda/runtime/domain/locks";
import type { ReleaseLeaseRequest } from "@mestre-yoda/runtime/domain/locks";
import {
  memoryTransactionStorage,
  sequentialIds,
} from "../packages/runtime/src/infra/fake/index.js";
import { describe, expect, it } from "vitest";

import {
  acquireRequest,
  releaseRequest,
  renewRequest,
  takeoverRequest,
} from "./support/lock-contract.js";

function fixture() {
  const storage = memoryTransactionStorage();
  let now = new Date("2026-08-11T00:00:00.000Z").getTime();
  const locks = createLocks({
    clock: { now: () => new Date(now) },
    ids: sequentialIds("service-lock"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  });
  return {
    storage,
    locks,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

describe("durable lock service", () => {
  it("publishes the lifecycle event and lease together", async () => {
    const subject = fixture();
    const result = await subject.locks.acquire(acquireRequest());

    expect(result.kind).toBe("acquired");
    const paths = lockPaths("run:run-01");
    expect(subject.storage.snapshot().files[paths.lease]).toContain(
      '"fencingToken":1',
    );
    expect(subject.storage.snapshot().files[paths.events]).toContain(
      "lock.acquire.t1.d",
    );
  });

  it("admission rejects a project lease while a run lease is active", async () => {
    const subject = fixture();
    expect((await subject.locks.acquire(acquireRequest())).kind).toBe(
      "acquired",
    );

    const project = await subject.locks.acquire(
      acquireRequest({ resource: "project" }),
    );
    expect(project.kind).toBe("conflict");
  });

  it("selects the first run-family conflict by canonical directory order", async () => {
    const alpha = fixture();
    await expect(
      alpha.locks.acquire(
        acquireRequest({ resource: "run:alpha", owner: "codex:alpha" }),
      ),
    ).resolves.toMatchObject({ kind: "acquired" });
    const zulu = fixture();
    await expect(
      zulu.locks.acquire(
        acquireRequest({ resource: "run:zulu", owner: "codex:zulu" }),
      ),
    ).resolves.toMatchObject({ kind: "acquired" });
    const leaseFiles = Object.fromEntries(
      [
        ...Object.entries(alpha.storage.snapshot().files),
        ...Object.entries(zulu.storage.snapshot().files),
      ].filter(([path]) => path.startsWith(".brain/locks/")),
    );
    const storage = memoryTransactionStorage({ files: leaseFiles });
    const locks = createLocks({
      clock: { now: () => new Date("2026-08-11T00:00:00.000Z") },
      ids: sequentialIds("ordered-lock"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      schemaRegistry: createSchemaRegistry(),
    });

    await expect(
      locks.acquire(acquireRequest({ resource: "project" })),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: { owner: "codex:alpha", resource: "run:alpha" },
    });
  });

  it("does not let a stale guard renew or release a newer epoch", async () => {
    const subject = fixture();
    const first = await subject.locks.acquire(acquireRequest());
    if (first.kind !== "acquired") throw new Error("Expected first lease");
    subject.advance(35_000);
    const second = await subject.locks.takeover(
      takeoverRequest(first.guard, "codex:other"),
    );
    if (second.kind !== "taken_over") throw new Error("Expected takeover");

    expect((await subject.locks.renew(renewRequest(first.guard))).kind).toBe(
      "conflict",
    );
    expect(
      (await subject.locks.release(releaseRequest(first.guard))).kind,
    ).toBe("conflict");
    expect((await subject.locks.inspect("run:run-01")).guard).toEqual(
      second.guard,
    );
  });

  it("returns the completed release observation without appending another event", async () => {
    const subject = fixture();
    const held = await subject.locks.acquire(acquireRequest());
    if (held.kind !== "acquired") throw new Error("Expected first lease");
    const released = await subject.locks.release(releaseRequest(held.guard));
    if (released.kind !== "released") throw new Error("Expected release");
    const before = subject.storage.snapshot();

    await expect(
      subject.locks.release(releaseRequest(released.guard)),
    ).resolves.toEqual(released);
    expect(subject.storage.snapshot()).toEqual(before);
    await expect(
      subject.locks.release(
        releaseRequest({ ...released.guard, fencingToken: 0 }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it.each([
    [
      "renew guard",
      "renew",
      (guard: Parameters<typeof renewRequest>[0]) => ({
        ...renewRequest(guard),
        observed: { ...guard, leaseId: "bad/lease" },
      }),
    ],
    [
      "renew ttl",
      "renew",
      (guard: Parameters<typeof renewRequest>[0]) => ({
        ...renewRequest(guard),
        ttlMs: 4_999,
      }),
    ],
    [
      "renew revision",
      "renew",
      (guard: Parameters<typeof renewRequest>[0]) => ({
        ...renewRequest(guard),
        resultingStateRevision: -1,
      }),
    ],
    [
      "release guard",
      "release",
      (guard: Parameters<typeof releaseRequest>[0]) => ({
        ...releaseRequest(guard),
        observed: { ...guard, leaseFingerprint: { kind: "missing" } },
      }),
    ],
    [
      "release identity",
      "release",
      (guard: Parameters<typeof releaseRequest>[0]) => ({
        ...releaseRequest(guard),
        observedIdentity: { host: "codex", model: null, extra: true },
      }),
    ],
    [
      "takeover owner",
      "takeover",
      (guard: Parameters<typeof takeoverRequest>[0]) => ({
        ...takeoverRequest(guard, "codex:other"),
        owner: "not-an-owner",
      }),
    ],
    [
      "takeover ttl",
      "takeover",
      (guard: Parameters<typeof takeoverRequest>[0]) => ({
        ...takeoverRequest(guard, "codex:other"),
        ttlMs: 300_001,
      }),
    ],
    [
      "takeover revision",
      "takeover",
      (guard: Parameters<typeof takeoverRequest>[0]) => ({
        ...takeoverRequest(guard, "codex:other"),
        stateRevision: -1,
      }),
    ],
  ] as const)(
    "rejects invalid %s before durable I/O",
    async (_label, operation, build) => {
      const storage = memoryTransactionStorage();
      const locks = createLocks({
        clock: { now: () => new Date("2026-08-11T00:00:00.000Z") },
        ids: sequentialIds("invalid-lock"),
        digests: storage.digests,
        durableFileSystem: storage.durableFileSystem,
        schemaRegistry: createSchemaRegistry(),
      });
      const guard = {
        resource: "run:run-01" as const,
        owner: "codex:session-01",
        leaseId: "lease-01",
        fencingToken: 1,
        stateRevision: 1,
        leaseFingerprint: {
          kind: "file" as const,
          size: 1,
          sha256: "a".repeat(64),
        },
        eventsFingerprint: {
          kind: "file" as const,
          size: 1,
          sha256: "b".repeat(64),
        },
      };

      const result =
        operation === "renew"
          ? await locks.renew(build(guard))
          : operation === "release"
            ? await locks.release(
                build(guard) as unknown as ReleaseLeaseRequest,
              )
            : await locks.takeover(build(guard));
      expect(result.kind).toBe("internal_failure");
      expect(storage.calls()).toEqual([]);
    },
  );
});
