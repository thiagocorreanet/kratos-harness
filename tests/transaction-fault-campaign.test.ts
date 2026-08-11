import {
  executeManagedMutation,
  inspectManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  type TransactionReceipt,
  type TransactionServices,
} from "@mestre-yoda/runtime/composition";
import {
  renderResultHuman,
  renderResultJson,
  transactionFailureResult,
} from "@mestre-yoda/runtime/domain/result";
import type { ManagedMutationPlan } from "@mestre-yoda/runtime/domain/transactions";
import {
  fixedClock,
  memoryTransactionStorage,
  sequentialIds,
  type DurableOperation,
} from "@mestre-yoda/runtime/infra/fake";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { describe, expect, it } from "vitest";

const campaignTimeoutMilliseconds = 30_000;

function services(
  storage: ReturnType<typeof memoryTransactionStorage>,
): TransactionServices {
  return {
    clock: fixedClock("2026-08-09T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

function campaignStorage(): ReturnType<typeof memoryTransactionStorage> {
  return memoryTransactionStorage({
    directories: [".brain/transactions"],
    files: {
      ".brain/a.json": "a1",
      ".brain/delete.json": "delete",
    },
  });
}

function campaignPlan(
  storage: ReturnType<typeof memoryTransactionStorage>,
): ManagedMutationPlan {
  const file = (content: string) => ({
    kind: "file" as const,
    size: new TextEncoder().encode(content).byteLength,
    sha256: storage.digests.sha256(content),
  });
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/a.json",
        expected: file("a1"),
        result: file("a2"),
        stagedPath: "staging/operation-0001.payload",
        content: "a2",
      },
      {
        operationId: "operation-0002",
        kind: "write_file",
        path: ".brain/b.json",
        expected: { kind: "missing" },
        result: file("b1"),
        stagedPath: "staging/operation-0002.payload",
        content: "b1",
      },
      {
        operationId: "operation-0003",
        kind: "delete_file",
        path: ".brain/delete.json",
        expected: file("delete"),
        result: { kind: "missing" },
        stagedPath: null,
      },
    ],
  };
}

const durableOperations: readonly DurableOperation[] = [
  "inspect",
  "list",
  "read_text",
  "create_directory",
  "create_directory_exclusive",
  "open_file",
  "write_file",
  "sync_file",
  "close_file",
  "replace_file",
  "link_file_exclusive",
  "rename_directory_exclusive",
  "remove_file",
  "remove_empty_directory",
  "sync_directory",
];

const expectedOperationCounts: Readonly<Record<DurableOperation, number>> = {
  inspect: 38,
  list: 3,
  read_text: 0,
  create_directory: 1,
  create_directory_exclusive: 1,
  open_file: 10,
  write_file: 10,
  sync_file: 10,
  close_file: 10,
  replace_file: 9,
  link_file_exclusive: 0,
  rename_directory_exclusive: 0,
  remove_file: 1,
  remove_empty_directory: 1,
  sync_directory: 16,
};

function operationCounts(
  calls: readonly DurableOperation[],
): Readonly<Record<DurableOperation, number>> {
  return Object.fromEntries(
    durableOperations.map((operation) => [
      operation,
      calls.filter((candidate) => candidate === operation).length,
    ]),
  ) as Readonly<Record<DurableOperation, number>>;
}

interface MatrixEntry {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
  readonly expectedPhase:
    "begun" | "prepared" | "publishing" | "committed" | null;
}

function enumerateMatrix(calls: readonly DurableOperation[]): MatrixEntry[] {
  const occurrences = new Map<DurableOperation, number>();
  let durablePhase: MatrixEntry["expectedPhase"] = null;
  const entries: MatrixEntry[] = [];
  for (const operation of calls) {
    const occurrence = (occurrences.get(operation) ?? 0) + 1;
    occurrences.set(operation, occurrence);
    entries.push({
      operation,
      timing: "before",
      occurrence,
      expectedPhase: durablePhase,
    });
    if (operation === "replace_file") {
      if (occurrence === 1) durablePhase = "begun";
      if (occurrence === 2) durablePhase = "prepared";
      if (occurrence === 3) durablePhase = "publishing";
      if (occurrence === 9) durablePhase = "committed";
    }
    entries.push({
      operation,
      timing: "after",
      occurrence,
      expectedPhase: durablePhase,
    });
  }
  return entries;
}

