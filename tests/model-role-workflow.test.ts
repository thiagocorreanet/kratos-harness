import projectConfigV1 from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import type {
  EventV1_1,
  OperationResultV1,
  PhaseHandoffV1_2,
} from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  digestPhaseAssignment,
  type HostModelCatalog,
} from "@kratos/runtime/domain/model-roles";
import { STOCK_GOTCHAS_TEMPLATE } from "@kratos/runtime/domain/memory";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import {
  claudeCatalog,
  codexCatalog,
  equalAliasInput,
  roleConfig,
} from "./support/model-routing.js";

const ROOT = "/project";
const TASKS = [
  "# Tasks",
  "",
  "## Ordered work",
  "",
  "### Work unit 1: Runtime",
  "",
  "#### Task 1.1: Bind handoff",
  "",
  "##### Files",
  "",
  "- `packages/runtime`",
  "",
  "##### Acceptance criteria",
  "",
  "- [ ] AC-1.1.1: The handoff is bound.",
  "",
  "##### Edge cases",
  "",
  "- [ ] AC-1.1.E1: Missing role is refused.",
  "",
  "## Out of scope",
  "",
  "- Prompt wording.",
].join("\n");
interface WorkflowSubject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
  readonly before: ReturnType<
    ReturnType<typeof memoryTransactionStorage>["snapshot"]
  >;
}

interface PhaseExecutionObservation {
  readonly assignmentDigest: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly provenance: "host-reported" | "unknown";
}

interface SubjectOptions {
  readonly launcherHost?: "claude-code" | "codex" | "unknown" | null;
  readonly configuration?: unknown;
  readonly catalogs?: "default" | "missing";
  readonly modelCatalogs?: readonly HostModelCatalog[];
}

function clearOutput(output: ReturnType<typeof recordingOutput>): void {
  (output.structured_ as string[]).splice(0);
  (output.human_ as string[]).splice(0);
}

function agentReplyWithExtraClaims(claims: Record<string, string>): string {
  const prose = Object.entries(claims)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `${prose}\n\n===KRATOS-AGENT-OUTPUT-V1===\n${JSON.stringify(
    {
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      agent: "prd",
      outcome: {
        status: "completed",
        next: "proceed",
        questions: [],
        blockers: [],
      },
      artifacts: [".brain/02-features/ship-handoff/00-prd.md"],
      changedFiles: [],
      memory: null,
      payload: {
        objective: "Ship one digest-bound phase result.",
        requirementIds: ["phase-execution-boundary"],
        gapIds: [],
      },
    },
    null,
    2,
  )}\n===END-KRATOS-AGENT-OUTPUT-V1===\n`;
}

function eventPath(subject: WorkflowSubject): string {
  const activeFeature =
    subject.storage.snapshot().files[".brain/02-features/active"];
  const feature = activeFeature?.trim() ?? "ship-handoff";
  return `.brain/02-features/${feature}/runs/run-01/events.jsonl`;
}

function lastEvent(subject: WorkflowSubject): EventV1_1 {
  const stream = subject.storage.snapshot().files[eventPath(subject)] ?? "";
  const line = stream.trim().split("\n").at(-1);
  if (line === undefined || line.length === 0) {
    throw new Error("The workflow has no event to inspect");
  }
  return JSON.parse(line) as EventV1_1;
}

async function currentHandoff(
  subject: WorkflowSubject,
): Promise<PhaseHandoffV1_2> {
  clearOutput(subject.output);
  expect(await runCommandLine(["--json", "handoff"], subject.ports)).toBe(0);
  const handoff = JSON.parse(
    subject.output.structured_.join(""),
  ) as PhaseHandoffV1_2;
  clearOutput(subject.output);
  return handoff;
}

