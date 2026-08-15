import type { SnapshotV1 } from "@mestre-yoda/contracts";
import {
  applyPlan,
  createRuntime,
  inspectManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  type TransactionReceipt,
  type TransactionServices,
  type TransactionSummary,
} from "@mestre-yoda/runtime/composition";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import type {
  EventDraftV1,
  EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
  type DurableOperation,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

/**
 * Enough room for the same campaign under coverage instrumentation.
 *
 * The uninstrumented run finishes in well under a minute; v8 coverage adds
 * enough overhead to cross a 60-second limit on a slower machine, and a
 * campaign that fails on the timer rather than on a boundary reports a defect
 * nobody introduced.
 */
const campaignTimeoutMilliseconds = 180_000;

const eventsPath = ".brain/02-features/sample-feature/runs/run-01/events.jsonl";
const snapshotPath = ".brain/02-features/sample-feature/runs/run-01/state.json";
const progressPath = ".brain/transactions/campaign-1/progress.json";
const selectedOperations = [
  "inspect",
  "read_text",
  "create_directory_exclusive",
  "write_file",
  "sync_file",
  "replace_file",
  "sync_directory",
  "remove_file",
] as const satisfies readonly DurableOperation[];

type SelectedOperation = (typeof selectedOperations)[number];
type CrashPhase = "prepared" | "publishing";
type TerminalPhase = "aborted" | "committed";
type ExecutionPhase = "none" | "begun" | CrashPhase | "committed";
type Storage = ReturnType<typeof memoryTransactionStorage>;
type StorageSnapshot = ReturnType<Storage["snapshot"]>;
interface Pair {
  readonly events: string | undefined;
  readonly snapshot: string | undefined;
}

interface CrashCase {
  readonly name: CrashPhase;
  readonly boundary: {
    readonly operation: "sync_directory";
    readonly timing: "after";
    readonly occurrence: number;
  };
  readonly terminal: TerminalPhase;
  readonly recoveryCounts: Readonly<Record<SelectedOperation, number>>;
}

const crashCases: readonly CrashCase[] = [
  {
    name: "prepared",
    boundary: { operation: "sync_directory", timing: "after", occurrence: 7 },
    terminal: "aborted",
    recoveryCounts: {
      inspect: 59,
      read_text: 10,
      create_directory_exclusive: 0,
      write_file: 1,
      sync_file: 1,
      replace_file: 1,
      sync_directory: 2,
      remove_file: 2,
    },
  },
  {
    name: "publishing",
    boundary: { operation: "sync_directory", timing: "after", occurrence: 8 },
    terminal: "committed",
    recoveryCounts: {
      inspect: 73,
      read_text: 10,
      create_directory_exclusive: 0,
      write_file: 3,
      sync_file: 3,
      replace_file: 5,
      sync_directory: 6,
      remove_file: 0,
    },
  },
];

// `RUN-06a` moved a run under the feature that opened it, so its root sits two
// directories deeper than `.brain/runs/<run>` did. The transaction inspects
// each parent on the way down, which is exactly the two additional inspections
// counted here; no other operation moved.
const executionCounts: Readonly<Record<SelectedOperation, number>> = {
  inspect: 121,
  read_text: 14,
  create_directory_exclusive: 1,
  write_file: 9,
  sync_file: 9,
  replace_file: 8,
  sync_directory: 14,
  remove_file: 0,
};

// The four additional boundaries all fall before the transaction has begun:
// creating and synchronizing the two extra parent directories happens outside
// any phase, so only the `none` tally moves.
const executionPhaseCounts: Readonly<Record<ExecutionPhase, number>> = {
  none: 233,
  begun: 38,
  prepared: 10,
  publishing: 58,
  committed: 13,
};

const expectedDirectExecutionReceipts = [
  // The last inspection moved with the run's depth: two additional parents on
  // the way to `.brain/02-features/<feature>/runs/<run>`.
  "inspect:before:121:committed",
  "inspect:after:121:committed",
  "sync_directory:before:14:committed",
  "sync_directory:after:14:committed",
] as const;

const expectedDirectTerminalReceipts = [
  "prepared:inspect:before:52:aborted",
  "prepared:inspect:after:52:aborted",
  "prepared:sync_directory:before:2:aborted",
  "prepared:sync_directory:after:2:aborted",
  "prepared:inspect:before:53:aborted",
  "prepared:inspect:after:53:aborted",
  "prepared:inspect:before:54:aborted",
  "prepared:inspect:after:54:aborted",
  "prepared:inspect:before:55:aborted",
  "prepared:inspect:after:55:aborted",
  "prepared:inspect:before:56:aborted",
  "prepared:inspect:after:56:aborted",
  "prepared:inspect:before:57:aborted",
  "prepared:inspect:after:57:aborted",
  "prepared:inspect:before:58:aborted",
  "prepared:inspect:after:58:aborted",
  "prepared:inspect:before:59:aborted",
  "prepared:inspect:after:59:aborted",
  "publishing:inspect:before:73:committed",
  "publishing:inspect:after:73:committed",
  "publishing:sync_directory:before:6:committed",
  "publishing:sync_directory:after:6:committed",
] as const;

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

function runtime(storage: Storage, prefix: string) {
  return createRuntime({
    clock: fixedClock("2026-08-10T00:00:00.000Z"),
    ids: sequentialIds(prefix),
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
    fileSystem: storage.fileSystem,
    output: recordingOutput(),
  });
}

function services(storage: Storage): TransactionServices {
  return {
    clock: fixedClock("2026-08-10T00:00:00.000Z"),
    ids: sequentialIds("recovery"),
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
    schemaRegistry: createSchemaRegistry(),
  };
}

async function oldSeed(): Promise<StorageSnapshot> {
  const initial = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
  });
  const ports = runtime(initial, "seed");
  for (const index of [1, 2, 3]) {
    await applyPlan(
      planOf({
        kind: "append_event",
        feature: "sample-feature",
        runId: "run-01",
        event: draft(index),
      }),
      ports,
      { rootMode: "existing", eventReducers: reducers },
    );
  }
  return initial.snapshot();
}

