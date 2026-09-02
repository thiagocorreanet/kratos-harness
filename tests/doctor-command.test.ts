import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  RepositoryEvidence,
  ResolvedAnswers,
  ResolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import {
  profileStack,
  skeletonEffects,
  unresolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import { PRD_DOCUMENT } from "@kratos/runtime/domain/feature-documents";
import {
  createRuntimeAt,
  createSchemaRegistry,
} from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { observeWorkflow } from "@kratos/runtime/composition/workflow";
import {
  DEFAULT_REGISTRY,
  doctorCommand,
  parseInvocation,
  type Decision,
} from "@kratos/runtime/domain/cli";
import {
  evaluateGates,
  resolveGateModes,
  type GateDecision,
} from "@kratos/runtime/domain/gates";
import { prepareContract } from "@kratos/runtime/domain/schema";
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
  contractVersion: "1.6.0",
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
  gateModes: {},
  snapshots: true,
  modelRoles: { codex: codexCatalog().defaults },
  projectProfile,
});

const NODE_PROJECT: Readonly<Record<string, string>> = { "package.json": "{}" };

/**
 * The listing the runtime's own scan will produce for this project.
 *
 * Stated here rather than walked, so a doctor that renders from the real scan
 * is compared against an expectation that does not share its implementation.
 */
function evidenceOf(
  projectFiles: Readonly<Record<string, string>>,
): RepositoryEvidence {
  const files = Object.keys(projectFiles).sort();
  return {
    rootEntries: [
      ...new Set(files.map((path) => path.split("/")[0] ?? path)),
    ].sort(),
    files,
    truncated: false,
  };
}

