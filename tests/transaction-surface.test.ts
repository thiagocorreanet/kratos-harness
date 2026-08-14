import {
  applyPlan,
  createRuntime,
  previewPlan,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

type Storage = ReturnType<typeof memoryTransactionStorage>;

function storage(): Storage {
  return memoryTransactionStorage({
    directories: [".brain", ".brain/transactions"],
  });
}

function ports(subject: Storage) {
  return createRuntime({
    clock: fixedClock("2026-08-14T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    durableFileSystem: subject.durableFileSystem,
    digests: subject.digests,
    fileSystem: subject.fileSystem,
    output: recordingOutput(),
  });
}

/** One plan spanning managed state, a host directory, and the project root. */
function initializationPlan() {
  return planOf(
    { kind: "write_file", path: ".brain/config.json", content: "{}\n" },
    {
      kind: "write_file",
      path: ".claude/settings.json",
      content: '{ "permissions": {} }\n',
    },
    { kind: "write_file", path: "CLAUDE.md", content: "# Managed\n" },
  );
}

describe("the managed surface under a real transaction", () => {
  it("commits state, a host directory, and a root file as one transaction", async () => {
    const subject = storage();

    const outcome = await applyPlan(initializationPlan(), ports(subject));

    expect(outcome.kind).toBe("committed");
    const files = subject.snapshot().files;
    expect(files[".brain/config.json"]).toBe("{}\n");
    expect(files[".claude/settings.json"]).toBe('{ "permissions": {} }\n');
    expect(files["CLAUDE.md"]).toBe("# Managed\n");
    // The host directory was created by the plan rather than required of the
    // project, the way every other missing parent is.
    expect(subject.snapshot().directories).toContain(".claude");
  });

  it("decides there is nothing to do the second time", async () => {
    const subject = storage();
    await applyPlan(initializationPlan(), ports(subject));

    // The proof that a root file participates in the same decision as managed
    // state: the whole plan collapses, not just the `.brain` part of it.
    expect(
      await previewPlan(initializationPlan(), ports(subject)),
    ).toMatchObject({ kind: "noop" });
    expect(await applyPlan(initializationPlan(), ports(subject))).toEqual({
      kind: "noop",
    });
  });

  it("still refuses a root file the inventory never named", async () => {
    const subject = storage();

    await expect(
      applyPlan(
        planOf({ kind: "write_file", path: "state.json", content: "{}" }),
        ports(subject),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ reasonCode: "guard.outside_allow" }),
    );
    expect(subject.snapshot().files["state.json"]).toBeUndefined();
  });

  it("refuses the reserved namespace through the widened surface", async () => {
    const subject = storage();

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/transactions/forged/manifest.json",
          content: "{}",
        }),
        ports(subject),
      ),
    ).rejects.toBeInstanceOf(TransactionFailure);
  });
});
