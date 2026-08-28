import type { SnapshotV1 } from "@kratos/contracts";
import {
  applyPlan,
  createRuntime,
  TransactionFailure,
} from "@kratos/runtime/composition";
import { planOf } from "@kratos/runtime/domain/effects";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import type {
  CurrentEventDraft,
  EventReducerRegistry,
} from "@kratos/runtime/domain/events";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
  type DurableOperation,
} from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

const eventsPath = ".brain/02-features/sample-feature/runs/run-01/events.jsonl";
const snapshotPath = ".brain/02-features/sample-feature/runs/run-01/state.json";
const rejectedPersistedText = "PRIVATE_PERSISTED_CORRUPTION_93847";
const mutationOperations: readonly DurableOperation[] = [
  "create_directory",
  "create_directory_exclusive",
  "open_file",
  "write_file",
  "sync_file",
  "close_file",
  "replace_file",
  "remove_file",
  "remove_empty_directory",
  "sync_directory",
];

function draft(index: number): CurrentEventDraft {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation:
      index === 3 ? rejectedPersistedText : `sdd.step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [`.brain/features/feature-${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
  };
}

const reducers: EventReducerRegistry<{ readonly step: string | null }> = {
  seed: { step: null },
  reducers: {
    "policy-01": (state, event) => ({ ...state, step: event.operation }),
  },
  materialize: (state, cursor): SnapshotV1 => {
    if (cursor.hash === null) throw new Error("missing event hash");
    return {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      projectId: "project-01",
      runId: "run-01",
      status: "active",
      currentStep: state.step,
      eventCursor: cursor.revision,
      eventHash: cursor.hash,
      policyVersion: "policy-01",
      lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: `2026-08-10T00:0${String(cursor.revision)}:00Z`,
    };
  },
};

function runtime(storage: ReturnType<typeof memoryTransactionStorage>) {
  return createRuntime({
    clock: fixedClock("2026-08-10T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
    fileSystem: storage.fileSystem,
    output: recordingOutput(),
  });
}

async function persistedThreeEvents(): Promise<
  ReturnType<ReturnType<typeof memoryTransactionStorage>["snapshot"]>
> {
  const storage = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
  });
  const ports = runtime(storage);
  for (const index of [1, 2, 3]) {
    await applyPlan(
      planOf({
        kind: "append_event",
        feature: "sample-feature",
        runId: "run-01",
        event: draft(index),
      }),
      ports,
      {
        rootMode: "existing",
        eventReducers: reducers,
      },
    );
  }
  const snapshot = storage.snapshot();
  const events = snapshot.files[eventsPath] ?? "";
  const records = events.trimEnd().split("\n");
  const persistedSnapshot = JSON.parse(
    snapshot.files[snapshotPath] ?? "",
  ) as SnapshotV1;
  const tail = JSON.parse(records.at(-1) ?? "") as { eventHash: string };
  expect(records).toHaveLength(3);
  expect(events).toBe(`${records.join("\n")}\n`);
  expect(persistedSnapshot.eventCursor).toBe(3);
  expect(persistedSnapshot.eventHash).toBe(tail.eventHash);
  expect(events).toContain(rejectedPersistedText);
  expect(snapshot.files[snapshotPath]).toContain(rejectedPersistedText);
  return snapshot;
}

function mutationTrace(
  storage: ReturnType<typeof memoryTransactionStorage>,
): readonly DurableOperation[] {
  return storage
    .calls()
    .filter((operation) => mutationOperations.includes(operation));
}

function replaceRecord(
  events: string,
  index: number,
  transform: (record: Record<string, unknown>) => Record<string, unknown>,
): string {
  const records = events.trimEnd().split("\n");
  const record = JSON.parse(records[index] ?? "") as Record<string, unknown>;
  records[index] = canonicalizeJson(transform(record));
  return `${records.join("\n")}\n`;
}

