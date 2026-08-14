import {
  applyPlan,
  createRuntime,
  inspectManagedTransactions,
  previewPlan,
  readOnlyPorts,
  type MutationPreview,
} from "@mestre-yoda/runtime/composition";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

function fakeRuntime(
  seed: Parameters<typeof memoryTransactionStorage>[0] = {
    directories: [".brain", ".brain/transactions"],
    files: { ".brain/state.json": "old" },
  },
) {
  const storage = memoryTransactionStorage(seed);
  return {
    storage,
    ports: createRuntime({
      clock: fixedClock("2026-08-13T00:00:00.000Z"),
      ids: sequentialIds("transaction"),
      fileSystem: storage.fileSystem,
      durableFileSystem: storage.durableFileSystem,
      digests: storage.digests,
      output: recordingOutput(),
    }),
  };
}

const writePlan = planOf(
  { kind: "write_file", path: ".brain/state.json", content: "new" },
  { kind: "write_file", path: ".brain/added.json", content: "added" },
);

function ready(preview: MutationPreview) {
  if (preview.kind !== "ready") {
    throw new Error(`Expected a ready preview, got ${preview.kind}`);
  }
  return preview;
}

function manifestOf(storage: ReturnType<typeof memoryTransactionStorage>) {
  const text =
    storage.snapshot().files[".brain/transactions/transaction-1/manifest.json"];
  if (text === undefined) throw new Error("Expected a committed manifest");
  return JSON.parse(text) as {
    readonly planDigest: string;
    readonly operations: readonly { readonly path: string }[];
  };
}

describe("mutation preview", () => {
  it("previews the plan the commit submits", async () => {
    const previewed = fakeRuntime();
    const committed = fakeRuntime();

    const preview = ready(
      await previewPlan(writePlan, readOnlyPorts(previewed.ports)),
    );
    await applyPlan(writePlan, committed.ports);

    // The preview is not a description of the commit. It is the object the
    // commit consumes, so the digest it reports is the digest the manifest
    // records -- a person can compare the two without trusting either.
    const manifest = manifestOf(committed.storage);
    expect(preview.planDigest).toBe(manifest.planDigest);
    expect(preview.operations.map(({ path }) => path)).toEqual(
      manifest.operations.map(({ path }) => path),
    );
  });

  it("writes nothing while previewing", async () => {
    const subject = fakeRuntime();
    const before = subject.storage.snapshot();

    await previewPlan(writePlan, readOnlyPorts(subject.ports));

    expect(subject.storage.snapshot()).toEqual(before);
  });

  it("carries fingerprints rather than the bytes they describe", async () => {
    const subject = fakeRuntime();

    const preview = ready(
      await previewPlan(writePlan, readOnlyPorts(subject.ports)),
    );

    for (const operation of preview.operations) {
      expect(operation).not.toHaveProperty("content");
      expect(operation).not.toHaveProperty("stagedPath");
      expect(operation.expected).toBeDefined();
      expect(operation.result).toBeDefined();
    }
  });

  it("reports a plan that changes nothing as a no-op", async () => {
    const subject = fakeRuntime();

    const preview = await previewPlan(
      planOf({ kind: "write_file", path: ".brain/state.json", content: "old" }),
      readOnlyPorts(subject.ports),
    );

    // A decision that the requested state already holds is worth naming.
    expect(preview).toEqual({ kind: "noop" });
  });

  it("reports a blocked project without reconciling it", async () => {
    const subject = fakeRuntime();
    subject.storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(applyPlan(writePlan, subject.ports)).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    const pending = await inspectManagedTransactions(
      transactionServices(subject),
    );
    expect(pending.some(({ phase }) => phase !== "committed")).toBe(true);
    const residue = subject.storage.snapshot();

    const preview = await previewPlan(writePlan, readOnlyPorts(subject.ports));

    expect(preview).toMatchObject({ kind: "blocked" });
    // The real apply would clear unmarked residue on its way in. A preview
    // that did the same would be a read-only operation that mutates, and one
    // that skipped the check would promise a commit that cannot happen.
    expect(subject.storage.snapshot()).toEqual(residue);
  });
});

function transactionServices(subject: ReturnType<typeof fakeRuntime>) {
  return {
    clock: subject.ports.clock,
    ids: subject.ports.ids,
    digests: subject.ports.digests,
    durableFileSystem: subject.ports.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}
