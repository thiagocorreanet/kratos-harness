import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import fixture from "../fixtures/contracts/v1.3/init-answers.json" with { type: "json" };

import { repositoryRoot } from "./support/built-plugin.js";

type PackageHost = "claude-code" | "codex" | "antigravity";
type ProfileLeaf =
  | { readonly status: "resolved"; readonly value: string | readonly string[] }
  | {
      readonly status: "derived";
      readonly value: string | readonly string[];
      readonly evidence: string;
    }
  | { readonly status: "not-applicable"; readonly reason: string }
  | { readonly status: "unresolved" }
  | {
      readonly confirmed: boolean;
      readonly value?: string | readonly string[];
      readonly evidence?: string;
    }
  | { readonly value: string | readonly string[]; readonly evidence: string };

interface PackagedProjectProfileRelay {
  readonly projectProfileQuestions: readonly {
    readonly key: string;
    readonly prompt: string;
  }[];
  shapeProfileLeaf?(leaf: unknown): unknown;
  relayProjectProfileAnswers(
    answers: Readonly<Record<string, unknown>>,
  ): unknown;
}

const questions = [
  {
    key: "projectProfile.commands.test",
    prompt: "What exact test command should run from the project root?",
  },
  {
    key: "projectProfile.commands.lint",
    prompt: "What exact lint command should run from the project root?",
  },
  {
    key: "projectProfile.commands.build",
    prompt: "What exact build command should run from the project root?",
  },
  {
    key: "projectProfile.commands.run",
    prompt: "What exact application command should run from the project root?",
  },
  {
    key: "projectProfile.paths.source",
    prompt: "Which project-relative paths contain source code?",
  },
  {
    key: "projectProfile.paths.tests",
    prompt: "Which project-relative paths contain tests?",
  },
  {
    key: "projectProfile.paths.configuration",
    prompt: "Which project-relative paths contain configuration?",
  },
  {
    key: "projectProfile.conventions.directoryLayout",
    prompt: "What directory-layout convention should phase agents preserve?",
  },
  {
    key: "projectProfile.conventions.naming",
    prompt: "What naming convention should phase agents preserve?",
  },
  {
    key: "projectProfile.conventions.implementationLanguages",
    prompt: "Which implementation languages does this project use?",
  },
] as const;

const flatAnswers: Readonly<Record<string, ProfileLeaf>> = {
  "projectProfile.commands.test": {
    status: "resolved",
    value: "npm test -- --runInBand",
  },
  "projectProfile.commands.lint": {
    status: "resolved",
    value: "npm run lint",
  },
  "projectProfile.commands.build": {
    status: "not-applicable",
    reason: "The project runs directly from source.",
  },
  "projectProfile.commands.run": {
    status: "resolved",
    value: "npm start",
  },
  "projectProfile.paths.source": {
    status: "resolved",
    value: ["packages/runtime/src", "packages/contracts/src"],
  },
  "projectProfile.paths.tests": {
    status: "resolved",
    value: ["tests"],
  },
  "projectProfile.paths.configuration": {
    status: "resolved",
    value: ["package.json", "tsconfig.json"],
  },
  "projectProfile.conventions.directoryLayout": {
    status: "resolved",
    value: "Workspace packages live under packages/.",
  },
  "projectProfile.conventions.naming": {
    status: "resolved",
    value: "Use kebab-case file names and camelCase identifiers.",
  },
  "projectProfile.conventions.implementationLanguages": {
    status: "resolved",
    value: ["TypeScript", "JavaScript"],
  },
};

const expectedProfile = {
  commands: {
    test: flatAnswers["projectProfile.commands.test"],
    lint: flatAnswers["projectProfile.commands.lint"],
    build: flatAnswers["projectProfile.commands.build"],
    run: flatAnswers["projectProfile.commands.run"],
  },
  paths: {
    source: flatAnswers["projectProfile.paths.source"],
    tests: flatAnswers["projectProfile.paths.tests"],
    configuration: flatAnswers["projectProfile.paths.configuration"],
  },
  conventions: {
    directoryLayout: flatAnswers["projectProfile.conventions.directoryLayout"],
    naming: flatAnswers["projectProfile.conventions.naming"],
    implementationLanguages:
      flatAnswers["projectProfile.conventions.implementationLanguages"],
  },
};

