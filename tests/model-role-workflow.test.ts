import projectConfigV1 from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  digestPhaseAssignment,
  type HostModelCatalog,
} from "@kratos/runtime/domain/model-roles";
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

function subject(
  options: SubjectOptions = {},
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
): WorkflowSubject {
  const host =
    options.launcherHost === undefined ? "codex" : options.launcherHost;
  const storage = memoryTransactionStorage({
    files: {
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
        configuration: {
          ...roleConfig("codex", {
            implementer: "implementer",
            judge: "judge",
          }),
          policyMode: "standard",
        },
      });
      await advanceToPhase(run, completed);
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