function storageFrom(seed: StorageSnapshot): Storage {
  return memoryTransactionStorage({
    directories: seed.directories,
    files: seed.files,
  });
}

function pair(storage: Storage): Pair {
  const files = storage.snapshot().files;
  return { events: files[eventsPath], snapshot: files[snapshotPath] };
}

function selectedCounts(
  calls: readonly DurableOperation[],
): Readonly<Record<SelectedOperation, number>> {
  return Object.fromEntries(
    selectedOperations.map((operation) => [
      operation,
      calls.filter((candidate) => candidate === operation).length,
    ]),
  ) as Readonly<Record<SelectedOperation, number>>;
}

function boundaries(calls: readonly DurableOperation[]) {
  const occurrences = new Map<SelectedOperation, number>();
  return calls.flatMap((operation) => {
    if (!selectedOperations.includes(operation as SelectedOperation)) return [];
    const selected = operation as SelectedOperation;
    const occurrence = (occurrences.get(selected) ?? 0) + 1;
    occurrences.set(selected, occurrence);
    return [
      { operation: selected, timing: "before" as const, occurrence },
      { operation: selected, timing: "after" as const, occurrence },
    ];
  });
}

function executionPhase(
  calls: readonly DurableOperation[],
  boundary: ReturnType<typeof boundaries>[number],
): ExecutionPhase {
  let phase: ExecutionPhase = "none";
  let replacements = 0;
  const occurrences = new Map<SelectedOperation, number>();
  for (const operation of calls) {
    const selected = operation as SelectedOperation;
    const occurrence = selectedOperations.includes(selected)
      ? (occurrences.get(selected) ?? 0) + 1
      : 0;
    if (occurrence !== 0) occurrences.set(selected, occurrence);
    if (
      operation === boundary.operation &&
      occurrence === boundary.occurrence &&
      boundary.timing === "before"
    ) {
      return phase;
    }
    if (operation === "replace_file") {
      replacements += 1;
      if (replacements === 1) phase = "begun";
      if (replacements === 2) phase = "prepared";
      if (replacements === 3) phase = "publishing";
      if (replacements === 8) phase = "committed";
    }
    if (
      operation === boundary.operation &&
      occurrence === boundary.occurrence &&
      boundary.timing === "after"
    ) {
      return phase;
    }
  }
  throw new Error("execution boundary is absent from trace");
}

