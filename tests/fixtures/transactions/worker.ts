import {
  executeManagedMutation,
  inspectManagedTransactions,
  recoverManagedMutation,
  type TransactionServices,
} from "@kratos/runtime/composition";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import type { ManagedMutationPlan } from "@kratos/runtime/domain/transactions";
import {
  nodeDurableFileSystem,
  sha256Digests,
  type DurableOperation,
  type DurableOperationEvent,
} from "@kratos/runtime/infra/node";

interface Barrier {
  readonly name: string;
  readonly operation: DurableOperation;
  readonly timing: DurableOperationEvent["timing"];
  readonly occurrence: number;
}

interface RecoveryRequest {
  readonly transactionId: string;
  readonly recoveryToken: string;
}

const handshakeTimeoutMilliseconds = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBarrier(encoded: string): Barrier | null {
  const value: unknown = JSON.parse(encoded);
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.operation !== "string" ||
    (value.timing !== "before" && value.timing !== "after") ||
    typeof value.occurrence !== "number" ||
    !Number.isInteger(value.occurrence) ||
    value.occurrence <= 0
  ) {
    throw new Error("Invalid worker barrier");
  }
  return value as unknown as Barrier;
}

function parseRecoveryRequest(value: unknown): RecoveryRequest {
  if (
    !isRecord(value) ||
    typeof value.transactionId !== "string" ||
    typeof value.recoveryToken !== "string"
  ) {
    throw new Error("Invalid worker recovery request");
  }
  return {
    transactionId: value.transactionId,
    recoveryToken: value.recoveryToken,
  };
}

async function send(message: unknown): Promise<void> {
  if (process.send === undefined) throw new Error("Worker IPC is unavailable");
  await new Promise<void>((resolve, reject) => {
    process.send?.(message, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

async function waitForStart(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error("Worker start handshake timed out"));
    }, handshakeTimeoutMilliseconds);
    const onDisconnect = () => {
      finish(new Error("Worker IPC disconnected"));
    };
    const onMessage = (message: unknown) => {
      if (isRecord(message) && message.kind === "start") finish(null);
      else finish(new Error("Worker received an invalid start message"));
    };
    function finish(error: Error | null): void {
      clearTimeout(timer);
      process.off("disconnect", onDisconnect);
      process.off("message", onMessage);
      if (error === null) resolve();
      else reject(error);
    }
    process.once("disconnect", onDisconnect);
    process.once("message", onMessage);
  });
}

function services(root: string, barrier: Barrier | null): TransactionServices {
  const occurrences = new Map<DurableOperation, number>();
  return {
    clock: { now: () => new Date("2026-08-09T00:00:00.000Z") },
    ids: { next: () => "transaction-1" },
    digests: sha256Digests(),
    durableFileSystem: nodeDurableFileSystem(root, async (event) => {
      let occurrence = occurrences.get(event.operation) ?? 0;
      if (event.timing === "before") {
        occurrence += 1;
        occurrences.set(event.operation, occurrence);
      }
      if (
        barrier !== null &&
        event.operation === barrier.operation &&
        event.timing === barrier.timing &&
        occurrence === barrier.occurrence
      ) {
        await send({ kind: "barrier", name: barrier.name });
        await new Promise<void>(() => undefined);
      }
    }),
    schemaRegistry: createSchemaRegistry(),
  };
}

async function main(): Promise<void> {
  const [mode, root, barrierEncoded, valueEncoded] = process.argv.slice(2);
  if (
    (mode !== "execute" && mode !== "inspect" && mode !== "recover") ||
    root === undefined ||
    barrierEncoded === undefined ||
    valueEncoded === undefined
  ) {
    throw new Error("Invalid worker arguments");
  }
  const barrier = parseBarrier(barrierEncoded);
  const value: unknown = JSON.parse(valueEncoded);
  await send({ kind: "ready" });
  await waitForStart();
  const transactionServices = services(root, barrier);

  let result: unknown;
  switch (mode) {
    case "execute":
      result = await executeManagedMutation(
        value as ManagedMutationPlan,
        { rootMode: "existing" },
        transactionServices,
      );
      break;
    case "inspect":
      result = await inspectManagedTransactions(transactionServices);
      break;
    case "recover":
      result = await recoverManagedMutation(
        parseRecoveryRequest(value),
        transactionServices,
      );
      break;
  }
  await send({ kind: "result", value: result });
}

void main().then(
  () => {
    process.disconnect?.();
  },
  async () => {
    await send({ kind: "error" }).catch(() => undefined);
    process.disconnect?.();
    process.exitCode = 1;
  },
);
