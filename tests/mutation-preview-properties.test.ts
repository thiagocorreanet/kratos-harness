import {
  applyPlan,
  createRuntime,
  previewPlan,
  readOnlyPorts,
  type MutationPreview,
} from "@mestre-yoda/runtime/composition";
import { planOf, type EffectPlan } from "@mestre-yoda/runtime/domain/effects";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

function fakeRuntime() {
  const storage = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
    files: { ".brain/state.json": "old", ".brain/doomed.json": "doomed" },
  });
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

/**
 * Plans chosen to reach every normalization rule the preview inherits: an
 * overwrite, a fresh write, a delete, a write under a directory that does not
 * exist yet, and a mix of all four in one plan.
 */
const corpus: readonly (readonly [string, EffectPlan])[] = [
  ["overwrite", planOf(write(".brain/state.json", "new"))],
  ["fresh write", planOf(write(".brain/added.json", "added"))],
  ["delete", planOf({ kind: "delete_file", path: ".brain/doomed.json" })],
  ["synthesized parent", planOf(write(".brain/runs/run-01/result.json", "r"))],
  [
    "mixed",
    planOf(
      write(".brain/state.json", "new"),
      write(".brain/runs/run-02/result.json", "r"),
      { kind: "delete_file", path: ".brain/doomed.json" },
    ),
  ],
];

function write(path: string, content: string) {
  return { kind: "write_file" as const, path, content };
}

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
    readonly operations: readonly {
      readonly operationId: string;
      readonly path: string;
    }[];
  };
}

describe("mutation preview properties", () => {
  it.each(corpus)(
    "previews %s identically twice against unchanged state",
    async (_label, plan) => {
      const subject = fakeRuntime();
      const guarded = readOnlyPorts(subject.ports);

      const first = await previewPlan(plan, guarded);
      const second = await previewPlan(plan, guarded);

      // A preview a person reads twice and sees differently is a preview they
      // stop reading.
      expect(second).toEqual(first);
    },
  );

  it.each(corpus)(
    "previews %s as the operations the commit records",
    async (_label, plan) => {
      const previewed = fakeRuntime();
      const committed = fakeRuntime();

      const preview = ready(
        await previewPlan(plan, readOnlyPorts(previewed.ports)),
      );
      await applyPlan(plan, committed.ports);

      const manifest = manifestOf(committed.storage);
      expect(preview.planDigest).toBe(manifest.planDigest);
      expect(
        preview.operations.map(({ operationId, path }) => ({
          operationId,
          path,
        })),
      ).toEqual(
        manifest.operations.map(({ operationId, path }) => ({
          operationId,
          path,
        })),
      );
    },
  );

  it("invalidates a preview whose destination moved", async () => {
    const subject = fakeRuntime();
    const plan = planOf(write(".brain/state.json", "new"));
    const preview = ready(
      await previewPlan(plan, readOnlyPorts(subject.ports)),
    );
    expect(preview.operations[0]?.expected).toMatchObject({ kind: "file" });

    // Another writer changes the destination the preview was decided against.
    await subject.ports.durableFileSystem.writeSynced(".brain/moved", "moved");
    await subject.ports.durableFileSystem.replaceFile(
      ".brain/moved",
      ".brain/state.json",
    );

    // An apply re-decides from current state, so without the preview in hand
    // it would quietly commit a different decision than the one shown. Passing
    // it back is what turns that substitution into a refusal.
    await expect(
      applyPlan(plan, subject.ports, {
        rootMode: "existing",
        expectPreview: preview,
      }),
    ).rejects.toMatchObject({
      reasonCode: "runtime.revision_conflict",
      evidence: [{ kind: "artifact", ref: ".brain/state.json" }],
    });
  });

  it("keeps an unchanged preview applicable", async () => {
    const subject = fakeRuntime();
    const plan = planOf(write(".brain/state.json", "new"));

    const preview = ready(
      await previewPlan(plan, readOnlyPorts(subject.ports)),
    );
    const outcome = await applyPlan(plan, subject.ports, {
      rootMode: "existing",
      expectPreview: preview,
    });

    expect(outcome).toEqual({ kind: "committed" });
    expect(manifestOf(subject.storage).planDigest).toBe(preview.planDigest);
    expect(subject.storage.snapshot().files[".brain/state.json"]).toBe("new");
  });
});