const projects: string[] = [];
let packageRoot = "";

function hostPackage(host: PackageHost): string {
  return join(packageRoot, host);
}

function runtimeEntry(host: PackageHost): string {
  return join(hostPackage(host), "runtime/kratos.mjs");
}

async function packagedRelay(
  host: PackageHost,
): Promise<PackagedProjectProfileRelay> {
  return (await import(
    pathToFileURL(
      join(
        hostPackage(host),
        "skills/kratos/scripts/project-profile-relay.mjs",
      ),
    ).href
  )) as PackagedProjectProfileRelay;
}

async function initialize(host: PackageHost) {
  const relay = await packagedRelay(host);
  const root = await mkdtemp(join(tmpdir(), `kratos-${host}-profile-`));
  projects.push(root);
  const initHost = host === "claude-code" ? "claude" : host;
  const roles = fixture.modelRoles[initHost];
  const answers = {
    ...fixture,
    hosts: [initHost],
    modelRoles: { [initHost]: roles },
    projectProfile: relay.relayProjectProfileAnswers(flatAnswers),
  };
  const execution = spawnSync(
    process.execPath,
    [runtimeEntry(host), "init", "--host", initHost, "--root", root],
    {
      encoding: "utf8",
      input: `${JSON.stringify(answers)}\n`,
    },
  );
  expect(execution.status, execution.stderr).toBe(0);
  return {
    configuration: JSON.parse(
      await readFile(join(root, ".brain/config.json"), "utf8"),
    ) as { readonly projectProfile: unknown },
    stackProfile: await readFile(
      join(root, ".brain/01-architecture/stack-profile.md"),
      "utf8",
    ),
  };
}

beforeAll(async () => {
  packageRoot = await mkdtemp(join(tmpdir(), "kratos-profile-relay-build-"));
  execFileSync(
    process.execPath,
    ["scripts/build.mjs", "--output", packageRoot],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
}, 60_000);
afterAll(async () => {
  const cleanupPaths =
    packageRoot === "" ? projects : [...projects, packageRoot];
  await Promise.all(
    cleanupPaths.map((project) => rm(project, { recursive: true })),
  );
});

describe("packaged project-profile initialization relay", () => {
  it.each(["codex", "claude-code", "antigravity"] as const)(
    "asks the canonical questions and relays exact values in %s",
    async (host) => {
      const relay = await packagedRelay(host);

      expect(relay.projectProfileQuestions).toEqual(questions);
      expect(relay.relayProjectProfileAnswers(flatAnswers)).toEqual(
        expectedProfile,
      );
    },
  );

  it.each(["codex", "claude-code", "antigravity"] as const)(
    "shapes candidate derived answers in %s",
    async (host) => {
      const relay = await packagedRelay(host);

      const candidateAnswers = {
        "projectProfile.commands.test": {
          confirmed: true,
          value: "npm test",
        },
        "projectProfile.commands.lint": {
          value: "npm run lint",
          evidence: "package.json#scripts.lint",
        },
        "projectProfile.commands.build": {
          status: "not-applicable" as const,
          reason: "Directly interpreted.",
        },
      };

      expect(relay.relayProjectProfileAnswers(candidateAnswers)).toMatchObject({
        commands: {
          test: { status: "resolved", value: "npm test" },
          lint: {
            status: "derived",
            value: "npm run lint",
            evidence: "package.json#scripts.lint",
          },
          build: {
            status: "not-applicable",
            reason: "Directly interpreted.",
          },
          run: { status: "unresolved" },
        },
      });
    },
  );

  it("produces the same authoritative values and rendered bytes for all hosts", async () => {
    const [codex, claude, antigravity] = await Promise.all([
      initialize("codex"),
      initialize("claude-code"),
      initialize("antigravity"),
    ]);

    expect(codex.configuration.projectProfile).toEqual(expectedProfile);
    expect(claude.configuration.projectProfile).toEqual(expectedProfile);
    expect(antigravity.configuration.projectProfile).toEqual(expectedProfile);
    expect(claude.stackProfile).toBe(codex.stackProfile);
    expect(antigravity.stackProfile).toBe(codex.stackProfile);
  }, 30_000);
});