async function executeFourth(storage: Storage): Promise<unknown> {
  try {
    await applyPlan(
      planOf({
        kind: "append_event",
        feature: "sample-feature",
        runId: "run-01",
        event: draft(4),
      }),
      runtime(storage, "campaign"),
      { rootMode: "existing", eventReducers: reducers },
    );
    return null;
  } catch (error) {
    return error;
  }
}

async function campaignSummary(
  transactionServices: TransactionServices,
): Promise<TransactionSummary> {
  const summaries = (
    await inspectManagedTransactions(transactionServices)
  ).filter(({ transactionId }) => transactionId === "campaign-1");
  expect(summaries).toHaveLength(1);
  const summary = summaries[0];
  if (summary === undefined) throw new Error("campaign transaction is absent");
  return summary;
}

function expectSummary(
  summary: TransactionSummary,
  phase: CrashPhase | TerminalPhase,
  expected?: TransactionSummary,
): void {
  expect(summary.transactionId).toBe("campaign-1");
  expect(summary.phase).toBe(phase);
  expect(summary.evidenceRef).toBe(progressPath);
  expect(summary.manifestDigest).toEqual(expect.any(String));
  expect(summary.recoveryToken).toBe(summary.manifestDigest);
  if (expected !== undefined) {
    expect(summary.manifestDigest).toBe(expected.manifestDigest);
    expect(summary.recoveryToken).toBe(expected.recoveryToken);
  }
}

function expectExecutionSummary(
  summary: TransactionSummary,
  phase: Exclude<ExecutionPhase, "none">,
  manifestIdentity: TransactionSummary,
): void {
  expect(summary.transactionId).toBe("campaign-1");
  expect(summary.phase).toBe(phase);
  expect(summary.evidenceRef).toBe(progressPath);
  if (phase === "begun") {
    expect(summary.manifestDigest).toBeNull();
    expect(summary.recoveryToken).toEqual(expect.any(String));
    return;
  }
  expect(summary.manifestDigest).toBe(manifestIdentity.manifestDigest);
  expect(summary.recoveryToken).toBe(manifestIdentity.recoveryToken);
  expect(summary.recoveryToken).toBe(summary.manifestDigest);
}

function expectedReceipt(
  summary: TransactionSummary,
  phase: TerminalPhase,
): TransactionReceipt {
  return {
    transactionId: "campaign-1",
    manifestDigest: summary.manifestDigest,
    recoveryToken: summary.recoveryToken,
    phase,
    directorySync: "supported",
  };
}

function isObservedCampaignPhase(
  phase: TransactionSummary["phase"],
): phase is CrashPhase | TerminalPhase {
  return phase !== "begun";
}

