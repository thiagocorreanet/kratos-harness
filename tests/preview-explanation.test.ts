import {
  applyPlan,
  createRuntime,
  previewPlan,
  previewResult,
  readOnlyPorts,
} from "@mestre-yoda/runtime/composition";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  renderResultHuman,
  renderResultJson,
} from "@mestre-yoda/runtime/domain/result";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

const SENTINEL = "PRIVATE_PREVIEW_PAYLOAD_48211";

function fakeRuntime() {
  const storage = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
    files: { ".brain/state.json": "old" },
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

const secretPlan = planOf({
  kind: "write_file",
  path: ".brain/state.json",
  content: SENTINEL,
});

describe("preview explanation", () => {
  it("renders the digest of a secret and never the secret", async () => {
    const subject = fakeRuntime();
    const preview = await previewPlan(secretPlan, readOnlyPorts(subject.ports));

    const result = previewResult(preview);
    const json = renderResultJson(result).stdout;
    const human = renderResultHuman(result).stdout;

    // A preview is shown to a person, often on a shared screen. What changes
    // and to what is the useful part; the bytes about to be persisted are not.
    expect(json).not.toContain(SENTINEL);
    expect(human).not.toContain(SENTINEL);
    expect(json).toContain(subject.ports.digests.sha256(SENTINEL));
  });

  it("reports that nothing was published", async () => {
    const subject = fakeRuntime();
    const preview = await previewPlan(secretPlan, readOnlyPorts(subject.ports));

    const result = previewResult(preview);

    expect(result.stateChanged).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.why).toContain(
      "No effect was published; this is the decision, not its result.",
    );
  });

  it("names every destination once, sorted by path", async () => {
    const subject = fakeRuntime();
    const preview = await previewPlan(
      planOf(
        { kind: "write_file", path: ".brain/zulu.json", content: "z" },
        { kind: "write_file", path: ".brain/alpha.json", content: "a" },
      ),
      readOnlyPorts(subject.ports),
    );

    const result = previewResult(preview);

    // Two renderings of one decision have to be byte-identical, or a person
    // cannot compare the preview they read against the one in front of them.
    expect(result.evidence.map(({ ref }) => ref)).toEqual([
      ".brain/alpha.json",
      ".brain/zulu.json",
    ]);
    expect(renderResultJson(result).stdout).toBe(
      renderResultJson(previewResult(preview)).stdout,
    );
  });

  it("says so when the requested state already holds", async () => {
    const subject = fakeRuntime();
    const preview = await previewPlan(
      planOf({ kind: "write_file", path: ".brain/state.json", content: "old" }),
      readOnlyPorts(subject.ports),
    );

    const result = previewResult(preview);

    expect(result.summary).toBe(
      "The project already holds the requested state.",
    );
    expect(result.evidence).toEqual([]);
  });

  it("carries the blocked reason and the artifact to act on", async () => {
    const subject = fakeRuntime();
    subject.storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(applyPlan(secretPlan, subject.ports)).rejects.toThrow();

    const result = previewResult(
      await previewPlan(secretPlan, readOnlyPorts(subject.ports)),
    );

    expect(result.reasonCode).toBe("runtime.recovery_required");
    expect(result.stateChanged).toBe(false);
    expect(result.evidence[0]?.ref).toContain(".brain/transactions/");
  });
});
