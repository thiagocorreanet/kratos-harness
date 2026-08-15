import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocks } from "@kratos/runtime/composition";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  memoryTransactionStorage,
  sequentialIds,
} from "../packages/runtime/src/infra/fake/index.js";
import { nodeDurableFileSystem } from "../packages/runtime/src/infra/node/index.js";

import {
  describeLocksContract,
  type LockFixture,
} from "./support/lock-contract.js";

function advancingClock(initial: string) {
  let now = new Date(initial).getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function memoryFixture(): Promise<LockFixture> {
  const storage = memoryTransactionStorage();
  const time = advancingClock("2026-08-11T00:00:00.000Z");
  return Promise.resolve({
    locks: createLocks({
      ...time,
      ids: sequentialIds("memory-lock"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      schemaRegistry: createSchemaRegistry(),
    }),
    advance: time.advance,
    dispose: () => Promise.resolve(),
  });
}

async function nodeFixture(): Promise<LockFixture> {
  const root = await mkdtemp(join(tmpdir(), "kratos-locks-"));
  const time = advancingClock("2026-08-11T00:00:00.000Z");
  return {
    locks: createLocks({
      ...time,
      ids: sequentialIds("node-lock"),
      digests: memoryTransactionStorage().digests,
      durableFileSystem: nodeDurableFileSystem(root),
      schemaRegistry: createSchemaRegistry(),
    }),
    advance: time.advance,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

describeLocksContract("memory", memoryFixture);
describeLocksContract("node", nodeFixture);
