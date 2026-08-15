import { runCommandLine } from "@mestre-yoda/runtime/composition/cli";
import {
  fixedClock,
  fixedEnvironment,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import type { RuntimePorts } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

const ROOT = "/project";
const NOW = "2026-08-14T12:00:00.000Z";

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(files: Readonly<Record<string, string>>): Subject {
  const storage = memoryTransactionStorage({
    files,
    directories: [".brain", ".brain/transactions", ".brain/02-features"],
  });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("transaction"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({}),
      environment: fixedEnvironment({}, ROOT),
      output,
      standardInput: pipedInput(null),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

/**
 * The active-feature pointer is a plain line of text on disk, and the feature
 * name it carries is interpolated into every path the command touches. Nothing
 * between the file and that interpolation validates it, so these cases prove
 * the downstream managed-path rule is what actually holds, and that a rejected
 * pointer publishes nothing and says nothing about the bytes it rejected.
 */
describe("a hand-edited active-feature pointer", () => {
  const hostile: readonly (readonly [string, string])[] = [
    ["a traversing name", "../../../etc\n"],
    ["a parent segment", "..\n"],
    ["an absolute name", "/etc/passwd\n"],
    ["a drive-qualified name", "C:/Windows\n"],
    ["a backslash name", "..\\..\\etc\n"],
    ["a name reaching the lock namespace", "../../locks/project\n"],
    ["a name reaching the transaction namespace", "../../transactions\n"],
  ];

  it.each(hostile)(
    "refuses %s without writing anything",
    async (_label, active) => {
      const run = subject({ ".brain/02-features/active": active });
      const before = run.storage.snapshot();

      const exitCode = await runCommandLine(
        ["objective", "Ship the export pipeline"],
        run.ports,
      );

      expect(exitCode).not.toBe(0);
      expect(run.storage.snapshot()).toEqual(before);
      expect(
        run.storage.calls().filter((operation) => operation === "write_file"),
      ).toEqual([]);
    },
  );

  it.each(hostile)(
    "never echoes %s on either stream",
    async (_label, active) => {
      const run = subject({ ".brain/02-features/active": active });

      await runCommandLine(
        ["objective", "Ship the export pipeline"],
        run.ports,
      );

      const published = [...run.output.structured_, ...run.output.human_].join(
        "\n",
      );
      expect(published).not.toContain(active.trim());
      expect(published).not.toContain("passwd");
      expect(published).not.toContain("Windows");
      expect(published).not.toContain("etc");
      // Most of these reach the managed-path rule as a raw refusal, so the
      // answer is a sanitized internal failure that names nothing at all. That
      // is safe but unhelpful: the caller is not told which file to fix. The
      // threat model records it rather than this test pretending otherwise.
      expect(published).toMatch(
        /(The operation stopped after an unexpected internal failure\.|\.brain\/02-features\/active)/u,
      );
    },
  );

  it("refuses a pointer naming an entry no feature name can produce", async () => {
    // The identity rule folds to `[a-z0-9-]`, so a pointer carrying anything
    // else was not written by this runtime.
    const run = subject({
      ".brain/02-features/active": "Feature With Spaces\n",
    });
    const before = run.storage.snapshot();

    expect(await runCommandLine(["objective", "Ship it"], run.ports)).not.toBe(
      0,
    );
    expect(run.storage.snapshot()).toEqual(before);
  });

  it("treats an empty pointer as nothing started", async () => {
    // An empty file is the initialized state, not a hostile one, so this is
    // the counter-case that keeps the rule above from being read as "any
    // unusual pointer fails".
    const run = subject({ ".brain/02-features/active": "" });

    expect(await runCommandLine(["objective", "Ship it"], run.ports)).toBe(0);
    expect(run.storage.snapshot().files[".brain/02-features/active"]).toBe(
      "ship-it\n",
    );
  });
});
