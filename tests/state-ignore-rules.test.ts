import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_LANGUAGE_POLICY,
  profileStack,
  skeletonEffects,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

const IDENTITY = [
  "-c",
  "user.email=test@example.com",
  "-c",
  "user.name=Test",
  "-c",
  "commit.gpgsign=false",
] as const;

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(root, ".absent-global-config"),
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    encoding: "utf8",
  });
}

function tryGit(
  root: string,
  args: readonly string[],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", [...IDENTITY, ...args], {
      cwd: root,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(root, ".absent-global-config"),
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

async function createGitRepo(): Promise<{
  root: string;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "kratos-state-ignore-"));
  git(root, ["init", "-b", "main"]);
  return {
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeSkeleton(root: string): Promise<void> {
  const effects = skeletonEffects(
    {
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      hosts: ["claude", "codex"],
      language: DEFAULT_LANGUAGE_POLICY,
      policyMode: "standard",
      snapshots: true,
      modelRoles: {
        claude: {
          planner: { model: "claude-planner", effort: "medium" },
          implementer: { model: "claude-implementer", effort: "medium" },
          judge: { model: "claude-judge", effort: "medium" },
        },
        codex: {
          planner: { model: "codex-planner", effort: "medium" },
          implementer: { model: "codex-implementer", effort: "high" },
          judge: { model: "codex-judge", effort: "medium" },
        },
      },
    },
    profileStack({ rootEntries: ["package.json"] }),
  );

  for (const effect of effects) {
    if (effect.kind === "write_file") {
      const fullPath = join(root, effect.path);
      const parentDir = join(fullPath, "..");
      await mkdir(parentDir, { recursive: true });
      await writeFile(fullPath, effect.content, "utf8");
    }
  }
}

describe("state directory ignore rules in Git", () => {
  it("ignores all volatile and transient paths while tracking durable knowledge", async () => {
    const repo = await createGitRepo();
    try {
      await writeSkeleton(repo.root);

      // Create additional simulated paths
      const volatilePaths = [
        ".brain/03-memory/task_log.jsonl",
        ".brain/03-memory/.cache/feature-create.json",
        ".brain/03-memory/candidates/candidate.json",
        ".brain/02-features/auth/runs/run-1/events.jsonl",
        ".brain/events.jsonl",
        ".brain/agent.trace",
        ".brain/traces/step-1.log",
      ];

      for (const relPath of volatilePaths) {
        const fullPath = join(repo.root, relPath);
        await mkdir(join(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, "temporary volatile data\n", "utf8");
      }

      const durablePaths = [
        ".brain/.gitignore",
        ".brain/00-business/README.md",
        ".brain/01-architecture/README.md",
        ".brain/01-architecture/adr/.gitkeep",
        ".brain/01-architecture/stack-profile.md",
        ".brain/02-features/README.md",
        ".brain/02-features/_template/00-prd.md",
        ".brain/02-features/_template/01-design.md",
        ".brain/02-features/_template/02-tasks.md",
        ".brain/02-features/_template/03-summa.md",
        ".brain/02-features/_template/state.json",
        ".brain/02-features/active",
        ".brain/03-memory/decisions.log",
        ".brain/03-memory/curated-memory.json",
        ".brain/03-memory/gotchas.md",
        ".brain/03-memory/task_metrics.md",
        ".brain/config.json",
        ".brain/guardrails.json",
      ];

      // Verify each volatile path is ignored by git
      for (const relPath of volatilePaths) {
        const result = tryGit(repo.root, ["check-ignore", "-q", relPath]);
        expect(result.status, `Expected ${relPath} to be ignored by git`).toBe(
          0,
        );
      }

      // Verify each durable path is NOT ignored by git
      for (const relPath of durablePaths) {
        const result = tryGit(repo.root, ["check-ignore", "-q", relPath]);
        expect(
          result.status,
          `Expected ${relPath} NOT to be ignored by git`,
        ).toBe(1);
      }
    } finally {
      await repo.dispose();
    }
  });

  it("eliminates merge conflicts between parallel branches writing to volatile logs", async () => {
    const repo = await createGitRepo();
    try {
      await writeSkeleton(repo.root);

      // Stage and commit initial skeleton (including .brain/.gitignore)
      git(repo.root, ["add", "."]);
      git(repo.root, [
        "commit",
        "-m",
        "Initial commit with state ignore rules",
      ]);

      // Create branch A
      git(repo.root, ["checkout", "-b", "feature-a"]);
      // Branch A writes to volatile task_log and run events
      const taskLogA = join(repo.root, ".brain/03-memory/task_log.jsonl");
      const eventsA = join(
        repo.root,
        ".brain/02-features/auth/runs/run-1/events.jsonl",
      );
      await mkdir(join(eventsA, ".."), { recursive: true });
      await writeFile(taskLogA, '{"task":"A1"}\n{"task":"A2"}\n', "utf8");
      await writeFile(eventsA, '{"event":"A1"}\n', "utf8");

      // Branch A makes a durable commit (e.g. decision log)
      const decisionLog = join(repo.root, ".brain/03-memory/decisions.log");
      await writeFile(
        decisionLog,
        "2026-08-29: Branch A made decision 1\n",
        "utf8",
      );
      git(repo.root, ["add", ".brain/03-memory/decisions.log"]);
      git(repo.root, ["commit", "-m", "Branch A decision"]);

      // Switch back to main and create branch B
      git(repo.root, ["checkout", "main"]);
      git(repo.root, ["checkout", "-b", "feature-b"]);

      // Branch B writes different volatile logs
      await writeFile(taskLogA, '{"task":"B1"}\n{"task":"B2"}\n', "utf8");
      await writeFile(eventsA, '{"event":"B1"}\n', "utf8");

      // Branch B makes another durable commit (e.g. gotchas)
      const gotchas = join(repo.root, ".brain/03-memory/gotchas.md");
      await writeFile(gotchas, "Gotcha recorded on branch B\n", "utf8");
      git(repo.root, ["add", ".brain/03-memory/gotchas.md"]);
      git(repo.root, ["commit", "-m", "Branch B gotcha"]);

      // Merge feature-a into main
      git(repo.root, ["checkout", "main"]);
      git(repo.root, [
        "merge",
        "--no-ff",
        "feature-a",
        "-m",
        "Merge feature-a",
      ]);

      // Merge feature-b into main - should merge cleanly with ZERO conflict!
      const mergeResult = tryGit(repo.root, [
        "merge",
        "--no-ff",
        "feature-b",
        "-m",
        "Merge feature-b",
      ]);
      expect(
        mergeResult.status,
        `Expected merge to succeed without conflict, but got stderr: ${mergeResult.stderr}`,
      ).toBe(0);

      // Verify durable content from both branches is preserved
      expect(await readFile(decisionLog, "utf8")).toContain(
        "Branch A made decision 1",
      );
      expect(await readFile(gotchas, "utf8")).toContain(
        "Gotcha recorded on branch B",
      );
    } finally {
      await repo.dispose();
    }
  });

  it("reproduces the merge conflict when volatile logs are tracked without ignore rules", async () => {
    const repo = await createGitRepo();
    try {
      // Setup repo without .brain/.gitignore and with tracked task_log.jsonl
      const taskLog = join(repo.root, ".brain/03-memory/task_log.jsonl");
      await mkdir(join(taskLog, ".."), { recursive: true });
      await writeFile(taskLog, '{"seed":"initial"}\n', "utf8");
      git(repo.root, ["add", "."]);
      git(repo.root, ["commit", "-m", "Initial commit tracking task_log"]);

      // Branch A appends to task_log.jsonl
      git(repo.root, ["checkout", "-b", "branch-a"]);
      await writeFile(taskLog, '{"seed":"initial"}\n{"branch":"A"}\n', "utf8");
      git(repo.root, ["add", "."]);
      git(repo.root, ["commit", "-m", "Branch A log append"]);

      // Branch B appends different content to task_log.jsonl
      git(repo.root, ["checkout", "main"]);
      git(repo.root, ["checkout", "-b", "branch-b"]);
      await writeFile(taskLog, '{"seed":"initial"}\n{"branch":"B"}\n', "utf8");
      git(repo.root, ["add", "."]);
      git(repo.root, ["commit", "-m", "Branch B log append"]);

      // Merge branch-a into main
      git(repo.root, ["checkout", "main"]);
      git(repo.root, ["merge", "--no-ff", "branch-a", "-m", "Merge branch-a"]);

      // Merge branch-b into main - MUST conflict on the append-only log!
      const mergeResult = tryGit(repo.root, [
        "merge",
        "--no-ff",
        "branch-b",
        "-m",
        "Merge branch-b",
      ]);
      expect(mergeResult.status).not.toBe(0);
      expect(mergeResult.stdout + mergeResult.stderr).toContain("CONFLICT");
    } finally {
      await repo.dispose();
    }
  });

  it("allows legacy repositories to adopt ignore rules without losing working copies", async () => {
    const repo = await createGitRepo();
    try {
      // Simulate legacy repo where task_log was tracked in git
      const taskLog = join(repo.root, ".brain/03-memory/task_log.jsonl");
      await mkdir(join(taskLog, ".."), { recursive: true });
      await writeFile(
        taskLog,
        '{"legacy":"log-entry-1"}\n{"legacy":"log-entry-2"}\n',
        "utf8",
      );
      git(repo.root, ["add", "."]);
      git(repo.root, ["commit", "-m", "Legacy commit with tracked log"]);

      // Adoption: write .brain/.gitignore and untrack the file from Git index
      const gitignore = join(repo.root, ".brain/.gitignore");
      await writeFile(
        gitignore,
        "# Managed by Kratos.\n03-memory/task_log.jsonl\n03-memory/.cache/\n",
        "utf8",
      );

      // Run git rm --cached to untrack while preserving working copy
      git(repo.root, ["rm", "--cached", ".brain/03-memory/task_log.jsonl"]);
      git(repo.root, ["add", ".brain/.gitignore"]);
      git(repo.root, ["commit", "-m", "Adopt state ignore rules"]);

      // Prove the file still exists on disk with intact content
      const fileOnDisk = await readFile(taskLog, "utf8");
      expect(fileOnDisk).toBe(
        '{"legacy":"log-entry-1"}\n{"legacy":"log-entry-2"}\n',
      );

      // Prove the file is now ignored and no longer tracked in git
      const statusResult = git(repo.root, ["status", "--porcelain"]);
      expect(statusResult).toBe("");

      // Appending to the local log leaves working tree clean in git
      await writeFile(taskLog, fileOnDisk + '{"new":"local-entry"}\n', "utf8");
      expect(git(repo.root, ["status", "--porcelain"])).toBe("");
    } finally {
      await repo.dispose();
    }
  });
});
