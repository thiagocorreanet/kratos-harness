import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const repositoryRoot = join(import.meta.dirname, "../..");
const buildRootParent = tmpdir();
const rawWorkerId = process.env.VITEST_WORKER_ID ?? "main";
const buildWorkerId = /^[A-Za-z0-9_-]+$/u.test(rawWorkerId)
  ? rawWorkerId
  : "main";
export const buildRoot = join(
  buildRootParent,
  `kratos-plugin-vitest-build-${String(process.pid)}-${buildWorkerId}`,
);
const lockDir = `${buildRoot}.lock`;

export function isOwnedBuildRoot(
  target: string,
  parent = buildRootParent,
  pid = process.pid,
  workerId = buildWorkerId,
): boolean {
  const expectedName = `kratos-plugin-vitest-build-${String(pid)}-${workerId}`;
  return (
    dirname(target) === parent &&
    basename(target) === expectedName &&
    target === join(parent, expectedName)
  );
}

function assertOwnedBuildRoot(): void {
  if (!isOwnedBuildRoot(buildRoot)) {
    throw new Error("Refusing to clean an unexpected built-plugin test root.");
  }
}

/**
 * Removes only this process's deterministic test build directory. Calling it
 * repeatedly is safe, so a rebuilt package never inherits another test's
 * tampering. It also removes a residual directory if this operating-system PID
 * is reused after an abnormal previous process termination.
 */
export function cleanupBuiltPlugin(): void {
  assertOwnedBuildRoot();
  rmSync(buildRoot, { force: true, maxRetries: 3, recursive: true });
}

// Normal Node exits run this handler. SIGKILL and machine loss cannot run it;
// the next owner of this exact PID root removes its own residual before build.
process.once("exit", () => {
  try {
    cleanupBuiltPlugin();
  } catch {
    // Exit cleanup must not replace the process's original exit status.
  }
});

export function buildPlugin(): void {
  const deadline = Date.now() + 60000;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      acquired = true;
      break;
    } catch {
      const waitDeadline = Date.now() + 50;
      while (Date.now() < waitDeadline) {
        // Spin wait 50ms
      }
    }
  }
  if (!acquired) throw new Error("Timed out waiting for the build lock.");

  try {
    cleanupBuiltPlugin();
    execFileSync(
      process.execPath,
      ["scripts/build.mjs", "--output", buildRoot],
      {
        cwd: repositoryRoot,
        stdio: "pipe",
      },
    );
  } finally {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Best effort release
    }
  }
}

export function hostPackage(host: "codex" | "claude-code"): string {
  return join(buildRoot, host);
}

export function runtimeEntry(host: "codex" | "claude-code" = "codex"): string {
  return join(hostPackage(host), "runtime/kratos.mjs");
}
