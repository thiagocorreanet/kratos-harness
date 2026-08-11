import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { SnapshotV1 } from "@mestre-yoda/contracts";
import {
  applyPlan,
  createRuntimeAt,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  type EventDraftV1,
  type EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import {
  fixedClock,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { nodeDurableFileSystem } from "@mestre-yoda/runtime/infra/node";
import type { DurableFileSystem } from "@mestre-yoda/runtime/ports";
import { describe, expect, it, type TestContext } from "vitest";

const runId = "run-01";
const eventsPath = `.brain/runs/${runId}/events.jsonl`;
const snapshotPath = `.brain/runs/${runId}/state.json`;
const execFileAsync = promisify(execFile);
const readOnlyUnsupported =
  process.platform === "win32" || process.geteuid?.() === 0;

function draft(index: number): EventDraftV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation: `sdd.step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [`.brain/features/feature-${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

const reducers: EventReducerRegistry<{ readonly step: string | null }> = {
  seed: { step: null },
  reducers: {
    "policy-01": (state, event) => ({ ...state, step: event.operation }),
  },
  materialize: (state, cursor): SnapshotV1 => {
    if (cursor.hash === null) throw new Error("missing event hash");
    return {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      projectId: "project-01",
      runId,
      status: "active",
      currentStep: state.step,
      eventCursor: cursor.revision,
      eventHash: cursor.hash,
      policyVersion: "policy-01",
      lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: `2026-08-10T00:0${String(cursor.revision)}:00Z`,
    };
  },
};

async function temporaryProject<T>(
  body: (root: string, outside: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "yoda-node-event-store-"));
  const outside = await mkdtemp(
    join(tmpdir(), "yoda-node-event-store-outside-"),
  );
  try {
    return await body(root, outside);
  } finally {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      rm(outside, { force: true, recursive: true }),
    ]);
  }
}

function runtime(
  root: string,
  prefix: string,
  durableFileSystem?: DurableFileSystem,
) {
  return createRuntimeAt(root, {
    clock: fixedClock("2026-08-10T00:00:00.000Z"),
    ids: sequentialIds(prefix),
    output: recordingOutput(),
    ...(durableFileSystem === undefined ? {} : { durableFileSystem }),
  });
}

function countingDurableFileSystem(root: string): {
  readonly calls: readonly string[];
  readonly durableFileSystem: DurableFileSystem;
} {
  const actual = nodeDurableFileSystem(root);
  const calls: string[] = [];
  return {
    calls,
    durableFileSystem: {
      inspect: async (path) => {
        calls.push("inspect");
        return actual.inspect(path);
      },
      list: async (path) => {
        calls.push("list");
        return actual.list(path);
      },
      readText: async (path) => {
        calls.push("read_text");
        return actual.readText(path);
      },
      createDirectory: async (path) => {
        calls.push("create_directory");
        return actual.createDirectory(path);
      },
      createDirectoryExclusive: async (path) => {
        calls.push("create_directory_exclusive");
        return actual.createDirectoryExclusive(path);
      },
      writeSynced: async (path, content) => {
        calls.push("write_file");
        return actual.writeSynced(path, content);
      },
      replaceFile: async (stagedPath, targetPath) => {
        calls.push("replace_file");
        return actual.replaceFile(stagedPath, targetPath);
      },
      linkFileExclusive: async (sourcePath, targetPath) => {
        calls.push("link_file_exclusive");
        return actual.linkFileExclusive(sourcePath, targetPath);
      },
      removeFile: async (path) => {
        calls.push("remove_file");
        return actual.removeFile(path);
      },
      removeEmptyDirectory: async (path) => {
        calls.push("remove_empty_directory");
        return actual.removeEmptyDirectory(path);
      },
      syncDirectory: async (path) => {
        calls.push("sync_directory");
        return actual.syncDirectory(path);
      },
    },
  };
}

async function append(
  root: string,
  prefix: string,
  index: number,
  selectedRunId = runId,
) {
  return applyPlan(
    planOf({ kind: "append_event", runId: selectedRunId, event: draft(index) }),
    runtime(root, prefix),
    {
      rootMode: "existing",
      eventReducers: reducers,
    },
  );
}

async function projectScaffold(root: string): Promise<void> {
  await mkdir(join(root, ".brain/transactions"), { recursive: true });
}