async function executeCapturing(
  storage: ReturnType<typeof memoryTransactionStorage>,
  plan: ManagedMutationPlan = campaignPlan(storage),
): Promise<
  | { readonly kind: "receipt"; readonly receipt: TransactionReceipt }
  | { readonly kind: "failure"; readonly failure: unknown }
> {
  try {
    return {
      kind: "receipt",
      receipt: await executeManagedMutation(
        plan,
        { rootMode: "existing" },
        services(storage),
      ),
    };
  } catch (failure) {
    return { kind: "failure", failure };
  }
}

function expectTerminalDestinations(
  storage: ReturnType<typeof memoryTransactionStorage>,
  terminal: "committed" | "aborted",
  manifestBound: boolean,
): void {
  const snapshot = storage.snapshot();
  expect(snapshot.files[".brain/a.json"]).toBe(
    terminal === "committed" ? "a2" : "a1",
  );
  if (terminal === "committed") {
    expect(snapshot.files[".brain/b.json"]).toBe("b1");
    expect(snapshot.files).not.toHaveProperty(".brain/delete.json");
  } else {
    expect(snapshot.files).not.toHaveProperty(".brain/b.json");
    expect(snapshot.files[".brain/delete.json"]).toBe("delete");
  }
  expect(
    Object.keys(snapshot.files).filter((path) => path.endsWith(".payload")),
  ).toEqual([]);
  expect(
    snapshot.directories.filter((path) => path.endsWith("/staging")),
  ).toEqual([]);
  const receiptRoot = ".brain/transactions/transaction-1";
  expect(
    Object.keys(snapshot.files)
      .filter((path) => path.startsWith(`${receiptRoot}/`))
      .map((path) => path.slice(receiptRoot.length + 1))
      .sort((left, right) => left.localeCompare(right, "en-US")),
  ).toEqual(
    manifestBound ? ["manifest.json", "progress.json"] : ["progress.json"],
  );
  expect(
    snapshot.directories.filter((path) => path.startsWith(`${receiptRoot}/`)),
  ).toEqual([]);
}