function phaseResultRequest(
  subject: WorkflowSubject,
  handoff: PhaseHandoffV1_2,
  ref: string,
  reply: string,
  execution: PhaseExecutionObservation,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const correlationId = "agent-record-01";
  return {
    contractVersion: "1.1.0",
    hostContract: "1.1.0",
    messageId: "phase-result-01",
    messageType: "request",
    host: handoff.host,
    operation: `sdd.agent.record:${correlationId}`,
    capabilities: [],
    observedIdentity: {
      adapterVersion: "1.1.0",
      model: execution.model,
      effort: execution.effort,
    },
    payloadContract: "host.agent-output@1.2.0",
    payload: { ref, sha256: subject.ports.digests.sha256(reply) },
    phaseExecution: {
      assignmentDigest: execution.assignmentDigest,
      model: execution.model,
      effort: execution.effort,
    },
    correlationId,
    ...overrides,
  };
}

async function recordAgent(
  subject: WorkflowSubject,
  execution: Partial<PhaseExecutionObservation>,
  reply = agentReplyWithExtraClaims({}),
): Promise<OperationResultV1> {
  const handoff = await currentHandoff(subject);
  const ref = ".brain/agent-replies/prd.md";
  await subject.ports.fileSystem.write(ref, reply);
  const correlationId = "agent-record-01";
  const phaseExecution: PhaseExecutionObservation = {
    assignmentDigest: handoff.assignmentDigest,
    model: null,
    effort: null,
    provenance: "host-reported",
    ...execution,
  };
  const message = phaseResultRequest(
    subject,
    handoff,
    ref,
    reply,
    phaseExecution,
  );
  clearOutput(subject.output);
  await runCommandLine(
    ["--json", "agent", "record", ref, "--correlation-id", correlationId],
    {
      ...subject.ports,
      standardInput: pipedInput(`${JSON.stringify(message)}\n`),
    },
  );
  return JSON.parse(subject.output.structured_.join("")) as OperationResultV1;
}