describe("event-store recovery fault campaign", () => {
  // prettier-ignore
  it("recovers every selected execution boundary to its phase-determined exact pair", async () => {
    const old = await oldSeed();
    const oldPair: Pair = {
      events: old.files[eventsPath],
      snapshot: old.files[snapshotPath],
    };
    const baseline = storageFrom(old);
    const baselineServices = services(baseline);
    await expect(executeFourth(baseline)).resolves.toBeNull();
    const executionTrace = baseline.calls();
    const manifestIdentity = await campaignSummary(baselineServices);
    expectSummary(manifestIdentity, "committed");
    const newPair = pair(baseline);
    expect(selectedCounts(executionTrace)).toEqual(executionCounts);
    const executionBoundaries = boundaries(executionTrace);
    // Two directories deeper than `.brain/runs/<run>`, so the campaign reaches
    // four more mutating boundaries: the two additional parents are created and
    // synchronized. Nothing else about the publication changed.
    expect(executionBoundaries).toHaveLength(352);
    const phases = new Map<ExecutionPhase, number>();
    const directReceipts: string[] = [];

    for (const boundary of executionBoundaries) {
      const label = `${boundary.operation}:${boundary.timing}:${String(boundary.occurrence)}`;
      const phase = executionPhase(executionTrace, boundary);
      phases.set(phase, (phases.get(phase) ?? 0) + 1);
      const storage = storageFrom(old);
      storage.fail(boundary);
      const result = await executeFourth(storage);
      expect(storage.failureHits(), label).toEqual([boundary]);
      if (phase === "none") {
        expect(result, label).toEqual(
          new TransactionFailure("runtime.internal_failure", []),
        );
        expect(
          (await inspectManagedTransactions(services(storage))).filter(
            ({ transactionId }) => transactionId === "campaign-1",
          ),
          label,
        ).toEqual([]);
        expect(pair(storage), label).toEqual(oldPair);
        continue;
      }

      const transactionServices = services(storage);
      const summary = await campaignSummary(transactionServices);
      expectExecutionSummary(summary, phase, manifestIdentity);
      const terminal: TerminalPhase =
        phase === "begun" || phase === "prepared" ? "aborted" : "committed";
      if (result === null) {
        const directLabel = `${label}:${phase}`;
        expect(expectedDirectExecutionReceipts, label).toContain(directLabel);
        expect(summary.phase, label).toBe("committed");
        expect(pair(storage), label).toEqual(newPair);
        directReceipts.push(directLabel);
      } else {
        expect(result, label).toEqual(
          new TransactionFailure("runtime.recovery_required", [
            { kind: "artifact", ref: progressPath },
          ]),
        );
      }
      const first = await recoverManagedMutation(
        {
          transactionId: summary.transactionId,
          recoveryToken: summary.recoveryToken,
        },
        transactionServices,
      );
      const afterFirst = pair(storage);
      const second = await recoverManagedMutation(
        {
          transactionId: summary.transactionId,
          recoveryToken: summary.recoveryToken,
        },
        transactionServices,
      );
      expect(first, label).toEqual(expectedReceipt(summary, terminal));
      expect(second, label).toEqual(first);
      expect(pair(storage), label).toEqual(afterFirst);
      expect(afterFirst, label).toEqual(
        terminal === "aborted" ? oldPair : newPair,
      );
      const terminalSummary = await campaignSummary(transactionServices);
      if (phase === "begun") {
        expect(terminalSummary).toEqual({ ...summary, phase: "aborted" });
      } else {
        expectSummary(terminalSummary, terminal, summary);
      }
    }
    expect(Object.fromEntries(phases)).toEqual(executionPhaseCounts);
    expect(directReceipts).toEqual(expectedDirectExecutionReceipts);
  }, campaignTimeoutMilliseconds);

  // prettier-ignore
  it("recovers every selected durable boundary from prepared and publishing crash representatives", async () => {
    const old = await oldSeed();
    const oldPair: Pair = {
      events: old.files[eventsPath],
      snapshot: old.files[snapshotPath],
    };
    let totalBoundaries = 0;
    const directTerminalReceipts: string[] = [];

    for (const crashCase of crashCases) {
      const crashed = storageFrom(old);
      crashed.fail(crashCase.boundary);
      await expect(executeFourth(crashed)).resolves.toEqual(
        new TransactionFailure("runtime.recovery_required", [
          { kind: "artifact", ref: progressPath },
        ]),
      );
      expect(crashed.failureHits()).toEqual([crashCase.boundary]);
      const crashServices = services(crashed);
      const crashSummary = await campaignSummary(crashServices);
      expectSummary(crashSummary, crashCase.name);
      const repeated = storageFrom(old);
      repeated.fail(crashCase.boundary);
      await expect(executeFourth(repeated)).resolves.toEqual(
        new TransactionFailure("runtime.recovery_required", [
          { kind: "artifact", ref: progressPath },
        ]),
      );
      expect(repeated.failureHits()).toEqual([crashCase.boundary]);
      expect(await campaignSummary(services(repeated))).toEqual(crashSummary);
      const crashedSeed = crashed.snapshot();

      const successTrace = storageFrom(crashedSeed);
      const successServices = services(successTrace);
      expect(await campaignSummary(successServices)).toEqual(crashSummary);
      const recoveryStart = successTrace.calls().length;
      const success = await recoverManagedMutation(
        {
          transactionId: crashSummary.transactionId,
          recoveryToken: crashSummary.recoveryToken,
        },
        successServices,
      );
      expect(success).toEqual(
        expectedReceipt(crashSummary, crashCase.terminal),
      );
      const recoveryTrace = successTrace.calls().slice(recoveryStart);
      expect(selectedCounts(recoveryTrace)).toEqual(crashCase.recoveryCounts);
      const recoveryBoundaries = boundaries(recoveryTrace);
      totalBoundaries += recoveryBoundaries.length;
      expect(recoveryBoundaries).toHaveLength(
        2 *
          Object.values(crashCase.recoveryCounts).reduce(
            (total, count) => total + count,
            0,
          ),
      );

      for (const boundary of recoveryBoundaries) {
        const label = `${crashCase.name}:${boundary.operation}:${boundary.timing}:${String(boundary.occurrence)}`;
        const storage = storageFrom(crashedSeed);
        storage.fail(boundary);
        const transactionServices = services(storage);
        let result: TransactionReceipt | undefined;
        let failure: unknown;
        try {
          result = await recoverManagedMutation(
            {
              transactionId: crashSummary.transactionId,
              recoveryToken: crashSummary.recoveryToken,
            },
            transactionServices,
          );
        } catch (error) {
          failure = error;
        }
        expect(storage.failureHits(), label).toEqual([boundary]);
        const current = await campaignSummary(transactionServices);
        if (!isObservedCampaignPhase(current.phase)) {
          throw new Error("recovery returned to begun");
        }
        expectSummary(current, current.phase, crashSummary);

        if (result !== undefined) {
          expect(["aborted", "committed"], label).toContain(current.phase);
          const phase = current.phase as TerminalPhase;
          expect(result, label).toEqual(expectedReceipt(crashSummary, phase));
          expect(pair(storage), label).toEqual(
            phase === "aborted" ? oldPair : pair(successTrace),
          );
          const directLabel = `${label}:${phase}`;
          expect(expectedDirectTerminalReceipts, label).toContain(directLabel);
          directTerminalReceipts.push(directLabel);
        } else {
          expect(failure, label).toEqual(
            new TransactionFailure("runtime.recovery_required", [
              { kind: "artifact", ref: progressPath },
            ]),
          );
        }

        const first = await recoverManagedMutation(
          {
            transactionId: crashSummary.transactionId,
            recoveryToken: crashSummary.recoveryToken,
          },
          transactionServices,
        );
        const afterFirst = pair(storage);
        const second = await recoverManagedMutation(
          {
            transactionId: crashSummary.transactionId,
            recoveryToken: crashSummary.recoveryToken,
          },
          transactionServices,
        );
        expect(first, label).toEqual(
          expectedReceipt(crashSummary, crashCase.terminal),
        );
        expect(second, label).toEqual(first);
        expect(pair(storage), label).toEqual(afterFirst);
        expect(afterFirst, label).toEqual(
          crashCase.terminal === "aborted" ? oldPair : pair(successTrace),
        );
        const terminal = await campaignSummary(transactionServices);
        expectSummary(terminal, crashCase.terminal, crashSummary);
      }
    }
    expect(totalBoundaries).toBe(352);
    expect(348 + totalBoundaries).toBe(700);
    expect(directTerminalReceipts).toEqual(expectedDirectTerminalReceipts);
  }, campaignTimeoutMilliseconds);
});
