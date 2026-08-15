import {
  createLocks,
  executeManagedMutation,
  prepareLeaseGuard,
  type TransactionServices,
} from "@kratos/runtime/composition";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import type {
  LeaseGuard,
  LeaseResource,
} from "@kratos/runtime/domain/locks";
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

const handshakeTimeoutMilliseconds = 10_000;
const observedIdentity = { host: "codex", model: null } as const;

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

/**
 * One worker's services.
 *
 * Time is supplied per command rather than read from the host clock: a
 * contention test that had to sleep through a real thirty-second lease would
 * trade determinism for wall time and still prove less.
 */
function services(
  root: string,
  now: string,
  idPrefix: string,
  barrier: Barrier | null,
): TransactionServices {
  const occurrences = new Map<DurableOperation, number>();
  let sequence = 0;
  return {
    clock: { now: () => new Date(now) },
    ids: {
      next: () => {
        sequence += 1;
        return `${idPrefix}-${String(sequence)}`;
      },
    },
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

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid worker payload");
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid worker payload");
  return value;
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("Invalid worker payload");
  return value;
}

async function main(): Promise<void> {
  const [command, root, barrierEncoded, payloadEncoded] = process.argv.slice(2);
  if (
    command === undefined ||
    root === undefined ||
    barrierEncoded === undefined ||
    payloadEncoded === undefined
  ) {
    throw new Error("Invalid worker arguments");
  }
  const barrier = parseBarrier(barrierEncoded);
  const payload = requireRecord(JSON.parse(payloadEncoded));
  await send({ kind: "ready" });
  await waitForStart();

  const lockServices = services(
    root,
    requireString(payload.now),
    requireString(payload.idPrefix),
    barrier,
  );
  const locks = createLocks(lockServices);
  const guard = payload.guard as LeaseGuard | undefined;

  let result: unknown;
  switch (command) {
    case "inspect":
      result = await locks.inspect(payload.resource as LeaseResource);
      break;
    case "acquire":
      result = await locks.acquire({
        resource: payload.resource as LeaseResource,
        owner: requireString(payload.owner),
        ttlMs: requireNumber(payload.ttlMs),
        stateRevision: requireNumber(payload.stateRevision),
        observedIdentity,
      });
      break;
    case "renew":
      if (guard === undefined) throw new Error("Invalid worker payload");
      result = await locks.renew({
        observed: guard,
        ttlMs: requireNumber(payload.ttlMs),
        resultingStateRevision: requireNumber(payload.resultingStateRevision),
        observedIdentity,
      });
      break;
    case "takeover":
      if (guard === undefined) throw new Error("Invalid worker payload");
      result = await locks.takeover({
        observed: guard,
        owner: requireString(payload.owner),
        ttlMs: requireNumber(payload.ttlMs),
        stateRevision: requireNumber(payload.stateRevision),
        observedIdentity,
      });
      break;
    case "commit": {
      if (guard === undefined) throw new Error("Invalid worker payload");
      const content = requireString(payload.content);
      try {
        const binding = await prepareLeaseGuard(
          {
            observed: guard,
            ttlMs: requireNumber(payload.ttlMs),
            resultingStateRevision: guard.stateRevision + 1,
            observedIdentity,
          },
          lockServices,
        );
        await executeManagedMutation(
          {
            operations: [
              {
                operationId: "operation-0001",
                kind: "write_file",
                path: requireString(payload.destination),
                expected: { kind: "missing" },
                result: {
                  kind: "file",
                  size: Buffer.byteLength(content, "utf8"),
                  sha256: lockServices.digests.sha256(content),
                },
                stagedPath: "staging/operation-0001.payload",
                content,
              },
            ],
          },
          { rootMode: "existing", leaseGuard: binding },
          lockServices,
        );
        result = { kind: "committed" };
      } catch (failure) {
        result = {
          kind: "refused",
          reasonCode:
            failure instanceof Error && "reasonCode" in failure
              ? String((failure as { readonly reasonCode: unknown }).reasonCode)
              : "untyped",
        };
      }
      break;
    }
    default:
      throw new Error("Invalid worker command");
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