function subject(
  options: SubjectOptions = {},
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
): WorkflowSubject {
  const host =
    options.launcherHost === undefined ? "codex" : options.launcherHost;
  const storage = memoryTransactionStorage({
    files: {
      ".brain/03-memory/gotchas.md": STOCK_GOTCHAS_TEMPLATE,
      ".brain/config.json": JSON.stringify(
        options.configuration ??
          roleConfig("codex", {
            planner: "planner-alias",
            implementer: { model: "impl-alias", effort: "high" },
            judge: "judge-alias",
          }),
      ),
      ...files,
    },
    directories,
  });
  const output = recordingOutput();
  const ports: RuntimePorts = {
    clock: fixedClock("2026-08-28T12:00:00.000Z"),
    ids: sequentialIds("handoff"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    fileSystem: storage.fileSystem,
    git: stubGit(),
    locks: {} as RuntimePorts["locks"],
    modelRouting:
      options.modelCatalogs !== undefined
        ? fixedModelRouting(options.modelCatalogs)
        : options.catalogs === "missing"
          ? fixedModelRouting([])
          : fixedModelRouting([claudeCatalog(), codexCatalog()]),
    environment: fixedEnvironment(
      host === null ? {} : { KRATOS_HOST: host },
      ROOT,
    ),
    output,
    standardInput: pipedInput(null),
    targetInspector: {
      capture: () =>
        Promise.resolve({
          inspect: (path) =>
            Promise.resolve({
              kind: "inside",
              lexicalPath: path,
              canonicalPath: path,
            }),
        }),
    },
    workspace: memoryWorkspace({ directories: [ROOT] }),
  };
  return { ports, storage, output, before: storage.snapshot() };
}

async function started(options: SubjectOptions = {}): Promise<WorkflowSubject> {
  const initialized = subject(options);
  expect(
    await runCommandLine(["objective", "Ship handoff"], initialized.ports),
  ).toBe(0);
  const afterObjective = initialized.storage.snapshot();
  const settledFiles = Object.fromEntries(
    Object.entries(afterObjective.files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
  const run = subject(
    {
      ...options,
      configuration:
        afterObjective.files[".brain/config.json"] === undefined
          ? options.configuration
          : JSON.parse(afterObjective.files[".brain/config.json"]),
    },
    settledFiles,
    afterObjective.directories.filter(
      (path) => !path.includes("/transactions/"),
    ),
  );
  expect(
    await runCommandLine(
      ["start", "--run-id", "run-01", "--correlation-id", "start-01"],
      run.ports,
    ),
  ).toBe(0);
  clearOutput(run.output);
  return { ...run, before: run.storage.snapshot() };
}

async function advanceToPhase(
  run: WorkflowSubject,
  completed: number,
): Promise<void> {
  const phases = [
    [".brain/02-features/ship-handoff/00-prd.md", "# PRD\n"],
    [".brain/02-features/ship-handoff/01-design.md", "# Design\n"],
    [".brain/02-features/ship-handoff/02-tasks.md", TASKS],
    [".brain/02-features/ship-handoff/code-summary.md", "Code complete.\n"],
    [".brain/02-features/ship-handoff/review-summary.md", "Review complete.\n"],
  ] as const;
  for (const [index, [ref, content]] of phases.slice(0, completed).entries()) {
    await run.ports.fileSystem.write(ref, content);
    expect(
      await runCommandLine(
        [
          "evidence",
          "record",
          ref,
          "--correlation-id",
          `evidence-${String(index)}`,
        ],
        run.ports,
      ),
    ).toBe(0);
    expect(
      await runCommandLine(
        [
          "continue",
          "--complete",
          "--artifact",
          ref,
          "--evidence",
          ref,
          "--correlation-id",
          `complete-${String(index)}`,
        ],
        run.ports,
      ),
    ).toBe(0);
  }
  clearOutput(run.output);
}

async function advanceToReview(run: WorkflowSubject): Promise<void> {
  await advanceToPhase(run, 4);
}

describe("read-only model-role handoffs", () => {
  it.each([
    ["prd", 0, false],
    ["spec", 1, false],
    ["plan", 2, false],
    ["code", 3, true],
    ["review", 4, true],
    ["acceptance", 5, false],
  ] as const)(
    "applies the legacy-memory guard only to the %s phase",
    async (phase, completed, guarded) => {
      const run = await started({
        configuration: {
          ...roleConfig("codex", {
            planner: "planner-alias",
            implementer: "impl-alias",
            judge: "judge-alias",
          }),
          policyMode: "standard",
        },
      });
      await advanceToPhase(run, completed);
      await run.ports.fileSystem.write(
        ".brain/03-memory/gotchas.md",
        "# Local legacy notes\n\nDo not lose this custom note.\n",
      );
      const before = run.storage.snapshot();

      const exit = await runCommandLine(["--json", "handoff"], run.ports);
      const result = JSON.parse(run.output.structured_.join("")) as {
        readonly reasonCode?: string;
        readonly phase?: string;
      };
      if (guarded) {
        expect(exit).not.toBe(0);
        expect(result).toMatchObject({
          reasonCode: "memory.migration_required",
          evidence: [{ kind: "artifact", ref: ".brain/03-memory/gotchas.md" }],
        });
      } else {
        expect(result.reasonCode).not.toBe("memory.migration_required");
        expect(exit).toBe(0);
        expect(result.phase).toBe(phase);
      }
      expect(run.storage.snapshot()).toEqual(before);
    },
  );

  it("returns the runtime-selected judge assignment for the review phase", async () => {
    const configuration = {
      ...roleConfig("codex", {
        planner: "planner-alias",
        implementer: { model: "impl-alias", effort: "high" },
        judge: { model: "judge-alias", effort: "high" },
      }),
      policyMode: "standard" as const,
    };
    const run = await started({ configuration });
    await advanceToReview(run);
    const before = run.storage.snapshot();

    expect(await runCommandLine(["--json", "handoff"], run.ports)).toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      phase: "review",
      assignment: {
        phase: "review",
        role: "judge",
        model: "judge-canonical",
        effort: "high",
      },
      assignmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown,
    });
    expect(run.storage.snapshot()).toEqual(before);
  });

  it("returns a canonical planner assignment and a digest without changing state", async () => {
    const run = await started();

    expect(await runCommandLine(["--json", "handoff"], run.ports)).toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      assignment: {
        phase: "prd",
        role: "planner",
        model: "planner-canonical",
        effort: "medium",
      },
      assignmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown,
    });
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it("maps malformed catalog output to a stable refusal without mutation", async () => {
    const run = await started();
    const malformed = {
      ...codexCatalog(),
      models: null,
    } as unknown as HostModelCatalog;

    expect(
      await runCommandLine(["--json", "handoff"], {
        ...run.ports,
        modelRouting: { observe: () => Promise.resolve(malformed) },
      }),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "model.resolution_unavailable",
      stateChanged: false,
    });
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it("maps the Claude Code launcher onto the Claude configuration host", async () => {
    const run = await started({
      launcherHost: "claude-code",
      configuration: roleConfig("claude", {
        planner: "planner-alias",
        implementer: "implementer",
        judge: "judge",
      }),
    });

    expect(await runCommandLine(["--json", "handoff"], run.ports)).toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      host: "claude",
      assignment: { model: "planner-canonical" },
    });
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it("renders the same resolved assignment in human mode", async () => {
    const run = await started();
    expect(await runCommandLine(["--json", "handoff"], run.ports)).toBe(0);
    const payload = JSON.parse(run.output.structured_.join("")) as {
      readonly assignment: { readonly model: string; readonly effort: string };
      readonly assignmentDigest: string;
    };
    clearOutput(run.output);

    expect(await runCommandLine(["handoff"], run.ports)).toBe(0);
    expect(run.output.structured_.join("")).toContain(
      `Assignment: planner ${payload.assignment.model} (${payload.assignment.effort})`,
    );
    expect(run.output.structured_.join("")).toContain(
      `Assignment digest: ${payload.assignmentDigest}`,
    );
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it.each([
    [
      "legacy configuration",
      { configuration: projectConfigV1 },
      "model.config_migration_required",
    ],
    [
      "missing host role map",
      {
        configuration: roleConfig("claude", {
          planner: "planner",
          implementer: "implementer",
          judge: "judge",
        }),
      },
      "model.host_missing",
    ],
    [
      "missing catalog",
      { catalogs: "missing" as const },
      "model.resolution_unavailable",
    ],
    [
      "unknown launcher",
      { launcherHost: "unknown" as const },
      "model.host_missing",
    ],
  ])("refuses %s without mutation", async (_label, options, reasonCode) => {
    const run = await started(options);

    expect(await runCommandLine(["--json", "handoff"], run.ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode,
      stateChanged: false,
    });
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it("names the missing mapped role without writing anything", async () => {
    const run = await started({
      configuration: roleConfig("codex", {
        planner: "planner",
        judge: "judge",
      }),
    });

    expect(await runCommandLine(["handoff"], run.ports)).not.toBe(0);
    expect(run.output.human_.join("")).toContain("implementer");
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it.each([
    ["code", 3],
    ["review", 4],
    ["acceptance", 5],
  ])(
    "requires planner even when the run has reached %s",
    async (_phase, completed) => {
      const run = await started({
        configuration: roleConfig("codex", {
          planner: "planner",
          implementer: "implementer",
          judge: "judge",
        }),
      });
      await advanceToPhase(run, completed);
      await run.ports.fileSystem.write(
        ".brain/config.json",
        JSON.stringify({
          ...roleConfig("codex", {
            implementer: "implementer",
            judge: "judge",
          }),
          policyMode: "standard",
        }),
      );
      const before = run.storage.snapshot();

      expect(await runCommandLine(["handoff"], run.ports)).not.toBe(0);
      expect(run.output.human_.join("")).toContain("planner");
      expect(run.storage.snapshot()).toEqual(before);
    },
  );

  it("names the invalid dependency role rather than the phase role", async () => {
    const run = await started({
      configuration: roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "unknown-judge-alias",
      }),
    });

    expect(await runCommandLine(["handoff"], run.ports)).not.toBe(0);
    expect(run.output.human_.join("")).toContain("judge");
    expect(run.output.human_.join("")).not.toContain("model-routing/planner");
    expect(run.storage.snapshot()).toEqual(run.before);
  });

  it.each([
    ["an absent launcher", null, "required"],
    ["an unsupported launcher", "unknown", "unsupported"],
  ] as const)(
    "reports %s with accepted launcher identities and no input echo",
    async (_label, launcherHost, cue) => {
      const run = await started({ launcherHost });

      expect(await runCommandLine(["handoff"], run.ports)).not.toBe(0);
      const rendered = run.output.human_.join("");
      expect(rendered).toContain(cue);
      expect(rendered).toContain("claude-code");
      expect(rendered).toContain("codex");
      expect(rendered).not.toContain("unknown");
      expect(run.storage.snapshot()).toEqual(run.before);
    },
  );

  it("binds the digest to the exact configuration bytes read after replacement", async () => {
    const run = await started();
    const replacement = {
      ...roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "judge",
      }),
      policyMode: "standard" as const,
    };
    const replacementText = JSON.stringify(replacement);
    const original = run.ports.durableFileSystem;
    let configInspections = 0;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...original,
        inspect: async (path) => {
          const entry = await original.inspect(path);
          if (path === ".brain/config.json" && ++configInspections === 2) {
            await run.ports.fileSystem.write(path, replacementText);
          }
          return entry;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(await runCommandLine(["--json", "handoff"], ports)).toBe(0);
    const payload = JSON.parse(run.output.structured_.join("")) as {
      readonly assignmentDigest: string;
    };
    expect(payload.assignmentDigest).toBe(
      digestPhaseAssignment(
        {
          configDigest: run.ports.digests.sha256(replacementText),
          runId: "run-01",
          revision: 1,
          host: "codex",
          assignment: {
            phase: "prd",
            role: "planner",
            model: "planner-canonical",
            effort: "medium",
          },
        },
        (canonical) => run.ports.digests.sha256(canonical),
      ),
    );
    expect(run.storage.snapshot().files[".brain/config.json"]).toBe(
      replacementText,
    );
    expect(run.storage.snapshot().files).toMatchObject({
      [".brain/02-features/ship-handoff/runs/run-01/events.jsonl"]:
        before.files[
          ".brain/02-features/ship-handoff/runs/run-01/events.jsonl"
        ],
      [".brain/02-features/ship-handoff/runs/run-01/state.json"]:
        before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    });
  });

  it("refuses deterministically when configuration disappears during resolution", async () => {
    const run = await started();
    const routing = run.ports.modelRouting;
    let deleted = false;
    const ports: RuntimePorts = {
      ...run.ports,
      modelRouting: {
        observe: async (host) => {
          const catalog = await routing.observe(host);
          if (!deleted) {
            deleted = true;
            await run.ports.fileSystem.remove(".brain/config.json");
          }
          return catalog;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(await runCommandLine(["--json", "handoff"], ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "guard.config_missing",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files).toMatchObject({
      [".brain/02-features/ship-handoff/runs/run-01/events.jsonl"]:
        before.files[
          ".brain/02-features/ship-handoff/runs/run-01/events.jsonl"
        ],
      [".brain/02-features/ship-handoff/runs/run-01/state.json"]:
        before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    });
  });

  it("refuses a handoff when phase and revision change during resolution", async () => {
    const run = await started();
    const routing = run.ports.modelRouting;
    let changed = false;
    let afterExternalChange: ReturnType<typeof run.storage.snapshot> | null =
      null;
    const mutatorPorts: RuntimePorts = {
      ...run.ports,
      modelRouting: routing,
    };
    const ports: RuntimePorts = {
      ...run.ports,
      modelRouting: {
        observe: async (host) => {
          const catalog = await routing.observe(host);
          if (!changed) {
            changed = true;
            const ref = ".brain/02-features/ship-handoff/00-prd.md";
            await run.ports.fileSystem.write(ref, "# External PRD\n");
            expect(
              await runCommandLine(
                [
                  "evidence",
                  "record",
                  ref,
                  "--correlation-id",
                  "external-evidence",
                ],
                mutatorPorts,
              ),
            ).toBe(0);
            expect(
              await runCommandLine(
                [
                  "continue",
                  "--complete",
                  "--artifact",
                  ref,
                  "--evidence",
                  ref,
                  "--correlation-id",
                  "external-change",
                ],
                mutatorPorts,
              ),
            ).toBe(0);
            afterExternalChange = run.storage.snapshot();
            clearOutput(run.output);
          }
          return catalog;
        },
      },
    };

    expect(await runCommandLine(["--json", "handoff"], ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "model.assignment_stale",
      stateChanged: false,
    });
    expect(afterExternalChange).not.toBeNull();
    expect(run.storage.snapshot()).toEqual(afterExternalChange);
  });

  it("refuses when configuration changes during the final run replay", async () => {
    const run = await started();
    const replacementText = JSON.stringify({
      ...roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "judge",
      }),
      policyMode: "standard" as const,
    });
    const events = ".brain/02-features/ship-handoff/runs/run-01/events.jsonl";
    const original = run.ports.durableFileSystem;
    let eventReads = 0;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...original,
        readText: async (path) => {
          const text = await original.readText(path);
          if (path === events && ++eventReads === 2) {
            await run.ports.fileSystem.write(
              ".brain/config.json",
              replacementText,
            );
          }
          return text;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(await runCommandLine(["--json", "handoff"], ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "model.assignment_stale",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[".brain/config.json"]).toBe(
      replacementText,
    );
    expect(run.storage.snapshot().files).toMatchObject({
      [events]: before.files[events],
      [".brain/02-features/ship-handoff/runs/run-01/state.json"]:
        before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    });
  });

  it("refuses when selected run identity changes during the final replay", async () => {
    const run = await started();
    const events = ".brain/02-features/ship-handoff/runs/run-01/events.jsonl";
    const activeRun = ".brain/02-features/ship-handoff/active-run";
    const original = run.ports.durableFileSystem;
    let eventReads = 0;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...original,
        readText: async (path) => {
          const text = await original.readText(path);
          if (path === events && ++eventReads === 2) {
            await run.ports.fileSystem.write(activeRun, "run-replaced\n");
          }
          return text;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(await runCommandLine(["--json", "handoff"], ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "model.assignment_stale",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[activeRun]).toBe("run-replaced\n");
    expect(run.storage.snapshot().files).toMatchObject({
      [events]: before.files[events],
      [".brain/02-features/ship-handoff/runs/run-01/state.json"]:
        before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    });
  });

  it.each([
    [
      "an unknown alias",
      roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "missing",
      }),
      "model.resolution_unavailable",
    ],
    [
      "an unsupported effort",
      roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: { model: "judge", effort: "low" },
      }),
      "model.effort_unsupported",
    ],
  ])(
    "refuses %s without mutation",
    async (_label, configuration, reasonCode) => {
      const run = await started({ configuration });

      expect(await runCommandLine(["--json", "handoff"], run.ports)).not.toBe(
        0,
      );
      expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
        reasonCode,
        stateChanged: false,
      });
      expect(run.storage.snapshot()).toEqual(run.before);
    },
  );

  it("refuses aliases that resolve the implementer and judge to one canonical model", async () => {
    const input = equalAliasInput("prd");
    const run = await started({
      configuration: input.configuration,
      modelCatalogs: [input.catalog],
    });

    expect(await runCommandLine(["--json", "handoff"], run.ports)).not.toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "model.independence_violation",
    });
    expect(run.storage.snapshot()).toEqual(run.before);
  });
});

describe("phase execution trust boundary", () => {
  it("writes runtime resolution and excludes forged agent prose", async () => {
    const run = await started();
    const reply = agentReplyWithExtraClaims({
      role: "implementer",
      model: "forged-model",
      effort: "low",
    });

    expect(
      await recordAgent(
        run,
        { model: null, effort: null, provenance: "host-reported" },
        reply,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    expect(lastEvent(run)).toMatchObject({
      resolvedAssignment: {
        phase: "prd",
        role: "planner",
        model: "planner-canonical",
        effort: "medium",
      },
      observedIdentity: { host: "codex", model: null, effort: null },
    });
    expect(run.storage.snapshot().files[eventPath(run)]).not.toContain(
      "forged-model",
    );
  });

  it("persists each host-reported canonical execution field", async () => {
    const run = await started();

    expect(
      await recordAgent(run, {
        model: "planner-canonical",
        effort: "medium",
        provenance: "host-reported",
      }),
    ).toMatchObject({ reasonCode: "trail.ok" });
    expect(lastEvent(run)).toMatchObject({
      observedIdentity: {
        host: "codex",
        model: "planner-canonical",
        effort: "medium",
      },
    });
  });

  it.each([
    [
      "stale digest",
      { assignmentDigest: "0".repeat(64) },
      "model.assignment_stale",
    ],
    [
      "wrong observed model",
      { model: "other-model" },
      "model.execution_mismatch",
    ],
    ["wrong observed effort", { effort: "low" }, "model.execution_mismatch"],
  ] as const)(
    "blocks %s without changing event or snapshot bytes",
    async (_label, execution, reasonCode) => {
      const run = await started();
      const before = run.storage.snapshot();

      expect(await recordAgent(run, execution)).toMatchObject({
        reasonCode,
        stateChanged: false,
      });
      expect(run.storage.snapshot().files[eventPath(run)]).toBe(
        before.files[eventPath(run)],
      );
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/ship-handoff/runs/run-01/state.json"
        ],
      ).toBe(
        before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
      );
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/ship-handoff/runs/run-01/agent-output/prd.json"
        ],
      ).toBeUndefined();
    },
  );

  it("keeps direct CLI --model diagnostic-only and records unknown execution", async () => {
    const run = await started();
    const ref = ".brain/agent-replies/prd.md";
    await run.ports.fileSystem.write(ref, agentReplyWithExtraClaims({}));
    clearOutput(run.output);

    expect(
      await runCommandLine(
        [
          "agent",
          "record",
          ref,
          "--correlation-id",
          "direct-agent-record",
          "--host",
          "codex",
          "--model",
          "user-declared-model",
        ],
        run.ports,
      ),
    ).toBe(0);
    expect(lastEvent(run)).toMatchObject({
      observedIdentity: { host: "codex", model: null, effort: null },
    });
    expect(run.storage.snapshot().files[eventPath(run)]).not.toContain(
      "user-declared-model",
    );
  });

  it("rejects malformed adapter stdin before reading agent content", async () => {
    const run = await started();
    const ref = ".brain/agent-replies/prd.md";
    await run.ports.fileSystem.write(ref, agentReplyWithExtraClaims({}));
    const original = run.ports.durableFileSystem;
    let replyReads = 0;
    const before = run.storage.snapshot();
    clearOutput(run.output);

    expect(
      await runCommandLine(
        [
          "--json",
          "agent",
          "record",
          ref,
          "--correlation-id",
          "malformed-envelope",
        ],
        {
          ...run.ports,
          standardInput: pipedInput("{not-json\n"),
          durableFileSystem: {
            ...original,
            readText: async (path) => {
              if (path === ref) replyReads += 1;
              return original.readText(path);
            },
          },
        },
      ),
    ).not.toBe(0);
    expect(replyReads).toBe(0);
    expect(run.storage.snapshot()).toEqual(before);
  });

  it.each([
    ["operation", { operation: "sdd.agent.record:other" }],
    ["correlation", { correlationId: "other-correlation" }],
    [
      "payload ref",
      {
        payload: {
          ref: ".brain/agent-replies/other.md",
          sha256: "a".repeat(64),
        },
      },
    ],
    [
      "payload digest",
      {
        payload: {
          ref: ".brain/agent-replies/prd.md",
          sha256: "0".repeat(64),
        },
      },
    ],
  ] as const)(
    "rejects a mismatched adapter %s before reading agent content",
    async (_label, overrides) => {
      const run = await started();
      const handoff = await currentHandoff(run);
      const ref = ".brain/agent-replies/prd.md";
      const reply = agentReplyWithExtraClaims({});
      await run.ports.fileSystem.write(ref, reply);
      const execution: PhaseExecutionObservation = {
        assignmentDigest: handoff.assignmentDigest,
        model: null,
        effort: null,
        provenance: "host-reported",
      };
      const original = run.ports.durableFileSystem;
      let replyReads = 0;
      const before = run.storage.snapshot();
      clearOutput(run.output);

      expect(
        await runCommandLine(
          [
            "--json",
            "agent",
            "record",
            ref,
            "--correlation-id",
            "agent-record-01",
          ],
          {
            ...run.ports,
            standardInput: pipedInput(
              JSON.stringify(
                phaseResultRequest(
                  run,
                  handoff,
                  ref,
                  reply,
                  execution,
                  overrides,
                ),
              ),
            ),
            durableFileSystem: {
              ...original,
              readText: async (path) => {
                if (path === ref) replyReads += 1;
                return original.readText(path);
              },
            },
          },
        ),
      ).not.toBe(0);
      expect(
        JSON.parse(run.output.structured_.join("")) as OperationResultV1,
      ).toMatchObject({
        reasonCode: "trail.output_invalido",
        stateChanged: false,
      });
      expect(replyReads).toBe(0);
      expect(run.storage.snapshot()).toEqual(before);
    },
  );

  it("revalidates configuration after reading a digest-bound reply", async () => {
    const run = await started();
    const oldHandoff = await currentHandoff(run);
    const replacement = JSON.stringify(
      roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "judge",
      }),
    );
    const ref = ".brain/agent-replies/prd.md";
    const original = run.ports.durableFileSystem;
    let replaced = false;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...original,
        readText: async (path) => {
          const content = await original.readText(path);
          if (path === ref && !replaced) {
            replaced = true;
            await run.ports.fileSystem.write(".brain/config.json", replacement);
          }
          return content;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(
      await recordAgent(
        { ...run, ports },
        { assignmentDigest: oldHandoff.assignmentDigest },
      ),
    ).toMatchObject({
      reasonCode: "model.assignment_stale",
      stateChanged: false,
    });
    expect(replaced).toBe(true);
    expect(run.storage.snapshot().files[eventPath(run)]).toBe(
      before.files[eventPath(run)],
    );
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/ship-handoff/runs/run-01/state.json"
      ],
    ).toBe(
      before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    );
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/ship-handoff/runs/run-01/agent-output/prd.json"
      ],
    ).toBeUndefined();
  });

  it("revalidates the assignment digest immediately before append", async () => {
    const run = await started();
    const events = eventPath(run);
    const original = run.ports.durableFileSystem;
    const replacement = JSON.stringify(
      roleConfig("codex", {
        planner: "planner",
        implementer: "implementer",
        judge: "judge",
      }),
    );
    let eventReads = 0;
    let replaced = false;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...original,
        readText: async (path) => {
          const content = await original.readText(path);
          if (path === events && ++eventReads === 6) {
            replaced = true;
            await run.ports.fileSystem.write(".brain/config.json", replacement);
          }
          return content;
        },
      },
    };
    const before = run.storage.snapshot();

    expect(await recordAgent({ ...run, ports }, {})).toMatchObject({
      reasonCode: "model.assignment_stale",
      stateChanged: false,
    });
    expect(replaced).toBe(true);
    expect(run.storage.snapshot().files[events]).toBe(before.files[events]);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/ship-handoff/runs/run-01/state.json"
      ],
    ).toBe(
      before.files[".brain/02-features/ship-handoff/runs/run-01/state.json"],
    );
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/ship-handoff/runs/run-01/agent-output/prd.json"
      ],
    ).toBeUndefined();
  });
});
