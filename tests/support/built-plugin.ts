import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const repositoryRoot = join(import.meta.dirname, "../..");
export const buildRoot = join(
  tmpdir(),
  `kratos-plugin-vitest-build-${String(process.pid)}-${process.env.VITEST_WORKER_ID ?? "main"}`,
);
const lockDir = `${buildRoot}.lock`;

export function buildPlugin(): void {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      const waitDeadline = Date.now() + 50;
      while (Date.now() < waitDeadline) {
        // Spin wait 50ms
      }
    }
  }

  try {
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
