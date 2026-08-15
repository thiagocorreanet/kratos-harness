import { types } from "node:util";
import { runInNewContext } from "node:vm";

import type { EventV1, SnapshotV1 } from "@mestre-yoda/contracts";
import {
  eventStorePaths,
  prepareEventAppend,
  type EventAppendServices,
} from "@mestre-yoda/runtime/composition/events";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { TransactionFailure } from "@mestre-yoda/runtime/composition";
import type {
  EventDraftV1,
  EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import { EventIntegrityError } from "@mestre-yoda/runtime/domain/events";
import {
  transactionFailureResult,
  validateResult,
} from "@mestre-yoda/runtime/domain/result";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { memoryTransactionStorage } from "@mestre-yoda/runtime/infra/fake";
import type { DurableFileSystem } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

interface State {
  readonly projectId: string;
  readonly runId: string;
  readonly status: "idle" | "active";
  readonly currentStep: string | null;
  readonly lineage: { readonly prdDigest: string; readonly specDigest: string };
  readonly createdAt: string;
}

const seed: State = {
  projectId: "project-01",
  runId: "run-01",
  status: "idle",
  currentStep: null,
  lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
  createdAt: "2026-08-10T00:00:00Z",
};

function draft(index: number): EventDraftV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation: `sdd.step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [`.brain/features/feature-${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

const reducers: EventReducerRegistry<State> = {
  seed,
  reducers: {
    "policy-01": (state, event) => ({
      ...state,
      status: "active",
      currentStep: event.operation,
    }),
  },
  materialize: (
    state: State,
    cursor: { readonly revision: number; readonly hash: string | null },
  ): SnapshotV1 => {
    if (cursor.hash === null) throw new Error("missing event hash");
    return {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      projectId: state.projectId,
      runId: state.runId,
      status: state.status,
      currentStep: state.currentStep,
      eventCursor: cursor.revision,
      eventHash: cursor.hash,
      policyVersion: "policy-01",
      lineage: state.lineage,
      createdAt: state.createdAt,
      updatedAt: `2026-08-10T00:0${String(cursor.revision)}:00Z`,
    };
  },
};

function services(storage: ReturnType<typeof memoryTransactionStorage>) {
  return {
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
    isProxy: types.isProxy,
    isPromise: types.isPromise,
    reducers,
    schemaRegistry: createSchemaRegistry(),
  };
}

async function firstFiles(): Promise<{
  readonly events: string;
  readonly snapshot: string;
}> {
  const storage = memoryTransactionStorage({
    directories: [
      ".brain/transactions",
      ".brain/02-features/sample-feature/runs/run-01",
    ],
  });
  const prepared = await prepareEventAppend(
    { feature: "sample-feature", runId: "run-01", event: draft(1) },
    services(storage),
  );
  const [events, snapshot] = prepared.effects;
  return { events: events.content, snapshot: snapshot.content };
}

function persistedStorage(files: {
  readonly events: string;
  readonly snapshot: string;
}) {
  return memoryTransactionStorage({
    directories: [
      ".brain/transactions",
      ".brain/02-features/sample-feature/runs/run-01",
    ],
    files: {
      ".brain/02-features/sample-feature/runs/run-01/events.jsonl":
        files.events,
      ".brain/02-features/sample-feature/runs/run-01/state.json":
        files.snapshot,
    },
  });
}

async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TransactionFailure);
    return (error as TransactionFailure).reasonCode;
  }
  throw new Error("expected append preparation to fail");
}

