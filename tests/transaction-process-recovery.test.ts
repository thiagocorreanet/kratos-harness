import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManagedMutationPlan } from "@mestre-yoda/runtime/domain/transactions";
import type { DurableOperation } from "@mestre-yoda/runtime/infra/node";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const workerSource = join(
  repositoryRoot,
  "tests/fixtures/transactions/worker.ts",
);
const workerTimeoutMilliseconds = 10_000;
const privatePayloads = {
  first: "PRIVATE_PROCESS_PAYLOAD_ALPHA_19375",
  second: "PRIVATE_PROCESS_PAYLOAD_BETA_24826",
} as const;

interface Barrier {
  readonly name: string;
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
}

interface BoundaryCase extends Barrier {
  readonly observedPhase: "begun" | "prepared" | "publishing" | "committed";
  readonly terminalPhase: "aborted" | "committed";
}

const boundaries: readonly BoundaryCase[] = [
  {
    name: "begun",
    operation: "sync_directory",
    timing: "after",
    occurrence: 2,
    observedPhase: "begun",
    terminalPhase: "aborted",
  },
  {
    name: "final-staged-sync",
    operation: "sync_directory",
    timing: "after",
    occurrence: 5,
    observedPhase: "begun",
    terminalPhase: "aborted",
  },
  {
    name: "manifest-sync",
    operation: "sync_directory",
    timing: "after",
    occurrence: 6,
    observedPhase: "begun",
    terminalPhase: "aborted",
  },
  {
    name: "prepared",
    operation: "sync_directory",
    timing: "after",
    occurrence: 7,
    observedPhase: "prepared",
    terminalPhase: "aborted",
  },
  {
    name: "publishing",
    operation: "sync_directory",
    timing: "after",
    occurrence: 8,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "first-rename",
    operation: "replace_file",
    timing: "after",
    occurrence: 4,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "first-publication-directory-sync",
    operation: "sync_directory",
    timing: "after",
    occurrence: 9,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "second-rename",
    operation: "replace_file",
    timing: "after",
    occurrence: 6,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "second-publication-directory-sync",
    operation: "sync_directory",
    timing: "after",
    occurrence: 11,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "delete",
    operation: "remove_file",
    timing: "after",
    occurrence: 1,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "delete-directory-sync",
    operation: "sync_directory",
    timing: "after",
    occurrence: 13,
    observedPhase: "publishing",
    terminalPhase: "committed",
  },
  {
    name: "committed",
    operation: "sync_directory",
    timing: "after",
    occurrence: 15,
    observedPhase: "committed",
    terminalPhase: "committed",
  },
  {
    name: "cleanup",
    operation: "sync_directory",
    timing: "after",
    occurrence: 16,
    observedPhase: "committed",
    terminalPhase: "committed",
  },
];

interface WorkerMessage {
  readonly kind: "barrier" | "error" | "ready" | "result";
  readonly name?: string;
  readonly value?: unknown;
}

interface WorkerSession {
  readonly child: ChildProcess;
  readonly exit: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  readonly output: { stderr: string; stdout: string };
}

let bundleRoot = "";
let workerBundle = "";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function file(content: string) {
  return {
    kind: "file" as const,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

function processPlan(): ManagedMutationPlan {
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/a.json",
        expected: file("a1"),
        result: file(privatePayloads.first),
        stagedPath: "staging/operation-0001.payload",
        content: privatePayloads.first,
      },
      {
        operationId: "operation-0002",
        kind: "write_file",
        path: ".brain/b.json",
        expected: { kind: "missing" },
        result: file(privatePayloads.second),
        stagedPath: "staging/operation-0002.payload",
        content: privatePayloads.second,
      },
      {
        operationId: "operation-0003",
        kind: "delete_file",
        path: ".brain/delete.json",
        expected: file("delete"),
        result: { kind: "missing" },
        stagedPath: null,
      },
    ],
  };
}

function spawnWorker(args: readonly string[]): WorkerSession {
  const child = fork(workerBundle, [...args], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const output = { stderr: "", stdout: "" };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    output.stderr += chunk;
  });
  const exit = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return { child, exit, output };
}

async function waitForWorker(
  session: WorkerSession,
  expected: "barrier" | "result",
): Promise<WorkerMessage> {
  return new Promise<WorkerMessage>((resolve, reject) => {
    let ready = false;
    const timer = setTimeout(() => {
      finish(new Error(`Worker timed out before ${expected}`));
    }, workerTimeoutMilliseconds);
    const onError = (error: Error) => {
      finish(error);
    };
    const onExit = () => {
      finish(new Error(`Worker exited before ${expected}`));
    };
    const onMessage = (candidate: unknown) => {
      if (!isWorkerMessage(candidate)) {
        finish(new Error("Worker sent an invalid IPC message"));
        return;
      }
      if (!ready) {
        if (candidate.kind !== "ready") {
          finish(new Error("Worker skipped the ready handshake"));
          return;
        }
        ready = true;
        session.child.send({ kind: "start" }, (error) => {
          if (error !== null) finish(error);
        });
        return;
      }
      if (candidate.kind === "error") {
        finish(new Error("Worker reported a sanitized failure"));
        return;
      }
      if (candidate.kind === expected) finish(null, candidate);
    };
    function finish(error: Error | null, message?: WorkerMessage): void {
      clearTimeout(timer);
      session.child.off("error", onError);
      session.child.off("exit", onExit);
      session.child.off("message", onMessage);
      if (error !== null) reject(error);
      else if (message !== undefined) resolve(message);
    }
    session.child.on("error", onError);
    session.child.on("exit", onExit);
    session.child.on("message", onMessage);
  });
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  return ["barrier", "error", "ready", "result"].includes(String(value.kind));
}

