import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  ResolvedAnswers,
  ResolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import {
  profileStack,
  skeletonEffects,
  unresolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import { createRuntimeAt } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { DurableFileSystem, RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import projectConfigV1 from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import projectConfigV1_1 from "../fixtures/contracts/v1.1/project-config.json" with { type: "json" };
import projectConfigV1_2 from "../fixtures/contracts/v1.2/project-config.json" with { type: "json" };

import { codexCatalog } from "./support/model-routing.js";

const ROOT = "/project";
const STACK_PROFILE = ".brain/01-architecture/stack-profile.md";

const completeProfile: ResolvedProjectProfile = {
  commands: {
    test: { status: "resolved", value: "touch doctor-command-ran" },
    lint: { status: "resolved", value: "npm run lint" },
    build: { status: "resolved", value: "npm run build" },
    run: { status: "resolved", value: "npm start" },
  },
  paths: {
    source: { status: "resolved", value: ["packages"] },
    tests: { status: "resolved", value: ["tests"] },
    configuration: { status: "resolved", value: ["package.json"] },
  },
  conventions: {
    directoryLayout: {
      status: "resolved",
      value: "Workspace packages under packages/.",
    },
    naming: { status: "resolved", value: "kebab-case files." },
    implementationLanguages: {
      status: "resolved",
      value: ["TypeScript"],
    },
  },
};

const notApplicableProfile: ResolvedProjectProfile = {
  commands: {
    test: { status: "not-applicable", reason: "No test command." },
    lint: { status: "not-applicable", reason: "No lint command." },
    build: { status: "not-applicable", reason: "No build command." },
    run: { status: "not-applicable", reason: "No run command." },
  },
  paths: {
    source: { status: "not-applicable", reason: "No source paths." },
    tests: { status: "not-applicable", reason: "No test paths." },
    configuration: {
      status: "not-applicable",
      reason: "No configuration paths.",
    },
  },
  conventions: {
    directoryLayout: {
      status: "not-applicable",
      reason: "No directory convention.",
    },
    naming: { status: "not-applicable", reason: "No naming convention." },
    implementationLanguages: {
      status: "not-applicable",
      reason: "No implementation languages.",
    },
  },
};

const replacementCharacterProfile: ResolvedProjectProfile = {
  ...completeProfile,
  conventions: {
    ...completeProfile.conventions,
    naming: {
      status: "resolved",
      value: "Use the replacement character � in generated prose.",
    },
  },
};

const baseAnswers = (
  projectProfile: ResolvedProjectProfile,
): ResolvedAnswers => ({
  contractVersion: "1.4.0",
  hostContract: "1.4.0",
  hosts: ["codex"],
  language: {
    conversation: "en",
    documentation: "en",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  },
  policyMode: "standard",
  snapshots: true,
  modelRoles: { codex: codexCatalog().defaults },
  projectProfile,
});

function generatedFiles(
  projectProfile: ResolvedProjectProfile,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    skeletonEffects(
      baseAnswers(projectProfile),
      profileStack({ rootEntries: ["package.json"] }),
    ).flatMap((effect) =>
      effect.kind === "write_file" ? [[effect.path, effect.content]] : [],
    ),
  );
}

interface SubjectOptions {
  readonly profile?: ResolvedProjectProfile;
  readonly mutateFiles?: (
    files: Readonly<Record<string, string>>,
  ) => Readonly<Record<string, string>>;
  readonly stackProfileDirectory?: boolean;
  readonly unreadableStackProfile?: boolean;
}

function subject(options: SubjectOptions = {}) {
  const profile = options.profile ?? completeProfile;
  const generated = generatedFiles(profile);
  const files = options.mutateFiles?.(generated) ?? generated;
  const storage = memoryTransactionStorage({
    files,
    directories: options.stackProfileDirectory ? [STACK_PROFILE] : [],
  });
  const output = recordingOutput();
  const fileSystem = memoryFileSystem({ "package.json": "{}" });
  const durableFileSystem: DurableFileSystem = options.unreadableStackProfile
    ? {
        ...storage.durableFileSystem,
        inspect: (path) =>
          path === STACK_PROFILE
            ? Promise.reject(new Error("unreadable stack profile"))
            : storage.durableFileSystem.inspect(path),
      }
    : storage.durableFileSystem;
  const ports = {
    clock: fixedClock("2026-08-29T00:00:00.000Z"),
    ids: sequentialIds("doctor"),
    digests: storage.digests,
    durableFileSystem,
    fileSystem,
    git: stubGit(),
    locks: {} as RuntimePorts["locks"],
    modelRouting: fixedModelRouting([codexCatalog()]),
    environment: fixedEnvironment({ KRATOS_HOST: "codex" }, ROOT),
    output,
    standardInput: pipedInput(null),
    targetInspector: {} as RuntimePorts["targetInspector"],
    workspace: memoryWorkspace({ directories: [ROOT] }),
  } satisfies RuntimePorts;
  return { fileSystem, output, ports, storage };
}

function without(
  files: Readonly<Record<string, string>>,
  path: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(files).filter(([candidate]) => candidate !== path),
  );
}

async function doctor(run: ReturnType<typeof subject>): Promise<{
  readonly exitCode: number;
  readonly rendered: string;
}> {
  const exitCode = await runCommandLine(["doctor"], run.ports);
  return {
    exitCode,
    rendered: run.output.structured_.join("") + run.output.human_.join(""),
  };
}

