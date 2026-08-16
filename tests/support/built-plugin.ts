import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const repositoryRoot = join(import.meta.dirname, "../..");
export const buildRoot = join(tmpdir(), "kratos-plugin-vitest-build");

export function buildPlugin(): void {
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
