import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const repositoryRoot = join(import.meta.dirname, "../..");
const buildRootParent = tmpdir();
export const buildRoot = join(
  buildRootParent,
  `kratos-plugin-vitest-build-${String(process.pid)}`,
);

export function isOwnedBuildRoot(
  target: string,
  parent = buildRootParent,
  pid = process.pid,
): boolean {
  const expectedName = `kratos-plugin-vitest-build-${String(pid)}`;
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
  cleanupBuiltPlugin();
  execFileSync(process.execPath, ["scripts/build.mjs", "--output", buildRoot], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
}

export function hostPackage(host: "codex" | "claude-code"): string {
  return join(buildRoot, host);
}

export function runtimeEntry(host: "codex" | "claude-code" = "codex"): string {
  return join(hostPackage(host), "runtime/kratos.mjs");
}
