import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  fixedEnvironment,
  pipedInput,
  recordingOutput,
} from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

import {
  createNestedProjectRepository,
  createRootProjectRepository,
  UNDECODABLE_NAME_BYTES,
} from "./support/git-repositories.js";

const ANSWERS = JSON.stringify({
  contractVersion: "1.3.0",
  hostContract: "1.3.0",
  hosts: ["claude"],
});

const REAL_REPOSITORY_TIMEOUT = 15_000;

function runtime(root: string, input: string | null = null) {
  const output = recordingOutput();
  return {
    output,
    ports: createRuntime({
      environment: fixedEnvironment({}, root),
      output,
      standardInput: pipedInput(input),
    }),
  };
}

describe("the workflow worktree gate", () => {
  it(
    "starts a root project when only its managed state is dirty",
    async () => {
      const repository = await createRootProjectRepository();
      try {
        expect(
          await runCommandLine(
            ["init", "--root", repository.projectRoot],
            runtime(repository.projectRoot, ANSWERS).ports,
          ),
        ).toBe(0);
        repository.commitAll("initialize project");

        expect(
          await runCommandLine(
            [
              "objective",
              "Ship the root project",
              "--root",
              repository.projectRoot,
            ],
            runtime(repository.projectRoot).ports,
          ),
        ).toBe(0);

        const started = runtime(repository.projectRoot);
        const exitCode = await runCommandLine(
          [
            "--json",
            "start",
            "--root",
            repository.projectRoot,
            "--host",
            "claude-code",
          ],
          started.ports,
        );
        expect(exitCode, started.output.structured_.join("")).toBe(0);
        const featureRoot = join(
          repository.projectRoot,
          ".brain/02-features/ship-the-root-project",
        );
        const runId = (
          await readFile(join(featureRoot, "active-run"), "utf8")
        ).trim();
        const events = await readFile(
          join(featureRoot, "runs", runId, "events.jsonl"),
          "utf8",
        );
        expect(events).toContain('"reasonCode":"run.started"');
      } finally {
        await repository.dispose();
      }
    },
    REAL_REPOSITORY_TIMEOUT,
  );

  it(
    "starts a nested project when only its managed state is dirty",
    async () => {
      const repository = await createNestedProjectRepository();
      try {
        expect(
          await runCommandLine(
            ["init", "--root", repository.projectRoot],
            runtime(repository.projectRoot, ANSWERS).ports,
          ),
        ).toBe(0);
        repository.commitAll("initialize project");

        expect(
          await runCommandLine(
            [
              "objective",
              "Ship the nested project",
              "--root",
              repository.projectRoot,
            ],
            runtime(repository.projectRoot).ports,
          ),
        ).toBe(0);

        const started = runtime(repository.projectRoot);
        const exitCode = await runCommandLine(
          [
            "--json",
            "start",
            "--root",
            repository.projectRoot,
            "--host",
            "claude-code",
          ],
          started.ports,
        );
        expect(exitCode, started.output.structured_.join("")).toBe(0);
        const featureRoot = join(
          repository.projectRoot,
          ".brain/02-features/ship-the-nested-project",
        );
        const runId = (
          await readFile(join(featureRoot, "active-run"), "utf8")
        ).trim();
        const events = await readFile(
          join(featureRoot, "runs", runId, "events.jsonl"),
          "utf8",
        );
        expect(events).toContain('"reasonCode":"run.started"');
      } finally {
        await repository.dispose();
      }
    },
    REAL_REPOSITORY_TIMEOUT,
  );

  it(
    "refuses a nested project when a repository-root path is dirty",
    async () => {
      const repository = await createNestedProjectRepository();
      try {
        expect(
          await runCommandLine(
            ["init", "--root", repository.projectRoot],
            runtime(repository.projectRoot, ANSWERS).ports,
          ),
        ).toBe(0);
        repository.commitAll("initialize project");

        expect(
          await runCommandLine(
            [
              "objective",
              "Ship the nested project",
              "--root",
              repository.projectRoot,
            ],
            runtime(repository.projectRoot).ports,
          ),
        ).toBe(0);
        await mkdir(join(repository.repositoryRoot, ".brain"));
        await writeFile(
          join(repository.repositoryRoot, ".brain/foreign.txt"),
          "x\n",
        );

        const started = runtime(repository.projectRoot);
        const exitCode = await runCommandLine(
          [
            "--json",
            "start",
            "--root",
            repository.projectRoot,
            "--host",
            "claude-code",
          ],
          started.ports,
        );
        expect(exitCode, started.output.structured_.join("")).toBe(2);
        expect(JSON.parse(started.output.structured_.join(""))).toMatchObject({
          reasonCode: "trail.worktree_dirty",
        });
      } finally {
        await repository.dispose();
      }
    },
    REAL_REPOSITORY_TIMEOUT,
  );

  it(
    "refuses an undecodable path inside managed state",
    async () => {
      const repository = await createNestedProjectRepository();
      try {
        expect(
          await runCommandLine(
            ["init", "--root", repository.projectRoot],
            runtime(repository.projectRoot, ANSWERS).ports,
          ),
        ).toBe(0);
        repository.commitAll("initialize project");

        expect(
          await runCommandLine(
            [
              "objective",
              "Ship the nested project",
              "--root",
              repository.projectRoot,
            ],
            runtime(repository.projectRoot).ports,
          ),
        ).toBe(0);
        const managedRoot = Buffer.from(
          `${join(repository.projectRoot, ".brain")}${sep}`,
          "utf8",
        );
        await writeFile(
          Buffer.concat([managedRoot, Buffer.from(UNDECODABLE_NAME_BYTES)]),
          "x\n",
        );

        const started = runtime(repository.projectRoot);
        const exitCode = await runCommandLine(
          [
            "--json",
            "start",
            "--root",
            repository.projectRoot,
            "--host",
            "claude-code",
          ],
          started.ports,
        );
        expect(exitCode, started.output.structured_.join("")).toBe(2);
        expect(JSON.parse(started.output.structured_.join(""))).toMatchObject({
          reasonCode: "trail.worktree_dirty",
        });
      } finally {
        await repository.dispose();
      }
    },
    REAL_REPOSITORY_TIMEOUT,
  );
});