function generatedFiles(
  projectProfile: ResolvedProjectProfile,
  projectFiles: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    skeletonEffects(
      baseAnswers(projectProfile),
      profileStack(evidenceOf(projectFiles)),
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
  /** The project the runtime scans, when it is not a bare Node.js root. */
  readonly projectFiles?: Readonly<Record<string, string>>;
}

function subject(options: SubjectOptions = {}) {
  const profile = options.profile ?? completeProfile;
  const projectFiles = options.projectFiles ?? NODE_PROJECT;
  const generated = generatedFiles(profile, projectFiles);
  const files = options.mutateFiles?.(generated) ?? generated;
  const storage = memoryTransactionStorage({
    files,
    directories: [
      ".brain/transactions",
      ...(options.stackProfileDirectory ? [STACK_PROFILE] : []),
    ],
  });
  const output = recordingOutput();
  const fileSystem = memoryFileSystem(projectFiles);
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
  const structuredLength = run.output.structured_.length;
  const humanLength = run.output.human_.length;
  const exitCode = await runCommandLine(["doctor"], run.ports);
  return {
    exitCode,
    rendered:
      run.output.structured_.slice(structuredLength).join("") +
      run.output.human_.slice(humanLength).join(""),
  };
}

async function doctorJson(run: ReturnType<typeof subject>): Promise<{
  readonly exitCode: number;
  readonly result: Record<string, unknown>;
}> {
  const structuredLength = run.output.structured_.length;
  const exitCode = await runCommandLine(["--json", "doctor"], run.ports);
  return {
    exitCode,
    result: JSON.parse(
      run.output.structured_.slice(structuredLength).join(""),
    ) as Record<string, unknown>,
  };
}

async function doctorWithShadowGap(): Promise<ReturnType<typeof subject>> {
  const run = subject({
    mutateFiles: (files) => ({
      ...files,
      ".brain/config.json": `${JSON.stringify({
        ...JSON.parse(files[".brain/config.json"] ?? "{}"),
        gateModes: { "gaps-closed": "shadow" },
      })}\n`,
    }),
  });
  const objective = "Publish doctor findings";
  const feature = "publish-doctor-findings";
  const prd = `.brain/02-features/${feature}/00-prd.md`;
  const proposal = `.brain/02-features/${feature}/gap-proposal.json`;

  expect(await runCommandLine(["objective", objective], run.ports)).toBe(0);
  expect(await runCommandLine(["start"], run.ports)).toBe(0);
  await run.storage.fileSystem.write(prd, completePrd());
  await run.storage.fileSystem.write(
    proposal,
    JSON.stringify({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      gaps: [
        {
          gapId: "doctor-output",
          category: "document-contradiction",
          weight: "high",
          description: "The doctor output has two incompatible forms.",
          recommendation: "Publish the structured report.",
          reasoning: "Automation needs the selected gate mode.",
          documentRefs: [prd],
        },
      ],
    }),
  );
  expect(
    await runCommandLine(
      ["gaps", "record", proposal, "--correlation-id", "doctor-gap"],
      run.ports,
    ),
  ).toBe(0);
  return run;
}

async function doctorWithoutGateFailures(): Promise<
  ReturnType<typeof subject>
> {
  const run = subject();
  const objective = "Confirm doctor gates";
  const feature = "confirm-doctor-gates";

  expect(await runCommandLine(["objective", objective], run.ports)).toBe(0);
  expect(await runCommandLine(["start"], run.ports)).toBe(0);
  await run.storage.fileSystem.write(
    `.brain/02-features/${feature}/00-prd.md`,
    completePrd(),
  );
  return run;
}

function repeatedRejectionDecision(count: number): GateDecision {
  return evaluateGates({
    gateModes: resolveGateModes("strict", {}),
    phase: "prd",
    contextReadable: true,
    stopLoss: {
      tripped: false,
      exhausted: false,
      repeatedRejections: Array.from({ length: count }, (_, index) => ({
        criterionId: `AC-1.${String(index + 1)}`,
        attempt: 3,
        classification: "code" as const,
        artifactRef: `repair-stops/AC-1.${String(index + 1)}.json`,
      })),
    },
    prdDigest: "a".repeat(64),
    prdDocument: { kind: "complete" },
    specDigest: null,
    approvals: [],
    openGaps: 0,
    partitionRequired: false,
    partitionApproved: true,
    finalAcceptance: false,
    acceptanceCriteria: [],
  });
}

async function doctorDecisionWithGateFailures(
  run: ReturnType<typeof subject>,
  gateDecision: GateDecision,
): Promise<Decision> {
  const parsed = parseInvocation(["doctor"], DEFAULT_REGISTRY);
  if (parsed.kind !== "invocation") throw new Error("doctor did not parse");
  const observed = await observeWorkflow(
    parsed.invocation,
    run.ports,
    createSchemaRegistry(),
  );
  if (
    observed.kind !== "observed" ||
    observed.observation.kind !== "workflow"
  ) {
    throw new Error("doctor workflow observation unavailable");
  }
  return doctorCommand.handler({
    ...parsed.invocation,
    observation: { ...observed.observation, gateDecision },
  });
}

function completePrd(): string {
  return `# Requirements\n\n${PRD_DOCUMENT.requiredSections
    .map((section) => `## ${section}\n\nCompleted ${section}.`)
    .join("\n\n")}\n`;
}

async function writeNodeProject(
  root: string,
  projectProfile: ResolvedProjectProfile,
): Promise<void> {
  for (const [path, content] of Object.entries(
    generatedFiles(projectProfile, NODE_PROJECT),
  )) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
}

describe("stack-profile doctor readiness", () => {
  it("publishes an empty structured gate-failure list", async () => {
    const result = await doctorJson(await doctorWithoutGateFailures());

    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({
      contractVersion: "1.0.0",
      hostContract: "1.4.0",
      gateFailures: [],
    });
  });

  it("reports shadow gate findings in human and JSON doctor output", async () => {
    const human = await doctor(await doctorWithShadowGap());
    const json = (await doctorJson(await doctorWithShadowGap())).result;

    expect(human.exitCode).toBe(0);
    expect(human.rendered).toContain("gates: warn");
    expect(human.rendered).toContain("gaps-closed: shadow gate.gaps_abertos");
    expect(json).toMatchObject({
      contractVersion: "1.0.0",
      hostContract: "1.4.0",
      health: "degraded",
      gateFailures: [
        expect.objectContaining({
          gateId: "gaps-closed",
          reasonCode: "gate.gaps_abertos",
          mode: "shadow",
        }),
      ],
    });
  });

  it("preserves duplicate repeated-rejection summaries in human and JSON doctor output", async () => {
    const run = await doctorWithoutGateFailures();
    const decision = await doctorDecisionWithGateFailures(
      run,
      repeatedRejectionDecision(2),
    );
    const prepared = prepareContract(createSchemaRegistry(), {
      id: "host.doctor-report",
      version: "1.0.0",
      value: decision.payload,
      structuralReasonCode: "trail.output_invalido",
    });
    const human = decision.humanStdout ?? "";
    const summary = "stop-loss: enforce blocked.stop_loss_rejections";

    expect(prepared).toMatchObject({ kind: "valid" });
    if (prepared.kind !== "valid") throw new Error("doctor report invalid");
    const json = JSON.parse(prepared.canonical) as Record<string, unknown>;
    expect(human.split(summary)).toHaveLength(3);
    const checks = json.checks as readonly Record<string, unknown>[];
    expect(checks.find(({ name }) => name === "gates")).toMatchObject({
      name: "gates",
      details: [summary, summary],
    });
    expect(json).toMatchObject({
      gateFailures: [
        expect.objectContaining({
          reasonCode: "blocked.stop_loss_rejections",
          evidenceRefs: ["repair-stops/AC-1.1.json"],
        }),
        expect.objectContaining({
          reasonCode: "blocked.stop_loss_rejections",
          evidenceRefs: ["repair-stops/AC-1.2.json"],
        }),
      ],
    });
  });

  it("passes byte-matching complete authoritative state without executing commands", async () => {
    const run = subject();

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: pass");
    expect(await run.fileSystem.stat("doctor-command-ran")).toBeNull();
  });

  it("agrees with initialization about a project whose manifest is nested", async () => {
    // Doctor renders from its own scan. If the two walks disagreed about what
    // a monorepo is, every project like this one would report drift forever.
    const run = subject({
      projectFiles: {
        "apps/web/package.json": "{}",
        "apps/web/src/index.ts": "export {};",
        "services/api/go.mod": "module api",
        "services/api/main.go": "package main",
      },
    });

    const result = await doctor(run);

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("stack-profile: pass");
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
    const json = await doctorJson(run);
    expect(json.exitCode).toBe(4);
    expect(json.result).toMatchObject({
      contractVersion: "1.0.0",
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
    });
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