function expectRefusal(value: Promise<unknown>) {
  return expect(value).rejects.toBeInstanceOf(TransactionFailure);
}

function unsupportedSymlink(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "EACCES" ||
      error.code === "EPERM" ||
      error.code === "ENOTSUP")
  );
}

async function assertEscapingSymlinkRefusal(
  context: TestContext,
  name: "events.jsonl" | "state.json",
): Promise<void> {
  const symlinkResult = await temporaryProject(async (root, outside) => {
    await projectScaffold(root);
    const run = join(root, ".brain/runs/run-01");
    const target = join(outside, name);
    await mkdir(run, { recursive: true });
    await writeFile(target, "outside sentinel", "utf8");
    try {
      await symlink(target, join(run, name));
    } catch (error) {
      if (unsupportedSymlink(error))
        return { supported: false as const, error };
      throw error;
    }
    await expectRefusal(append(root, "symlink", 1));
    expect(await readFile(target, "utf8")).toBe("outside sentinel");
    return { supported: true as const };
  });
  if (!symlinkResult.supported) {
    context.skip(
      `symlink unsupported by this filesystem: ${String(symlinkResult.error)}`,
    );
  }
}

describe("node event store", () => {
  it("replays across a fresh composition and extends a durable stream", async () => {
    await temporaryProject(async (root) => {
      await projectScaffold(root);
      const firstRuntime = runtime(root, "first");
      for (const index of [1, 2]) {
        await applyPlan(
          planOf({ kind: "append_event", runId, event: draft(index) }),
          firstRuntime,
          { rootMode: "existing", eventReducers: reducers },
        );
      }
      const beforeRestart = await readFile(join(root, eventsPath), "utf8");

      await append(root, "restart", 3);

      const events = await readFile(join(root, eventsPath), "utf8");
      const snapshot = JSON.parse(
        await readFile(join(root, snapshotPath), "utf8"),
      ) as SnapshotV1;
      expect(events.startsWith(beforeRestart)).toBe(true);
      expect(events.split("\n")).toHaveLength(4);
      expect(snapshot.eventCursor).toBe(3);
      expect(snapshot.currentStep).toBe("sdd.step-3");
    });
  });

  it("refuses an escaping stream symlink without outside writes", async (context: TestContext) => {
    await assertEscapingSymlinkRefusal(context, "events.jsonl");
  });

  it("refuses an escaping snapshot symlink without outside writes", async (context: TestContext) => {
    await assertEscapingSymlinkRefusal(context, "state.json");
  });

  it("refuses a case-colliding run directory without creating the requested spelling", async () => {
    await temporaryProject(async (root) => {
      await projectScaffold(root);
      await mkdir(join(root, ".brain/runs/RUN-01"), { recursive: true });

      await expectRefusal(append(root, "case", 1));
      await expect(readFile(join(root, eventsPath), "utf8")).rejects.toThrow();
    });
  });

  it("refuses a Unicode run identifier before durable filesystem access", async () => {
    await temporaryProject(async (root) => {
      await projectScaffold(root);
      const counted = countingDurableFileSystem(root);

      await expectRefusal(
        applyPlan(
          planOf({ kind: "append_event", runId: "run-é", event: draft(1) }),
          runtime(root, "unicode", counted.durableFileSystem),
          { rootMode: "existing", eventReducers: reducers },
        ),
      );
      expect(counted.calls).toEqual([]);
    });
  });

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO event stream (mkfifo is unsupported on Windows)",
    async () => {
      await temporaryProject(async (root) => {
        await projectScaffold(root);
        const run = join(root, ".brain/runs/run-01");
        await mkdir(run, { recursive: true });
        await execFileAsync("mkfifo", [join(run, "events.jsonl")]);

        await expectRefusal(append(root, "fifo", 1));
      });
    },
  );

  it.skipIf(readOnlyUnsupported)(
    "refuses a read-only event-store directory (unsupported on Windows and ineffective as root)",
    async () => {
      await temporaryProject(async (root) => {
        await projectScaffold(root);
        const run = join(root, ".brain/runs/run-01");
        await mkdir(run, { recursive: true });
        await chmod(run, 0o500);
        try {
          await expectRefusal(append(root, "readonly", 1));
          await expect(
            readFile(join(root, eventsPath), "utf8"),
          ).rejects.toThrow();
        } finally {
          await chmod(run, 0o700);
        }
      });
    },
  );
});
