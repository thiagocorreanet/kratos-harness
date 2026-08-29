import {
  inspectManagedTransactions,
  recoverManagedMutation,
  type TransactionServices,
} from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryFileSystem,
  memoryTransactionStorage,
  pipedInput,
  recordingOutput,
  sequentialIds,
  type DurableOperation,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

/** Room for the same campaign under coverage instrumentation. */
const campaignTimeoutMilliseconds = 180_000;

const ANSWERS = JSON.stringify({
  contractVersion: "1.2.0",
  hostContract: "1.2.0",
  hosts: ["claude", "codex"],
  language: {
    conversation: "en",
    documentation: "en",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  },
});

type Storage = ReturnType<typeof memoryTransactionStorage>;

interface Boundary {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
}

function ports(storage: Storage): RuntimePorts {
  return {
    clock: fixedClock("2026-08-14T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    fileSystem: memoryFileSystem({ "package.json": "{}" }),
    environment: fixedEnvironment({}, "/project"),
    modelRouting: fixedModelRouting([claudeCatalog(), codexCatalog()]),
    output: recordingOutput(),
    standardInput: pipedInput(ANSWERS),
  } as unknown as RuntimePorts;
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

/**
 * The operations that can leave a project half-written.
 *
 * A failed read cannot: it aborts before anything is published, which the
 * transaction contract already covers. Injecting faults into reads as well
 * triples the campaign for boundaries that cannot produce the state under
 * test.
 */
const MUTATING: readonly DurableOperation[] = [
  "create_directory",
  "create_directory_exclusive",
  "write_file",
  "sync_file",
  "replace_file",
  "link_file_exclusive",
  "rename_directory_exclusive",
  "remove_file",
  "remove_empty_directory",
  "sync_directory",
];

function enumerateBoundaries(calls: readonly DurableOperation[]): Boundary[] {
  const occurrences = new Map<DurableOperation, number>();
  const boundaries: Boundary[] = [];
  for (const operation of calls) {
    const occurrence = (occurrences.get(operation) ?? 0) + 1;
    occurrences.set(operation, occurrence);
    if (!MUTATING.includes(operation)) continue;
    boundaries.push(
      { operation, timing: "before", occurrence },
      { operation, timing: "after", occurrence },
    );
  }
  return boundaries;
}

function projectFiles(storage: Storage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(storage.snapshot().files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
}

describe("init fault campaign", () => {
  // prettier-ignore
  it("leaves a project untouched or fully initialized at every boundary", async () => {
    const baseline = memoryTransactionStorage({});
    expect(await runCommandLine(["init"], ports(baseline))).toBe(0);
    const complete = projectFiles(baseline);
    const boundaries = enumerateBoundaries(baseline.calls());

    // The campaign is only worth running if it reaches the operations that
    // publish the surface, so the count is asserted rather than assumed.
    expect(Object.keys(complete)).toHaveLength(28);
    expect(boundaries.length).toBeGreaterThan(100);

    for (const boundary of boundaries) {
      const label = `${boundary.operation}:${boundary.timing}:${String(boundary.occurrence)}`;
      const storage = memoryTransactionStorage({});
      storage.fail(boundary);

      await runCommandLine(["init"], ports(storage));

      const recovery = services(storage);
      for (const summary of await inspectManagedTransactions(recovery)) {
        await recoverManagedMutation(
          {
            transactionId: summary.transactionId,
            recoveryToken: summary.recoveryToken,
          },
          recovery,
        );
      }

      // Either the project was never touched or it holds the whole surface.
      // A project with a `.claude` the run created and a `CLAUDE.md` it never
      // published is the half-initialized state one transaction rules out.
      const observed = projectFiles(storage);
      const written = Object.keys(observed);
      if (written.length !== 0) {
        expect(observed, label).toEqual(complete);
      }
      expect(
        Object.keys(storage.snapshot().files).filter((path) =>
          path.endsWith(".payload"),
        ),
        label,
      ).toEqual([]);
    }
  }, campaignTimeoutMilliseconds);
});
