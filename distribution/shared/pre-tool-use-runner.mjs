import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const RUNTIME_GUARD_TIMEOUT_MS = 20_000;

export function createRuntimeGuardExecutor(
  runtimeEntry,
  timeoutMs = RUNTIME_GUARD_TIMEOUT_MS,
  spawnRuntime = spawnSync,
) {
  return (request, root) => {
    try {
      const execution = spawnRuntime(
        process.execPath,
        [runtimeEntry, "--json", "guard", "write", "--root", root],
        {
          cwd: root,
          encoding: "utf8",
          input: JSON.stringify(request),
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
          timeout: timeoutMs,
        },
      );
      return {
        exitCode: execution.status,
        stdout: typeof execution.stdout === "string" ? execution.stdout : "",
      };
    } catch {
      return { exitCode: null, stdout: "" };
    }
  };
}

export function runPreToolUseProcess(relay, runtimeEntry) {
  const input = (() => {
    try {
      return JSON.parse(readFileSync(0, "utf8"));
    } catch {
      return null;
    }
  })();
  const result = relay(input, createRuntimeGuardExecutor(runtimeEntry));
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  process.exitCode = result.hostExitCode;
}