describe("event-store append preparation", () => {
  it("derives only the two canonical paths for a valid run ID", () => {
    expect(
      eventStorePaths({ feature: "sample-feature", runId: "run-01" }),
    ).toEqual({
      events: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
      snapshot: ".brain/02-features/sample-feature/runs/run-01/state.json",
    });
  });

  it.each([
    "contract.state_version_invalid",
    "contract.state_version_unsupported",
  ] as const)("publishes %s without forbidden evidence", (reasonCode) => {
    const result = transactionFailureResult(
      new TransactionFailure(reasonCode, [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ]),
    );

    expect(result.evidence).toEqual([]);
    expect(() => validateResult(result)).not.toThrow();
  });

  it("prepares a first append and exact-prefix successor without writes", async () => {
    const initial = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const first = await prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: draft(1) },
      services(initial),
    );

    expect(first.paths).toEqual({
      events: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
      snapshot: ".brain/02-features/sample-feature/runs/run-01/state.json",
    });
    expect(first.effects.map(({ path }) => path)).toEqual([
      first.paths.events,
      first.paths.snapshot,
    ]);
    expect(first.expected.get(first.paths.events)).toEqual({ kind: "missing" });
    expect(initial.calls()).toEqual(["inspect", "inspect"]);

    const [eventEffect, snapshotEffect] = first.effects;
    const successor = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
      files: {
        [first.paths.events]: eventEffect.content,
        [first.paths.snapshot]: snapshotEffect.content,
      },
    });
    const second = await prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: draft(2) },
      services(successor),
    );
    const secondEvents = second.effects[0].content;

    expect(secondEvents.startsWith(eventEffect.content)).toBe(true);
    expect(secondEvents.split("\n")).toHaveLength(3);
    expect(secondEvents.endsWith("\n")).toBe(true);
    expect(successor.calls()).toEqual([
      "inspect",
      "inspect",
      "read_text",
      "read_text",
    ]);
  });

  it("refuses a first append whose replayed snapshot belongs to another run", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const mismatched: EventReducerRegistry<State> = {
      ...reducers,
      seed: { ...seed, runId: "run-02" },
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        { ...services(storage), reducers: mismatched },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
    expect(storage.calls()).not.toContain("write_file");
  });

  it("refuses a persisted snapshot whose replay remains bound to another run", async () => {
    const mismatched: EventReducerRegistry<State> = {
      ...reducers,
      seed: { ...seed, runId: "run-02" },
    };
    const first = await firstFiles();
    const snapshot = JSON.parse(first.snapshot) as SnapshotV1;
    const storage = persistedStorage({
      events: first.events,
      snapshot: `${canonicalizeJson({ ...snapshot, runId: "run-02" })}\n`,
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), reducers: mismatched },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).not.toContain("write_file");
  });

  it("returns an immutable map view for prepared fingerprints", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const prepared = await prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: draft(1) },
      services(storage),
    );

    const entries = [...prepared.expected.entries()];
    const seen: string[] = [];
    prepared.expected.forEach((_value, path, map) => {
      expect(map).toBe(prepared.expected);
      seen.push(path);
    });

    expect(prepared.expected.size).toBe(2);
    expect(prepared.expected.has(prepared.paths.events)).toBe(true);
    expect([...prepared.expected.keys()]).toEqual(
      entries.map(([path]) => path),
    );
    expect([...prepared.expected.values()]).toEqual(
      entries.map(([, value]) => value),
    );
    expect([...prepared.expected]).toEqual(entries);
    expect(seen).toEqual(entries.map(([path]) => path));
    expect(Object.isFrozen(prepared.expected)).toBe(true);
  });

  it.each(["", "../run-01", "run/01", "run\\01", " run-01"])(
    "refuses unsafe run identifier %j before storage access",
    async (runId) => {
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
      });

      expect(() =>
        eventStorePaths({ feature: "sample-feature", runId }),
      ).toThrow(EventIntegrityError);
      await expect(
        prepareEventAppend(
          { feature: "sample-feature", runId, event: draft(1) },
          services(storage),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      expect(storage.calls()).toEqual([]);
    },
  );

  it.each([
    [
      "digest",
      (base: ReturnType<typeof services>) => ({
        ...base,
        digests: {
          sha256: () =>
            runInNewContext(
              "Promise.reject(new Error('private cross-realm digest'))",
            ) as never,
        },
      }),
    ],
    [
      "schema registry",
      (base: ReturnType<typeof services>) => ({
        ...base,
        schemaRegistry: {
          validate: () =>
            runInNewContext(
              "Promise.reject(new Error('private cross-realm schema'))",
            ) as never,
        } as never,
      }),
    ],
    [
      "proxy detector",
      (base: ReturnType<typeof services>) => ({
        ...base,
        isProxy: () =>
          runInNewContext(
            "Promise.reject(new Error('private cross-realm proxy'))",
          ) as never,
      }),
    ],
  ] as const)(
    "sanitizes a rejected cross-realm Promise from %s without an unhandled rejection",
    async (_label, override) => {
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
      });
      const unhandled: unknown[] = [];
      const observe = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", observe);
      try {
        await expect(
          prepareEventAppend(
            { feature: "sample-feature", runId: "run-01", event: draft(1) },
            override(
              services(storage),
            ) as unknown as EventAppendServices<State>,
          ),
        ).rejects.toMatchObject({
          reasonCode: "runtime.internal_failure",
          evidence: [],
        });
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", observe);
      }
    },
  );

  it("refuses a non-string run ID before storage access", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: 1 as never, event: draft(1) },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual([]);
  });

  it("uses the production proxy detector when none is supplied", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const prepared = services(storage);
    const withoutDetector: EventAppendServices<State> = {
      durableFileSystem: prepared.durableFileSystem,
      digests: prepared.digests,
      reducers: prepared.reducers,
      schemaRegistry: prepared.schemaRegistry,
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        withoutDetector,
      ),
    ).resolves.toMatchObject({
      paths: eventStorePaths({ feature: "sample-feature", runId: "run-01" }),
    });
  });

  it("sanitizes a detector that fails after the request precheck", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    let calls = 0;

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        {
          ...services(storage),
          isProxy: () => {
            calls += 1;
            return calls === 1 ? false : (Promise.resolve(false) as never);
          },
        },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.internal_failure",
      evidence: [],
    });
    expect(storage.calls()).toEqual([]);
  });

  it("sanitizes an unexpected event-domain value without exposing it", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        {
          ...services(storage),
          schemaRegistry: {
            validate: () => ({ kind: "valid", value: circular }) as never,
          } as never,
        },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.internal_failure",
      evidence: [],
    });
  });

  it.each([
    ["malformed JSON", "{", "runtime.state_corrupt"],
    ["a scalar JSON snapshot", '"private"', "contract.state_version_invalid"],
  ] as const)(
    "refuses a persisted %s without writes",
    async (_name, snapshot, reasonCode) => {
      const files = await firstFiles();
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
        files: {
          ".brain/02-features/sample-feature/runs/run-01/events.jsonl":
            files.events,
          ".brain/02-features/sample-feature/runs/run-01/state.json": snapshot,
        },
      });

      await expect(
        prepareEventAppend(
          { feature: "sample-feature", runId: "run-01", event: draft(2) },
          services(storage),
        ),
      ).rejects.toMatchObject({ reasonCode });
      expect(storage.calls()).toEqual([
        "inspect",
        "inspect",
        "read_text",
        "read_text",
      ]);
    },
  );

  it("refuses an inspected file with an invalid fingerprint shape", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect: async (path) =>
        path.endsWith("events.jsonl")
          ? { kind: "file", size: -1, sha256: "private" }
          : storage.durableFileSystem.inspect(path),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("keeps generic snapshot validation failures as state corruption", async () => {
    const files = await firstFiles();
    const snapshot = JSON.parse(files.snapshot) as SnapshotV1;
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
      files: {
        ".brain/02-features/sample-feature/runs/run-01/events.jsonl":
          files.events,
        ".brain/02-features/sample-feature/runs/run-01/state.json": `${canonicalizeJson({ ...snapshot, status: "private" })}\n`,
      },
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        services(storage),
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ],
    });
  });

  it("classifies a changed snapshot read as artifact revision evidence", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      readText: async (path) =>
        path.endsWith("state.json")
          ? `${files.snapshot}private`
          : storage.durableFileSystem.readText(path),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.revision_conflict",
      evidence: [
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ],
    });
  });

  it.each([
    [
      "digest",
      (base: ReturnType<typeof services>) => ({
        ...base,
        digests: { sha256: () => Promise.reject(new Error("private digest")) },
      }),
    ],
    [
      "schema registry",
      (base: ReturnType<typeof services>) => ({
        ...base,
        schemaRegistry: {
          validate: () => Promise.reject(new Error("private schema")),
        } as never,
      }),
    ],
    [
      "proxy detector",
      (base: ReturnType<typeof services>) => ({
        ...base,
        isProxy: () => Promise.reject(new Error("private proxy")) as never,
      }),
    ],
  ] as const)(
    "sanitizes a rejected native Promise from %s without an unhandled rejection",
    async (_label, override) => {
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
      });
      const unhandled: unknown[] = [];
      const observe = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", observe);
      try {
        await expect(
          prepareEventAppend(
            { feature: "sample-feature", runId: "run-01", event: draft(1) },
            override(
              services(storage),
            ) as unknown as EventAppendServices<State>,
          ),
        ).rejects.toMatchObject({
          reasonCode: "runtime.internal_failure",
          evidence: [],
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", observe);
      }
    },
  );

  it("rejects a missing stream/snapshot pair without reading or writing", async () => {
    const files = await firstFiles();
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
      files: {
        ".brain/02-features/sample-feature/runs/run-01/events.jsonl":
          files.events,
      },
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
  });

  it("rejects a missing snapshot when the event stream is absent", async () => {
    const files = await firstFiles();
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
      files: {
        ".brain/02-features/sample-feature/runs/run-01/state.json":
          files.snapshot,
      },
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        services(storage),
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ],
    });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
  });

  it("rejects a non-file stream entry before reads", async () => {
    const files = await firstFiles();
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
        ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
      ],
      files: {
        ".brain/02-features/sample-feature/runs/run-01/state.json":
          files.snapshot,
      },
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
  });

  it.each(["symlink", "special"] as const)(
    "rejects a %s entry with paired corruption evidence",
    async (kind) => {
      const files = await firstFiles();
      const storage = persistedStorage(files);
      const durableFileSystem: DurableFileSystem = {
        ...storage.durableFileSystem,
        inspect: async (path) =>
          path.endsWith("events.jsonl")
            ? { kind }
            : storage.durableFileSystem.inspect(path),
      };

      await expect(
        prepareEventAppend(
          { feature: "sample-feature", runId: "run-01", event: draft(2) },
          { ...services(storage), durableFileSystem },
        ),
      ).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
        evidence: [
          {
            kind: "event",
            ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
          },
          {
            kind: "artifact",
            ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
          },
        ],
      });
    },
  );

  it("rejects a non-file snapshot entry with paired corruption evidence", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect: async (path) =>
        path.endsWith("state.json")
          ? { kind: "directory" }
          : storage.durableFileSystem.inspect(path),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ],
    });
  });

  it("rejects an oversized stream from inspected metadata before readText", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect: async (path) =>
        path.endsWith("events.jsonl")
          ? { kind: "file", size: 64 * 1024 * 1024 + 1, sha256: "a".repeat(64) }
          : storage.durableFileSystem.inspect(path),
      readText: () => Promise.reject(new Error("readText must not be called")),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual(["inspect"]);
  });

  it.each([
    ["a malformed event stream", { events: "{private\n" }],
    ["a changed snapshot cursor", { snapshot: { eventCursor: 99 } }],
    ["a changed snapshot hash", { snapshot: { eventHash: "f".repeat(64) } }],
    ["a changed snapshot content", { snapshot: { status: "idle" } }],
  ] as const)("rejects %s without writes", async (_label, mutation) => {
    const files = await firstFiles();
    let events = files.events;
    let snapshot = files.snapshot;
    if ("events" in mutation) events = mutation.events;
    if ("snapshot" in mutation) {
      snapshot = `${canonicalizeJson({
        ...(JSON.parse(snapshot) as Record<string, unknown>),
        ...mutation.snapshot,
      })}\n`;
    }
    const storage = persistedStorage({ events, snapshot });

    expect(
      await failureCode(() =>
        prepareEventAppend(
          { feature: "sample-feature", runId: "run-01", event: draft(2) },
          services(storage),
        ),
      ),
    ).toBe("runtime.state_corrupt");
    expect(storage.snapshot().files).toEqual({
      ".brain/02-features/sample-feature/runs/run-01/events.jsonl": events,
      ".brain/02-features/sample-feature/runs/run-01/state.json": snapshot,
    });
  });

  it.each([
    ["invalid", "not-a-contract-version", "contract.state_version_invalid"],
    ["unsupported", "2.0.0", "contract.state_version_unsupported"],
  ] as const)(
    "preserves the catalog reason for an %s snapshot version",
    async (_label, stateContract, reasonCode) => {
      const files = await firstFiles();
      const snapshot = `${canonicalizeJson({
        ...(JSON.parse(files.snapshot) as Record<string, unknown>),
        stateContract,
      })}\n`;
      const storage = persistedStorage({ ...files, snapshot });

      expect(
        await failureCode(() =>
          prepareEventAppend(
            { feature: "sample-feature", runId: "run-01", event: draft(2) },
            services(storage),
          ),
        ),
      ).toBe(reasonCode);
    },
  );

  it("publishes a real prepared version failure without forbidden evidence", async () => {
    const files = await firstFiles();
    const snapshot = `${canonicalizeJson({
      ...(JSON.parse(files.snapshot) as Record<string, unknown>),
      stateContract: "2.0.0",
    })}\n`;
    const storage = persistedStorage({ ...files, snapshot });
    let failure: TransactionFailure | undefined;
    try {
      await prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        services(storage),
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TransactionFailure);
      failure = error as TransactionFailure;
    }
    if (failure === undefined) throw new Error("expected version failure");

    const result = transactionFailureResult(failure);
    expect(failure.reasonCode).toBe("contract.state_version_unsupported");
    expect(result.evidence).toEqual([]);
    expect(() => validateResult(result)).not.toThrow();
  });

  it("snapshots an in-flight draft mutation before the first read", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const mutable = draft(2) as EventDraftV1 & { operation: string };
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      readText: async (path) => {
        await wait;
        return storage.durableFileSystem.readText(path);
      },
    };
    const pending = prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: mutable },
      { ...services(storage), durableFileSystem },
    );
    mutable.operation = "attacker-change";
    release?.();

    const prepared = await pending;
    expect(prepared.event.operation).toBe("sdd.step-2");
  });

  it("snapshots reducers before the first durable await", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const mutable: EventReducerRegistry<State> & {
      seed: State & { runId: string };
      reducers: Record<string, (state: State, event: EventV1) => State>;
    } = {
      seed: { ...seed },
      reducers: { ...reducers.reducers },
      materialize: (state, cursor) => reducers.materialize(state, cursor),
    };
    let mutated = false;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect: async (path) => {
        if (!mutated) {
          mutated = true;
          mutable.seed.runId = "run-02";
          mutable.reducers["policy-01"] = () => ({ ...seed, runId: "run-02" });
          mutable.materialize = () => {
            throw new Error("mutated materializer must not run");
          };
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    const prepared = await prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: draft(1) },
      { ...services(storage), durableFileSystem, reducers: mutable },
    );

    expect(mutated).toBe(true);
    expect(
      (JSON.parse(prepared.effects[1].content) as { readonly runId: unknown })
        .runId,
    ).toBe("run-01");
  });

  it("refuses throwing input accessors without storage access", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const input = Object.defineProperty({ runId: "run-01" }, "event", {
      enumerable: true,
      get: () => {
        throw new Error("private accessor");
      },
    });

    await expect(
      prepareEventAppend(input as never, services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual([]);
  });

  it("rejects a file changed between inspect and readText", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      readText: async (path) =>
        path.endsWith("events.jsonl")
          ? `${files.events}{"changed":true}\n`
          : storage.durableFileSystem.readText(path),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.revision_conflict" });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
  });

  it("classifies oversized bytes changed after inspection as a revision conflict", async () => {
    const files = await firstFiles();
    const storage = persistedStorage(files);
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      readText: async (path) =>
        path.endsWith("events.jsonl")
          ? `${files.events}${"x".repeat(64 * 1024 * 1024)}\n`
          : storage.durableFileSystem.readText(path),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(2) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.revision_conflict",
      evidence: [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
      ],
    });
  });

  it("classifies forged storage failures as sanitized internal failures", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect: () =>
        Promise.reject(
          new TransactionFailure("runtime.state_corrupt", [
            { kind: "artifact", ref: "private-storage-error" },
          ]),
        ),
    };

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.internal_failure",
      evidence: [],
      message: "Managed transaction failed",
    });
  });

  it.each([
    [
      "digest",
      (base: ReturnType<typeof services>) => ({
        ...base,
        digests: {
          sha256: () => {
            throw new EventIntegrityError("invalid_event");
          },
          sha256Bytes: () => {
            throw new EventIntegrityError("invalid_event");
          },
        },
      }),
    ],
    [
      "schema registry",
      (base: ReturnType<typeof services>) => ({
        ...base,
        schemaRegistry: {
          validate: () => {
            throw new TransactionFailure("runtime.state_corrupt", [
              { kind: "artifact", ref: "private-schema-error" },
            ]);
          },
        } as never,
      }),
    ],
    [
      "proxy detector",
      (base: ReturnType<typeof services>) => ({
        ...base,
        isProxy: () => {
          throw new EventIntegrityError("invalid_event");
        },
      }),
    ],
  ] as const)(
    "sanitizes a forged %s capability error",
    async (_label, override) => {
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
      });

      await expect(
        prepareEventAppend(
          { feature: "sample-feature", runId: "run-01", event: draft(1) },
          override(services(storage)),
        ),
      ).rejects.toMatchObject({
        reasonCode: "runtime.internal_failure",
        evidence: [],
        message: "Managed transaction failed",
      });
    },
  );

  it("rejects root and draft proxies after proxy detection without traps", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    let traps = 0;
    const handler = {
      get: () => {
        traps += 1;
        throw new Error("proxy trap must not run");
      },
    };
    const root = new Proxy(
      { feature: "sample-feature", runId: "run-01", event: draft(1) },
      handler,
    );
    const event = new Proxy(draft(1), handler);

    for (const input of [root, { runId: "run-01", event }]) {
      await expect(
        prepareEventAppend(input as never, services(storage)),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    }
    expect(traps).toBe(0);
    expect(storage.calls()).toEqual([]);
  });

  it("rejects a hostile registry before storage without running its traps", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    let traps = 0;
    const registryProxy = new Proxy(reducers, {
      get: () => {
        traps += 1;
        throw new Error("private registry trap");
      },
    });

    await expect(
      prepareEventAppend(
        { feature: "sample-feature", runId: "run-01", event: draft(1) },
        { ...services(storage), reducers: registryProxy },
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [],
    });
    expect(traps).toBe(0);
    expect(storage.calls()).toEqual([]);
  });

  it.each(["reducer", "materializer"] as const)(
    "sanitizes a rejected native Promise from a %s as state corruption",
    async (kind) => {
      const storage = memoryTransactionStorage({
        directories: [
          ".brain/transactions",
          ".brain/02-features/sample-feature/runs/run-01",
        ],
      });
      const asyncRegistry =
        kind === "reducer"
          ? {
              ...reducers,
              reducers: { "policy-01": () => Promise.resolve(seed) },
            }
          : {
              ...reducers,
              materialize: () => Promise.reject(new Error("private rejection")),
            };

      await expect(
        prepareEventAppend(
          { feature: "sample-feature", runId: "run-01", event: draft(1) },
          {
            ...services(storage),
            reducers: asyncRegistry as unknown as EventReducerRegistry<State>,
          },
        ),
      ).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
        evidence: [
          {
            kind: "event",
            ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
          },
          {
            kind: "artifact",
            ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
          },
        ],
      });
      await Promise.resolve();
    },
  );

  it("does not permit runtime mutation of prepared effects or fingerprints", async () => {
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/02-features/sample-feature/runs/run-01",
      ],
    });
    const prepared = await prepareEventAppend(
      { feature: "sample-feature", runId: "run-01", event: draft(1) },
      services(storage),
    );
    const events = prepared.effects[0].content;
    const expected = prepared.expected.get(prepared.paths.events);

    expect(() => {
      (prepared.effects as unknown as { 0: { content: string } })[0].content =
        "attacker";
    }).toThrow();
    expect(() => {
      (prepared.expected as unknown as Map<string, unknown>).set(
        prepared.paths.events,
        { kind: "file" },
      );
    }).toThrow();
    expect(prepared.effects[0].content).toBe(events);
    expect(prepared.expected.get(prepared.paths.events)).toEqual(expected);
  });
});
