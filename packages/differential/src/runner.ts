import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureAfter, captureBefore } from "./capture.ts";
import { compareObservations } from "./compare.ts";
import { materializeWorkspace } from "./materialize.ts";
import { normalizeObservation } from "./normalize.ts";
import type {
  CapturedStream,
  DifferentialObservation,
  DifferentialReport,
  DifferentialScenario,
  ProcessObservation,
} from "./types.ts";

export interface RunSideOptions {
  side: "oracle" | "candidate";
  executable: string;
  scenario: DifferentialScenario;
  temporaryParent?: string;
}

export interface SideRun {
  side: "oracle" | "candidate";
  executableSha256: string;
  durationMs: number;
  observation: DifferentialObservation;
}

interface ProcessRun {
  observation: ProcessObservation;
  durationMs: number;
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function verifyExecutable(
  path: string,
): Promise<{ path: string; sha256: string }> {
  const resolved = await realpath(path);
  const stats = await lstat(resolved);
  if (!stats.isFile()) {
    throw new Error("Differential runner executable is not a regular file");
  }
  return { path: resolved, sha256: digest(await readFile(resolved)) };
}

function safeEnvironment(
  root: string,
  scenario: DifferentialScenario,
): NodeJS.ProcessEnv {
  const inherited = ["PATH", "SystemRoot", "WINDIR", "PATHEXT"] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inherited) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    ...scenario.invocation.environment,
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function terminate(child: ChildProcess, signal: NodeJS.Signals): void {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited between the state check and signal.
    }
  }
}

/**
 * Summarize the retained stream prefix. `bytes`, `sha256`, and `content` always
 * describe the same buffer so a bounded capture stays internally consistent.
 */
function capturedStream(
  chunks: readonly Buffer[],
  disclosure: "digest" | "content",
): CapturedStream {
  const value = Buffer.concat(chunks);
  return {
    bytes: value.byteLength,
    sha256: digest(value),
    ...(disclosure === "content" ? { content: value.toString("utf8") } : {}),
  };
}

async function execute(
  executable: string,
  project: string,
  root: string,
  scenario: DifferentialScenario,
): Promise<ProcessRun> {
  const started = performance.now();
  const child = spawn(executable, scenario.invocation.args, {
    shell: false,
    detached: process.platform !== "win32",
    cwd: project,
    env: safeEnvironment(root, scenario),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const termination: { outcome: ProcessObservation["outcome"] } = {
    outcome: "exit",
  };

  let escalation: NodeJS.Timeout | undefined;

  /** Send SIGTERM once, then escalate to SIGKILL after a fixed grace period. */
  function requestTermination(): void {
    if (escalation !== undefined) return;
    terminate(child, "SIGTERM");
    escalation = setTimeout(() => {
      terminate(child, "SIGKILL");
    }, 250);
  }

  /**
   * Retain only the prefix that fits within the declared bound, then stop the
   * child. Dropping the whole overflowing chunk would discard evidence and
   * leave the reported byte count describing data that was never hashed.
   */
  function collect(
    chunk: Buffer,
    target: Buffer[],
    current: number,
    maximum: number,
  ): number {
    const remaining = maximum - current;
    if (chunk.byteLength <= remaining) {
      target.push(chunk);
      return current + chunk.byteLength;
    }
    if (remaining > 0) target.push(chunk.subarray(0, remaining));
    termination.outcome = "output_limit";
    requestTermination();
    return maximum;
  }

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes = collect(
      chunk,
      stdout,
      stdoutBytes,
      scenario.invocation.maxStdoutBytes,
    );
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes = collect(
      chunk,
      stderr,
      stderrBytes,
      scenario.invocation.maxStderrBytes,
    );
  });
  child.on("error", () => {
    termination.outcome = "spawn_error";
  });
  child.stdin.end(scenario.invocation.stdin);

  const timeout = setTimeout(() => {
    if (termination.outcome === "exit") termination.outcome = "timeout";
    requestTermination();
  }, scenario.invocation.timeoutMs);

  const closed = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  clearTimeout(timeout);
  if (escalation !== undefined) clearTimeout(escalation);

  const outcome =
    termination.outcome === "exit" && closed.signal !== null
      ? "signal"
      : termination.outcome;
  return {
    durationMs: Math.max(0, performance.now() - started),
    observation: {
      outcome,
      exitCode: closed.code,
      signal: closed.signal,
      stdout: capturedStream(stdout, scenario.disclosure.stdout),
      stderr: capturedStream(stderr, scenario.disclosure.stderr),
    },
  };
}

export async function runScenarioSide(
  options: RunSideOptions,
): Promise<SideRun> {
  const executable = await verifyExecutable(options.executable);
  const parent = options.temporaryParent ?? tmpdir();
  const root = await mkdtemp(
    join(parent, `yoda-differential-${options.side}-`),
  );
  try {
    await Promise.all([
      mkdir(join(root, "home"), { mode: 0o700 }),
      mkdir(join(root, "tmp"), { mode: 0o700 }),
    ]);
    const project = await materializeWorkspace(
      root,
      options.scenario.workspace.entries,
    );
    const baseline = await captureBefore(project, options.scenario.capture);
    const processRun = await execute(
      executable.path,
      project,
      root,
      options.scenario,
    );
    const captured = await captureAfter(
      project,
      options.scenario.capture,
      baseline,
      processRun.observation,
      options.scenario.disclosure.artifacts,
    );
    return {
      side: options.side,
      executableSha256: executable.sha256,
      durationMs: processRun.durationMs,
      observation: normalizeObservation(
        captured,
        options.scenario.normalization,
        project,
      ),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function runScenario(
  scenario: DifferentialScenario,
  oracleExecutable: string,
  candidateExecutable: string,
  temporaryParent?: string,
): Promise<DifferentialReport> {
  const oracle = await runScenarioSide({
    side: "oracle",
    executable: oracleExecutable,
    scenario,
    ...(temporaryParent === undefined ? {} : { temporaryParent }),
  });
  const candidate = await runScenarioSide({
    side: "candidate",
    executable: candidateExecutable,
    scenario,
    ...(temporaryParent === undefined ? {} : { temporaryParent }),
  });
  return compareObservations(
    scenario,
    oracle.observation,
    candidate.observation,
  );
}