async function doctorJson(run: ReturnType<typeof subject>): Promise<{
  readonly exitCode: number;
  readonly result: {
    readonly reasonCode: string;
    readonly stateChanged: boolean;
    readonly evidence: readonly { readonly ref: string }[];
  };
}> {
  const exitCode = await runCommandLine(["--json", "doctor"], run.ports);
  return {
    exitCode,
    result: JSON.parse(run.output.structured_.join("")) as {
      readonly reasonCode: string;
      readonly stateChanged: boolean;
      readonly evidence: readonly { readonly ref: string }[];
    },
  };
}

async function writeNodeProject(
  root: string,
  projectProfile: ResolvedProjectProfile,
): Promise<void> {
  for (const [path, content] of Object.entries(
    generatedFiles(projectProfile),
  )) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
}

describe("stack-profile doctor readiness", () => {
  it("passes byte-matching complete authoritative state without executing commands", async () => {
    const run = subject();

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: pass");
    expect(await run.fileSystem.stat("doctor-command-ran")).toBeNull();
  });

  it("warns with every unresolved typed key", async () => {
    const run = subject({ profile: unresolvedProjectProfile() });

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: warn");
    expect(result.rendered).toContain(
      "Resolve projectProfile.commands.test in the typed initialization answers, then rerun `kratos init`.",
    );
    expect(result.rendered).toContain(
      "Resolve projectProfile.conventions.implementationLanguages in the typed initialization answers, then rerun `kratos init`.",
    );
  });

  it("warns when the generated document is missing", async () => {
    const run = subject({
      mutateFiles: (files) => without(files, STACK_PROFILE),
    });

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: warn");
    expect(result.rendered).toContain(
      "The stack profile is missing; rerun `kratos init` to regenerate it.",
    );
  });

  it("warns when document bytes drift from the renderer", async () => {
    const run = subject({
      mutateFiles: (files) => ({
        ...files,
        [STACK_PROFILE]: "# Manually edited\n",
      }),
    });

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: warn");
    expect(result.rendered).toContain(
      "The stack profile differs from authoritative state; rerun `kratos init` to regenerate it.",
    );
  });

  it("warns when invalid UTF-8 decodes to the same replacement character", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-doctor-raw-bytes-"));
    try {
      await writeNodeProject(root, replacementCharacterProfile);
      const profilePath = join(root, STACK_PROFILE);
      const expectedBytes = await readFile(profilePath);
      const replacementBytes = Buffer.from([0xef, 0xbf, 0xbd]);
      const replacementAt = expectedBytes.indexOf(replacementBytes);
      expect(replacementAt).toBeGreaterThanOrEqual(0);
      const invalidBytes = Buffer.concat([
        expectedBytes.subarray(0, replacementAt),
        Buffer.from([0xff]),
        expectedBytes.subarray(replacementAt + replacementBytes.byteLength),
      ]);
      expect(invalidBytes.toString("utf8")).toBe(
        expectedBytes.toString("utf8"),
      );
      await writeFile(profilePath, invalidBytes);

      const output = recordingOutput();
      const ports = createRuntimeAt(root, {
        clock: fixedClock("2026-08-29T00:00:00.000Z"),
        ids: sequentialIds("doctor-node"),
        environment: fixedEnvironment({ KRATOS_HOST: "codex" }, root),
        git: stubGit(),
        modelRouting: fixedModelRouting([codexCatalog()]),
        output,
        standardInput: pipedInput(null),
      });

      expect(await runCommandLine(["doctor"], ports)).toBe(0);
      expect(output.structured_.join("") + output.human_.join("")).toContain(
        "stack-profile: warn",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("counts not-applicable typed leaves as complete", async () => {
    const run = subject({ profile: notApplicableProfile });

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: pass");
  });

  it("fails when the destination is unreadable", async () => {
    const run = subject({ unreadableStackProfile: true });

    const result = await doctor(run);

    expect(result.exitCode).toBe(4);
    expect(result.rendered).toContain("stack-profile: fail");
    expect(result.rendered).toContain(
      "The stack profile destination is unreadable.",
    );
  });

  it("fails when the destination is not a regular file", async () => {
    const run = subject({
      mutateFiles: (files) => without(files, STACK_PROFILE),
      stackProfileDirectory: true,
    });

    const result = await doctor(run);

    expect(result.exitCode).toBe(4);
    expect(result.rendered).toContain("stack-profile: fail");
    expect(result.rendered).toContain(
      "The stack profile destination is not a regular file.",
    );
  });

  it("fails when authoritative configuration is invalid", async () => {
    const run = subject({
      mutateFiles: (files) => ({
        ...files,
        ".brain/config.json": '{"stateContract":"1.4.0"}\n',
      }),
    });

    const result = await doctor(run);

    expect(result.exitCode).toBe(4);
    expect(result.rendered).toContain("stack-profile: fail");
    expect(result.rendered).toContain(
      "The authoritative project configuration is invalid.",
    );
  });

  it.each([
    ["1.0.0", projectConfigV1],
    ["1.1.0", projectConfigV1_1],
    ["1.2.0", projectConfigV1_2],
  ] as const)(
    "preserves the profile migration reason for project configuration %s",
    async (_version, configuration) => {
      const run = subject({
        mutateFiles: (files) => ({
          ...files,
          ".brain/config.json": `${JSON.stringify(configuration)}\n`,
        }),
      });

      const result = await doctorJson(run);

      expect(result.exitCode).toBe(4);
      expect(result.result).toMatchObject({
        reasonCode: "profile.config_migration_required",
        stateChanged: false,
        evidence: [{ ref: ".brain/config.json" }],
      });
    },
  );
});
