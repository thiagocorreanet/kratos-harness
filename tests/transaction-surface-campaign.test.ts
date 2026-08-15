import {
  applyPlan,
  createRuntime,
  inspectManagedTransactions,
  recoverManagedMutation,
  type TransactionServices,
} from "@kratos/runtime/composition";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { planOf } from "@kratos/runtime/domain/effects";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
  type DurableOperation,
} from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

/**
 * Enough room for the campaign under coverage instrumentation, which is where
 * a limit measured on an uninstrumented run turns into a false failure.
 */
const campaignTimeoutMilliseconds = 180_000;

type Storage = ReturnType<typeof memoryTransactionStorage>;

/** One destination per zone of the widened surface. */
const DESTINATIONS = {
  ".brain/config.json": '{ "language": "en" }\n',
  ".claude/settings.json": '{ "permissions": {} }\n',
  "CLAUDE.md": "# Managed\n",
} as const;

interface Boundary {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
}

function fixture(): Storage {
  return memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
  });
}

function ports(storage: Storage) {
  return createRuntime({
    clock: fixedClock("2026-08-14T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
    fileSystem: storage.fileSystem,
    output: recordingOutput(),
  });
}

function services(storage: Storage): TransactionServices {
  return {
    clock: fixedClock("2026-08-14T00:00:00.000Z"),
    ids: sequentialIds("recovery"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

function crossSurfacePlan() {
  return planOf(
    ...Object.entries(DESTINATIONS).map(
      ([path, content]) => ({ kind: "write_file", path, content }) as const,
    ),
  );
}

function enumerateBoundaries(calls: readonly DurableOperation[]): Boundary[] {
  const occurrences = new Map<DurableOperation, number>();
  const boundaries: Boundary[] = [];
  for (const operation of calls) {
    const occurrence = (occurrences.get(operation) ?? 0) + 1;
    occurrences.set(operation, occurrence);
    boundaries.push(
      { operation, timing: "before", occurrence },
      { operation, timing: "after", occurrence },
    );
  }
  return boundaries;
}

/**
 * The property the widened surface exists to preserve.
 *
 * Every destination is present with the bytes the plan named, or none of them
 * is. A project holding a `.claude` the plan created and a `CLAUDE.md` it never
 * published is exactly the half-initialized state one transaction rules out.
 */
function expectUntouchedOrComplete(storage: Storage, label: string): void {
  const snapshot = storage.snapshot();
  const written = Object.entries(DESTINATIONS).filter(
    ([path, content]) => snapshot.files[path] === content,
  );
  const present = Object.keys(DESTINATIONS).filter(
    (path) => snapshot.files[path] !== undefined,
  );

  expect(present, label).toEqual(written.map(([path]) => path));
  expect([0, Object.keys(DESTINATIONS).length], label).toContain(
    written.length,
  );
  // No staged payload and no staging directory survives either outcome.
  expect(
    Object.keys(snapshot.files).filter((path) => path.endsWith(".payload")),
    label,
  ).toEqual([]);
  expect(
    snapshot.directories.filter((path) => path.endsWith("/staging")),
    label,
  ).toEqual([]);
}

describe("fault campaign across the managed surface", () => {
  // prettier-ignore
  it("leaves a project untouched or complete at every durable boundary", async () => {
    const baseline = fixture();
    await applyPlan(crossSurfacePlan(), ports(baseline));
    expectUntouchedOrComplete(baseline, "baseline");
    const boundaries = enumerateBoundaries(baseline.calls());

    // The campaign is worth running only if it reaches the operations that
    // publish outside `.brain`, so the baseline count is asserted rather than
    // assumed.
    expect(boundaries.length).toBeGreaterThan(100);

    for (const boundary of boundaries) {
      const label = `${boundary.operation}:${boundary.timing}:${String(boundary.occurrence)}`;
      const storage = fixture();
      storage.fail(boundary);
      const recovery = services(storage);

      try {
        await applyPlan(crossSurfacePlan(), ports(storage));
      } catch {
        // A failure is one of the two outcomes under test; what it leaves
        // behind is the assertion.
      }

      for (const summary of await inspectManagedTransactions(recovery)) {
        await recoverManagedMutation(
          {
            transactionId: summary.transactionId,
            recoveryToken: summary.recoveryToken,
          },
          recovery,
        );
      }

      expectUntouchedOrComplete(storage, label);
    }
  }, campaignTimeoutMilliseconds);
});
