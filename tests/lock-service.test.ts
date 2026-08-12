import { createLocks } from "@mestre-yoda/runtime/composition";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { lockPaths } from "@mestre-yoda/runtime/domain/locks";
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
});
