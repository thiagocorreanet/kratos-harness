import {
  createLocks,
  type TransactionServices,
} from "@kratos/runtime/composition";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  lockPaths,
  type LeaseGuard,
  type RenewLeaseRequest,
} from "@kratos/runtime/domain/locks";
import type { ManagedMutationPlan } from "@kratos/runtime/domain/transactions";
import {
  memoryTransactionStorage,
  sequentialIds,
} from "../../packages/runtime/src/infra/fake/index.js";

import {
  acquireRequest,
  renewRequest,
  takeoverRequest,
} from "./lock-contract.js";

/**
 * The renewal a protected mutation prepares. Its state revision advances,
 * because the transaction the guard protects is the one producing that state.
 */
export function guardedRenewal(guard: LeaseGuard): RenewLeaseRequest {
  return {
    ...renewRequest(guard),
    resultingStateRevision: guard.stateRevision + 1,
  };
}

export type GuardedFixture = ReturnType<typeof guardedFixture>;

/**
 * A project holding one run lease, with the transaction services that lease was
 * published through. Both the lock service and the caller's transaction share a
 * durable filesystem, because fencing only means anything when the guard and
 * the mutation land on the same storage.
 */
export function guardedFixture(
  directories: readonly string[] = [".brain/runs/run-01"],
) {
  const storage = memoryTransactionStorage({ directories: [...directories] });
  let now = new Date("2026-08-11T00:00:00.000Z").getTime();
  const services: TransactionServices = {
    clock: { now: () => new Date(now) },
    ids: sequentialIds("guard"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
  return {
    storage,
    services,
    locks: createLocks(services),
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

/** A caller mutation outside `.brain/locks/**`, which the guard protects. */
export function callerPlan(
  storage: GuardedFixture["storage"],
  path = ".brain/runs/run-01/result.json",
  content = "first",
): ManagedMutationPlan {
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path,
        expected: { kind: "missing" },
        result: {
          kind: "file",
          size: content.length,
          sha256: storage.digests.sha256(content),
        },
        stagedPath: "staging/operation-0001.payload",
        content,
      },
    ],
  };
}

/**
 * How many times a durable operation has run, so a fault can be aimed at the
 * next one instead of at a count that shifts whenever setup changes.
 */
export function callCount(
  storage: GuardedFixture["storage"],
  operation: "replace_file",
): number {
  return storage.calls().filter((call) => call === operation).length;
}

/** Overwrite a durable artifact the way any other writer's transaction would. */
export async function overwrite(
  storage: GuardedFixture["storage"],
  path: string,
  content: string,
): Promise<void> {
  const staged = `${path}.incoming`;
  await storage.durableFileSystem.writeSynced(staged, content);
  await storage.durableFileSystem.replaceFile(staged, path);
}

/**
 * The exact lock artifacts a real takeover leaves behind, replayed on its own
 * storage from the same acquisition. Fabricating a higher fencing token by hand
 * would prove only that the guard rejects arbitrary bytes; replaying the real
 * transition proves it rejects a legitimately newer owner.
 */
export async function takenOverArtifacts(): Promise<{
  readonly events: string;
  readonly lease: string;
}> {
  const subject = guardedFixture();
  const held = await subject.locks.acquire(acquireRequest());
  if (held.kind !== "acquired") throw new Error("Expected an acquired lease");
  subject.advance(60_000);
  const stolen = await subject.locks.takeover(
    takeoverRequest(held.guard, "codex:session-02"),
  );
  if (stolen.kind !== "taken_over") throw new Error("Expected a taken lease");
  const paths = lockPaths("run:run-01");
  const files = subject.storage.snapshot().files;
  const events = files[paths.events];
  const lease = files[paths.lease];
  if (events === undefined || lease === undefined)
    throw new Error("Expected durable lock artifacts");
  return { events, lease };
}
