import { fork, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { expect } from "vitest";

const repositoryRoot = join(import.meta.dirname, "../..");
const workerSource = join(repositoryRoot, "tests/fixtures/locks/worker.ts");
const workerTimeoutMilliseconds = 15_000;

export interface Barrier {
  readonly name: string;
  readonly operation: string;
  readonly timing: "before" | "after";
  readonly occurrence: number;
}

export interface WorkerMessage {
  readonly kind: "barrier" | "error" | "ready" | "result";
  readonly name?: string;
  readonly value?: unknown;
}

export interface WorkerSession {
  readonly child: ChildProcess;
  readonly exit: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  readonly output: { stderr: string; stdout: string };
}

let bundleRoot = "";
let workerBundle = "";

/** Bundle the worker once per test file, the way the transaction suite does. */
export async function bundleLockWorker(): Promise<void> {
  bundleRoot = await mkdtemp(join(tmpdir(), "yoda-lock-worker-"));
  workerBundle = join(bundleRoot, "lock-worker.mjs");
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
}

export async function disposeLockWorker(): Promise<void> {
  if (bundleRoot !== "") await rm(bundleRoot, { force: true, recursive: true });
  bundleRoot = "";
}

export function spawnWorker(
  command: string,
  root: string,
  payload: unknown,
  barrier: Barrier | null = null,
): WorkerSession {
  const child = fork(
    workerBundle,
    [command, root, JSON.stringify(barrier), JSON.stringify(payload)],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
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

export async function waitForWorker(
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

async function waitForExit(session: WorkerSession): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Worker timed out while exiting"));
    }, workerTimeoutMilliseconds);
    session.exit.then(
      (exit) => {
        clearTimeout(timer);
        resolve(exit);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function terminateIfRunning(
  session: WorkerSession,
): Promise<void> {
  if (session.child.exitCode !== null || session.child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") session.child.kill();
  else session.child.kill("SIGKILL");
  await waitForExit(session);
}

/**
 * Kill a paused worker the way a crash does.
 *
 * Node maps `kill()` to forced termination on Windows; POSIX uses an explicit
 * uncatchable signal, so neither branch asks the worker to unwind.
 */
export async function forceTerminate(session: WorkerSession): Promise<void> {
  const killed =
    process.platform === "win32"
      ? session.child.kill()
      : session.child.kill("SIGKILL");
  expect(killed).toBe(true);
  const exited = await waitForExit(session);
  if (process.platform !== "win32") {
    expect(exited).toEqual({ code: null, signal: "SIGKILL" });
  }
}

/** Run one worker command to completion and return what it reported. */
export async function runWorker(
  command: string,
  root: string,
  payload: unknown,
): Promise<{ readonly value: unknown; readonly output: string }> {
  const session = spawnWorker(command, root, payload);
  try {
    const message = await waitForWorker(session, "result");
    expect(await waitForExit(session)).toEqual({ code: 0, signal: null });
    return {
      value: message.value,
      output: `${session.output.stdout}${session.output.stderr}`,
    };
  } finally {
    await terminateIfRunning(session);
  }
}

export async function temporaryProject<T>(
  body: (root: string) => Promise<T>,
  prefix = "yoda-lock-process-",
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(root, ".brain/transactions"), { recursive: true });
    await mkdir(join(root, ".brain/runs/run-01"), { recursive: true });
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