async function forceTerminate(session: WorkerSession): Promise<void> {
  // Node maps kill() to forced process termination on Windows; POSIX uses an
  // explicit uncatchable signal so neither branch asks the worker to unwind.
  const killed =
    process.platform === "win32"
      ? session.child.kill()
      : session.child.kill("SIGKILL");
  expect(killed).toBe(true);
  const exited = await session.exit;
  if (process.platform !== "win32") {
    expect(exited).toEqual({ code: null, signal: "SIGKILL" });
  }
}

async function terminateIfRunning(session: WorkerSession): Promise<void> {
  if (session.child.exitCode !== null || session.child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") session.child.kill();
  else session.child.kill("SIGKILL");
  await session.exit;
}

async function runFreshWorker(
  mode: "inspect" | "recover",
  root: string,
  value: unknown,
): Promise<{ readonly message: WorkerMessage; readonly output: string }> {
  const session = spawnWorker([mode, root, "null", JSON.stringify(value)]);
  try {
    const message = await waitForWorker(session, "result");
    expect(await session.exit).toEqual({ code: 0, signal: null });
    return {
      message,
      output: `${session.output.stdout}${session.output.stderr}`,
    };
  } finally {
    await terminateIfRunning(session);
  }
}

async function temporaryProject<T>(
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "yoda-process-recovery-"));
  try {
    await mkdir(join(root, ".brain/transactions"), { recursive: true });
    await writeFile(join(root, ".brain/a.json"), "a1", "utf8");
    await writeFile(join(root, ".brain/delete.json"), "delete", "utf8");
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

beforeAll(async () => {
  bundleRoot = await mkdtemp(join(tmpdir(), "yoda-process-worker-"));
  workerBundle = join(bundleRoot, "transaction-worker.mjs");
  await build({
    bundle: true,
    entryPoints: [workerSource],
    format: "esm",
    logLevel: "silent",
    outfile: workerBundle,
    platform: "node",
    sourcemap: false,
    target: "node24",
  });
});

afterAll(async () => {
  if (bundleRoot !== "") {
    await rm(bundleRoot, { force: true, recursive: true });
  }
});

describe("transaction recovery after process termination", () => {
  it.each(boundaries)(
    "recovers after $name",
    async ({ observedPhase, terminalPhase, ...barrier }) => {
      await temporaryProject(async (root) => {
        const execution = spawnWorker([
          "execute",
          root,
          JSON.stringify(barrier),
          JSON.stringify(processPlan()),
        ]);
        try {
          const reached = await waitForWorker(execution, "barrier");
          expect(reached).toEqual({ kind: "barrier", name: barrier.name });
          await forceTerminate(execution);
        } finally {
          await terminateIfRunning(execution);
        }
        expect(execution.output).toEqual({ stderr: "", stdout: "" });

        const inspected = await runFreshWorker("inspect", root, null);
        expect(inspected.output).toBe("");
        const summaries = inspected.message.value as readonly {
          readonly evidenceRef: string;
          readonly manifestDigest: string | null;
          readonly phase: string;
          readonly recoveryToken: string;
          readonly transactionId: string;
        }[];
        expect(summaries).toHaveLength(1);
        const summary = summaries[0];
        expect(summary).toEqual({
          transactionId: "transaction-1",
          manifestDigest: summary?.manifestDigest ?? null,
          recoveryToken: summary?.recoveryToken,
          phase: observedPhase,
          evidenceRef: ".brain/transactions/transaction-1/progress.json",
        });

        const request = {
          transactionId: summary?.transactionId ?? "missing",
          recoveryToken: summary?.recoveryToken ?? "missing",
        };
        const first = await runFreshWorker("recover", root, request);
        const second = await runFreshWorker("recover", root, request);
        expect(first.output).toBe("");
        expect(second.output).toBe("");
        expect(first.message.value).toEqual({
          transactionId: "transaction-1",
          manifestDigest: summary?.manifestDigest ?? null,
          recoveryToken: summary?.recoveryToken,
          phase: terminalPhase,
          directorySync: "supported",
        });
        expect(second.message.value).toEqual(first.message.value);

        const finalA = await readFile(join(root, ".brain/a.json"), "utf8");
        expect(finalA).toBe(
          terminalPhase === "committed" ? privatePayloads.first : "a1",
        );
        if (terminalPhase === "committed") {
          await expect(
            readFile(join(root, ".brain/b.json"), "utf8"),
          ).resolves.toBe(privatePayloads.second);
          await expect(
            readFile(join(root, ".brain/delete.json"), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          await expect(
            readFile(join(root, ".brain/b.json"), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
          await expect(
            readFile(join(root, ".brain/delete.json"), "utf8"),
          ).resolves.toBe("delete");
        }

        const receiptRoot = join(root, ".brain/transactions/transaction-1");
        expect(await readdir(receiptRoot)).not.toContain("staging");
        const ipc = JSON.stringify({
          first: first.message,
          inspected: inspected.message,
          second: second.message,
        });
        expect(ipc).not.toContain(root);
        expect(ipc).not.toContain(privatePayloads.first);
        expect(ipc).not.toContain(privatePayloads.second);
      });
    },
  );
});
