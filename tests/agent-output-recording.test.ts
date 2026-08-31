import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentOutputV1,
  AgentOutputV1_3,
  EventV1,
} from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import type { Result } from "@kratos/runtime/domain/result";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
} from "@kratos/runtime/domain/agent";
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
import type { RuntimePorts } from "@kratos/runtime/ports";
import { beforeAll, describe, expect, it } from "vitest";
import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const replyRoot = join(repositoryRoot, "fixtures/agent-output/v1/replies");
const ROOT = "/project";
const NOW = "2026-08-18T09:00:00.000Z";
const TEXT = "Ship the refund pipeline";
const FEATURE = "ship-the-refund-pipeline";
const RUN_ROOT = `.brain/02-features/${FEATURE}/runs`;
const REPLY = `.brain/02-features/${FEATURE}/agent-reply.md`;
const registry = createSchemaRegistry();

const PRD_BLOCK = {
  contractVersion: "1.3.0",
  hostContract: "1.3.0",
  agent: "prd",
  outcome: {
    status: "completed",
    next: "proceed",
    questions: [],
    blockers: [],
  },
  artifacts: [`.brain/02-features/${FEATURE}/00-prd.md`],
  changedFiles: [],
  memory: null,
  payload: {
    objective: TEXT,
    requirementIds: ["req-refund-window"],
    gapIds: [],
  },
} as const satisfies AgentOutputV1_3;

/** One agent reply: prose, an ordinary fenced example, then the machine block. */
function reply(block: unknown = PRD_BLOCK): string {
  return [
    "# Product requirements",
    "",
    "The requirements document is written.",
    "",
    "```json",
    '{ "note": "this fenced example is prose, not the machine block" }',
    "```",
    "",
    AGENT_BLOCK_OPEN,
    JSON.stringify(block, null, 2),
    AGENT_BLOCK_CLOSE,
    "",
  ].join("\n");
}

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
  piped: string | null = null,
): Subject {
  const storage = memoryTransactionStorage({ files, directories });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({}),
      environment: fixedEnvironment({ KRATOS_HOST: "claude-code" }, ROOT),
      git: stubGit(),
      modelRouting: fixedModelRouting([claudeCatalog(), codexCatalog()]),
      output,
      standardInput: pipedInput(piped),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

function settled(run: Subject): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(run.storage.snapshot().files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
}

function next(
  run: Subject,
  written: Readonly<Record<string, string>> = {},
): Subject {
  const snapshot = run.storage.snapshot();
  return subject(
    { ...settled(run), ...written },
    snapshot.directories.filter((path) => !path.includes("/transactions/")),
  );
}

async function startedRun(): Promise<Subject> {
  const initialized = subject(
    {},
    [".brain", ".brain/transactions"],
    JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude", "codex"],
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
    }),
  );
  expect(await runCommandLine(["init"], initialized.ports)).toBe(0);
  const objective = next(initialized);
  expect(await runCommandLine(["objective", TEXT], objective.ports)).toBe(0);
  const started = next(objective);
  expect(
    await runCommandLine(["start", "--host", "claude-code"], started.ports),
  ).toBe(0);
  return started;
}

function runId(run: Subject): string {
  const path = Object.keys(settled(run)).find(
    (candidate) =>
      candidate.startsWith(RUN_ROOT) && candidate.endsWith("/state.json"),
  );
  if (path === undefined) throw new Error("the run wrote no snapshot");
  return path.slice(RUN_ROOT.length + 1, path.lastIndexOf("/"));
}

function outputPath(run: Subject, agent: string): string {
  return `${RUN_ROOT}/${runId(run)}/agent-output/${agent}.json`;
}

function events(run: Subject): readonly EventV1[] {
  return (settled(run)[`${RUN_ROOT}/${runId(run)}/events.jsonl`] ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as EventV1);
}

/** Record one reply against a started run and report what the runtime said. */
async function record(
  run: Subject,
  text: string,
  options: { readonly host?: string; readonly correlationId?: string } = {},
): Promise<{
  readonly exitCode: number;
  readonly result: Result;
  readonly after: Subject;
}> {
  const recording = next(run, { [REPLY]: text });
  const exitCode = await runCommandLine(
    [
      "--json",
      "agent",
      "record",
      REPLY,
      "--correlation-id",
      options.correlationId ?? "agent-first",
      "--host",
      options.host ?? "claude-code",
    ],
    recording.ports,
  );
  return {
    exitCode,
    result: JSON.parse(recording.output.structured_.join("")) as Result,
    after: next(recording),
  };
}

let started: Subject;

beforeAll(async () => {
  started = await startedRun();
});