const corruptions = [
  [
    "mutated protected byte",
    (events: string, snapshot: string) => ({
      events: events.replace("sdd.step-1", rejectedPersistedText),
      snapshot,
    }),
  ],
  [
    "first record removed",
    (events: string, snapshot: string) => ({
      events: `${events.trimEnd().split("\n").slice(1).join("\n")}\n`,
      snapshot,
    }),
  ],
  [
    "middle record removed",
    (events: string, snapshot: string) => {
      const records = events.trimEnd().split("\n");
      records.splice(1, 1);
      return { events: `${records.join("\n")}\n`, snapshot };
    },
  ],
  [
    "tail truncated with stale snapshot",
    (events: string, snapshot: string) => ({
      events: `${events.trimEnd().split("\n").slice(0, -1).join("\n")}\n`,
      snapshot,
    }),
  ],
  [
    "records reordered",
    (events: string, snapshot: string) => {
      const records = events.trimEnd().split("\n");
      [records[0], records[1]] = [records[1] ?? "", records[0] ?? ""];
      return { events: `${records.join("\n")}\n`, snapshot };
    },
  ],
  [
    "record duplicated",
    (events: string, snapshot: string) => {
      const records = events.trimEnd().split("\n");
      records.splice(1, 0, records[1] ?? "");
      return { events: `${records.join("\n")}\n`, snapshot };
    },
  ],
  [
    "previous hash changed",
    (events: string, snapshot: string) => ({
      events: replaceRecord(events, 1, (record) => ({
        ...record,
        previousHash: "0".repeat(64),
      })),
      snapshot,
    }),
  ],
  [
    "event hash changed",
    (events: string, snapshot: string) => ({
      events: replaceRecord(events, 1, (record) => ({
        ...record,
        eventHash: "0".repeat(64),
      })),
      snapshot,
    }),
  ],
  [
    "snapshot cursor changed",
    (events: string, snapshot: string) => ({
      events,
      snapshot: `${canonicalizeJson({ ...(JSON.parse(snapshot) as Record<string, unknown>), eventCursor: 1 })}\n`,
    }),
  ],
  [
    "snapshot hash changed",
    (events: string, snapshot: string) => ({
      events,
      snapshot: `${canonicalizeJson({ ...(JSON.parse(snapshot) as Record<string, unknown>), eventHash: "0".repeat(64) })}\n`,
    }),
  ],
] as const;

describe("persisted event-store corruption", () => {
  it.each(corruptions)(
    "refuses %s without changing either persisted file",
    async (_label, corrupt) => {
      const valid = await persistedThreeEvents();
      const damaged = corrupt(
        valid.files[eventsPath] ?? "",
        valid.files[snapshotPath] ?? "",
      );
      const storage = memoryTransactionStorage({
        directories: valid.directories,
        files: {
          ...valid.files,
          [eventsPath]: damaged.events,
          [snapshotPath]: damaged.snapshot,
        },
      });
      const before = storage.snapshot();
      const beforeMutations = mutationTrace(storage);
      let failure: unknown;
      try {
        await applyPlan(
          planOf({
            kind: "append_event",
            feature: "sample-feature",
            runId: "run-01",
            event: draft(4),
          }),
          runtime(storage),
          {
            rootMode: "existing",
            eventReducers: reducers,
          },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "event", ref: eventsPath },
          { kind: "artifact", ref: snapshotPath },
        ]),
      );
      expect(JSON.stringify(failure)).not.toContain(rejectedPersistedText);
      expect(storage.snapshot()).toEqual(before);
      expect(mutationTrace(storage)).toEqual(beforeMutations);
      expect(
        storage.calls().filter((operation) => operation === "write_file"),
      ).toEqual([]);
      expect(
        Object.keys(storage.snapshot().files).filter((path) =>
          path.startsWith(".brain/transactions/transaction-"),
        ),
      ).toEqual(
        Object.keys(before.files).filter((path) =>
          path.startsWith(".brain/transactions/transaction-"),
        ),
      );
    },
  );
});