describe("transaction fault campaign", () => {
  it("records every durable operation occurrence reached by the campaign plan", async () => {
    const storage = campaignStorage();

    await executeManagedMutation(
      campaignPlan(storage),
      { rootMode: "existing" },
      services(storage),
    );

    expect(operationCounts(storage.calls())).toEqual(expectedOperationCounts);
    expect(enumerateMatrix(storage.calls())).toHaveLength(220);
  });

  // prettier-ignore
  it("recovers idempotently at every reached before and after boundary", async () => {
    const baseline = campaignStorage();
    await executeManagedMutation(
      campaignPlan(baseline),
      { rootMode: "existing" },
      services(baseline),
    );
    const matrix = enumerateMatrix(baseline.calls());

    for (const entry of matrix) {
      const label = `${entry.operation}:${entry.timing}:${String(entry.occurrence)}`;
      const storage = campaignStorage();
      storage.fail(entry);
      const injected = services(storage);
      const execution = await executeCapturing(storage);
      expect(storage.failureHits(), label).toEqual([entry]);
      let summaries;
      try {
        summaries = await inspectManagedTransactions(injected);
      } catch (error) {
        throw new Error(`inspection failed for ${label}`, { cause: error });
      }

      if (entry.expectedPhase === null) {
        expect(execution, label).toEqual({
          kind: "failure",
          failure: new TransactionFailure("runtime.internal_failure", []),
        });
        expect(summaries, label).toEqual([]);
        expect(storage.snapshot().files[".brain/a.json"], label).toBe("a1");
        expect(storage.snapshot().files).not.toHaveProperty(".brain/b.json");
        expect(storage.snapshot().files[".brain/delete.json"], label).toBe(
          "delete",
        );
        continue;
      }

      expect(summaries, label).toHaveLength(1);
      const summary = summaries[0];
      expect(summary, label).toEqual({
        transactionId: "transaction-1",
        manifestDigest: summary?.manifestDigest ?? null,
        recoveryToken: summary?.recoveryToken,
        phase: entry.expectedPhase,
        evidenceRef: ".brain/transactions/transaction-1/progress.json",
      });
      if (execution.kind === "failure") {
        expect(execution.failure, label).toEqual(
          new TransactionFailure("runtime.recovery_required", [
            {
              kind: "artifact",
              ref: ".brain/transactions/transaction-1/progress.json",
            },
          ]),
        );
      } else {
        expect(entry.expectedPhase, label).toBe("committed");
      }

      const request = {
        transactionId: summary?.transactionId ?? "missing",
        recoveryToken: summary?.recoveryToken ?? "missing",
      };
      const firstRecovery = await recoverManagedMutation(request, injected);
      const secondRecovery = await recoverManagedMutation(request, injected);
      const terminal =
        entry.expectedPhase === "publishing" ||
        entry.expectedPhase === "committed"
          ? "committed"
          : "aborted";
      expect(firstRecovery, label).toEqual({
        transactionId: "transaction-1",
        manifestDigest: summary?.manifestDigest ?? null,
        recoveryToken: summary?.recoveryToken,
        phase: terminal,
        directorySync: "supported",
      });
      expect(secondRecovery, label).toEqual(firstRecovery);
      if (execution.kind === "receipt") {
        expect(execution.receipt, label).toEqual(firstRecovery);
      }
      expect(await inspectManagedTransactions(injected), label).toEqual([
        {
          ...summary,
          phase: terminal,
        },
      ]);
      expectTerminalDestinations(
        storage,
        terminal,
        firstRecovery.manifestDigest !== null,
      );
    }
  }, campaignTimeoutMilliseconds);

  it.each(["permission", "disk_full"] as const)(
    "maps a synthetic %s fault without leaking private transaction data",
    async (fault) => {
      const storage = campaignStorage();
      storage.fail({
        operation: "write_file",
        timing: "before",
        occurrence: 2,
        fault,
      });
      const injected = services(storage);
      const firstPrivatePayload = "PRIVATE_STAGING_PAYLOAD_ALPHA_9375";
      const secondPrivatePayload = "PRIVATE_STAGING_PAYLOAD_BETA_4826";
      const plan = campaignPlan(storage);
      const [first, second, third] = plan.operations;
      if (
        first?.kind !== "write_file" ||
        second?.kind !== "write_file" ||
        third === undefined
      ) {
        throw new Error("campaign plan is incomplete");
      }
      const privatePlan: ManagedMutationPlan = {
        operations: [
          {
            ...first,
            content: firstPrivatePayload,
            result: {
              kind: "file",
              size: firstPrivatePayload.length,
              sha256: storage.digests.sha256(firstPrivatePayload),
            },
          },
          {
            ...second,
            content: secondPrivatePayload,
            result: {
              kind: "file",
              size: secondPrivatePayload.length,
              sha256: storage.digests.sha256(secondPrivatePayload),
            },
          },
          third,
        ],
      };

      const execution = await executeCapturing(storage, privatePlan);
      expect(execution.kind).toBe("failure");
      if (execution.kind !== "failure") throw new Error("fault was not raised");
      expect(execution.failure).toBeInstanceOf(TransactionFailure);
      (execution.failure as TransactionFailure).message =
        `/home/private/project ${firstPrivatePayload} ${fault}`;
      const result = transactionFailureResult(
        execution.failure as TransactionFailure,
      );
      const json = renderResultJson(result);
      const human = renderResultHuman(result);
      const [summary] = await inspectManagedTransactions(injected);
      const receipt = await recoverManagedMutation(
        {
          transactionId: summary?.transactionId ?? "missing",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      );
      const publicArtifacts = JSON.stringify({ json, human, receipt });

      expect(result).toMatchObject({
        status: "blocked",
        reasonCode: "runtime.recovery_required",
        stateChanged: false,
        retryable: true,
      });
      expect(receipt).toEqual({
        transactionId: "transaction-1",
        manifestDigest: null,
        recoveryToken: summary?.recoveryToken,
        phase: "aborted",
        directorySync: "supported",
      });
      for (const privateValue of [
        fault,
        firstPrivatePayload,
        secondPrivatePayload,
        "/home/private/project",
        ".payload",
      ]) {
        expect(publicArtifacts).not.toContain(privateValue);
      }
    },
  );
});