describe("recording one agent reply", () => {
  it("extracts the machine block past an ordinary fenced example", async () => {
    const { exitCode, result, after } = await record(started, reply());
    expect(exitCode).toBe(0);
    expect(result.reasonCode).toBe("trail.ok");
    expect(result.stateChanged).toBe(true);
    expect(JSON.parse(settled(after)[outputPath(after, "prd")] ?? "")).toEqual(
      PRD_BLOCK,
    );
  });

  it("persists exactly the block the validator accepted", async () => {
    const { after } = await record(started, reply());
    const persisted = settled(after)[outputPath(after, "prd")] ?? "";
    const validated = registry.validate({
      id: "host.agent-output",
      version: "1.3.0",
      value: JSON.parse(persisted) as unknown,
      structuralReasonCode: "trail.output_invalido",
    });
    if (validated.kind !== "valid")
      throw new Error("state does not round-trip");
    expect(validated.value).toEqual(PRD_BLOCK);
    // Byte equality too: a derived view reads the recorded document, so a
    // re-serialization that reordered keys would still be a contract change.
    expect(persisted).toBe(`${JSON.stringify(PRD_BLOCK, null, 2)}\n`);
  });

  it("appends one fact event that does not move the run", async () => {
    const { after } = await record(started, reply());
    const recorded = events(after).at(-1);
    expect(recorded?.reasonCode).toBe("run.agent.recorded");
    expect(recorded?.effect).toBe("state-and-artifact");
    expect(
      JSON.parse(
        settled(after)[`${RUN_ROOT}/${runId(after)}/state.json`] ?? "",
      ),
    ).toMatchObject({ status: "active", currentStep: "prd" });
  });

  it("treats a repeated delivery as already recorded", async () => {
    const first = await record(started, reply());
    const again = await record(first.after, reply());
    expect(again.exitCode).toBe(0);
    expect(again.result.stateChanged).toBe(false);
  });

  it("reads the same reply identically whichever host relayed it", async () => {
    const claude = await record(started, reply(), { host: "claude-code" });
    const codex = await record(started, reply().split("\n").join("\r\n"), {
      host: "codex",
    });
    expect(codex.exitCode).toBe(claude.exitCode);
    expect(codex.result.reasonCode).toBe(claude.result.reasonCode);
    expect(settled(codex.after)[outputPath(codex.after, "prd")]).toBe(
      settled(claude.after)[outputPath(claude.after, "prd")],
    );
  });
});

describe("replies the runtime refuses to route on", () => {
  it("reports a reply with no machine block without advancing the run", async () => {
    const text = await readFile(join(replyRoot, "absent.md"), "utf8");
    const { exitCode, result, after } = await record(started, text);
    expect(exitCode).toBe(3);
    expect(result.reasonCode).toBe("trail.output_invalido");
    expect(result.stateChanged).toBe(false);
    expect(result.why).toEqual(["The reply carries no machine block."]);
    expect(settled(after)[outputPath(after, "prd")]).toBeUndefined();
    expect(
      events(after).some((e) => e.reasonCode === "run.agent.recorded"),
    ).toBe(false);
  });

  it("names the parse failure of a malformed block", async () => {
    const text = await readFile(join(replyRoot, "malformed.md"), "utf8");
    const { exitCode, result } = await record(started, text);
    expect(exitCode).toBe(3);
    expect(result.reasonCode).toBe("trail.output_invalido");
    expect(result.why).toEqual([
      "The machine block is not a single JSON document.",
    ]);
  });

  it("names the offending path of a schema-invalid block", async () => {
    const text = reply({
      ...PRD_BLOCK,
      outcome: { ...PRD_BLOCK.outcome, status: "unknown" },
    });
    const { exitCode, result } = await record(started, text);
    expect(exitCode).toBe(3);
    expect(result.reasonCode).toBe("trail.output_invalido");
    expect(result.why[0]).toContain("outcome.status");
  });

  it("refuses a block whose agent is not the phase the run is in", async () => {
    const { exitCode, result } = await record(
      started,
      reply({
        ...PRD_BLOCK,
        agent: "review",
        payload: { verdict: "pass", findings: [] },
        memory: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: "a".repeat(64),
          lessonIds: [],
        },
      }),
    );
    expect(exitCode).toBe(3);
    expect(result.why).toEqual([
      "The review agent addressed a run in the prd phase.",
    ]);
  });

  it("refuses a block that contradicts itself", async () => {
    const { exitCode, result } = await record(
      started,
      reply({
        ...PRD_BLOCK,
        changedFiles: [
          { ref: `.brain/02-features/${FEATURE}/00-prd.md`, change: "added" },
        ],
      }),
    );
    expect(exitCode).toBe(3);
    expect(result.why).toEqual([
      "A path is listed both as a written artifact and as a changed file.",
    ]);
  });

  it("fails closed when recorded output no longer satisfies its contract", async () => {
    const first = await record(started, reply());
    const corrupted = next(first.after, {
      [outputPath(first.after, "prd")]: "{}\n",
    });
    expect(
      await runCommandLine(
        ["--json", "agent", "record", REPLY, "--correlation-id", "second"],
        next(corrupted, { [REPLY]: reply() }).ports,
      ),
    ).toBe(4);
  });

  it("reads a valid predecessor output from an active run without migration", async () => {
    const first = await record(started, reply());
    const legacy: AgentOutputV1 = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      agent: "prd",
      outcome: PRD_BLOCK.outcome,
      artifacts: PRD_BLOCK.artifacts,
      changedFiles: PRD_BLOCK.changedFiles,
      payload: PRD_BLOCK.payload,
    };
    const active = next(first.after, {
      [outputPath(first.after, "prd")]: `${JSON.stringify(legacy, null, 2)}\n`,
    });

    expect(await runCommandLine(["--json", "handoff"], active.ports)).toBe(0);
    expect(JSON.parse(active.output.structured_.join(""))).toMatchObject({
      contractVersion: "1.3.0",
      phase: "prd",
    });
  });

  it("refuses to record against a project with no active run", async () => {
    const bare = subject({ [REPLY]: reply() }, [
      ".brain",
      ".brain/transactions",
    ]);
    expect(
      await runCommandLine(["--json", "agent", "record", REPLY], bare.ports),
    ).not.toBe(0);
  });
});
