import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

describe("memory capture distribution", () => {
  it.each(["codex", "claude-code"] as const)(
    "executes %s manual capture from its packaged runtime without a project command",
    async (host) => {
      const temporary = await mkdtemp(join(tmpdir(), `kratos-memory-${host}-`));
      try {
        const output = join(temporary, "plugin");
        execFileSync(
          process.execPath,
          ["scripts/build.mjs", "--output", output],
          {
            cwd: root,
            stdio: "pipe",
          },
        );
        const project = join(temporary, "project");
        await mkdir(join(project, ".brain/transactions"), { recursive: true });
        await mkdir(join(project, ".brain/03-memory/candidates"), {
          recursive: true,
        });
        await writeFile(
          join(project, "proposal.json"),
          `${JSON.stringify({
            contractVersion: "1.2.0",
            hostContract: "1.2.0",
            observation: "Build failed at 2026-08-28T12:00:00.000Z",
          })}\n`,
        );
        const result = spawnSync(
          process.execPath,
          [
            join(output, host, "runtime/kratos.mjs"),
            "memory",
            "capture",
            "proposal.json",
          ],
          {
            cwd: project,
            encoding: "utf8",
            env: { ...process.env, PATH: "" },
          },
        );

        expect(result.status).toBe(0);
        expect(
          await readdir(join(project, ".brain/03-memory/candidates")),
        ).toHaveLength(1);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
});
