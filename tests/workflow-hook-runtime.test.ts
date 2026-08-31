import type { GateFactsV1, RunUsageV1 } from "@kratos/contracts";
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
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { claudeCatalog } from "./support/model-routing.js";

const ROOT = "/project";
const NOW = "2026-08-28T12:00:00.000Z";

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
  piped: string | null = null,
  localFiles: Readonly<Record<string, string>> = {},
) {
  const storage = memoryTransactionStorage({ files, directories });
  return {
    storage,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem(localFiles),
      environment: fixedEnvironment({}, ROOT),
      git: stubGit(),
      modelRouting: fixedModelRouting([claudeCatalog()]),
      output: recordingOutput(),
      standardInput: pipedInput(piped),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

function settled(run: ReturnType<typeof subject>) {
  return Object.fromEntries(
    Object.entries(run.storage.snapshot().files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
}

function withRunningMeasurement(
  files: Readonly<Record<string, string>>,
  sessionId = "session-a",
): Record<string, string> {
  const feature = files[".brain/02-features/active"]?.trim() ?? "";
  const runId = files[`.brain/02-features/${feature}/active-run`]?.trim() ?? "";
  return {
    ...files,
    ".brain/03-memory/task_log.jsonl": `${JSON.stringify({
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      feature,
      runId,
      phase: "prd",
      sessionId,
      contributingSessionIds: [sessionId],
      correlationId: "correlation-a",
      status: "running",
      startedAt: NOW,
      endedAt: null,
      durationMs: null,
      baselineGrossTokens: 0,
      finalGrossTokens: null,
      grossTokens: 0,
      assignmentDigest: "a".repeat(64),
      resolvedAssignment: {
        host: "claude",
        role: "planner",
        model: "claude-planner",
        effort: "medium",
      },
      observedIdentity: { model: null, effort: null },
      closeReason: null,
      updatedAt: NOW,
    })}\n`,
  };
}

async function started(tokenCeiling: number | null = null) {
  const initialized = subject(
    {},
    [".brain", ".brain/transactions"],
    JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude"],
      language: {
        conversation: "en",
        documentation: "en",
        comments: "en",
        identifiers: "en",
        commits: "en",
        preserveConventions: true,
        enforcement: "advisory",
      },
      policyMode: "strict",
      snapshots: true,
    }),
  );
  expect(await runCommandLine(["init"], initialized.ports)).toBe(0);
  const objective = subject(
    settled(initialized),
    initialized.storage.snapshot().directories,
  );
  expect(
    await runCommandLine(
      [
        "objective",
        "Ship hooks",
        ...(tokenCeiling === null
          ? []
          : ["--token-ceiling", String(tokenCeiling)]),
      ],
      objective.ports,
    ),
  ).toBe(0);
  const start = subject(
    settled(objective),
    objective.storage.snapshot().directories,
  );
  expect(
    await runCommandLine(["start", "--host", "claude-code"], start.ports),
  ).toBe(0);
  return start;
}

function hookRun(
  files: Readonly<Record<string, string>>,
  directories: readonly string[],
  observation: object,
  suffix: string,
) {
  const hookKind = (observation as { readonly kind: string }).kind;
  const artifact = `.brain/03-memory/.cache/hooks/session-a/${suffix}.json`;
  const staged = `${JSON.stringify(observation, null, 2)}\n`;
  const temporary = memoryTransactionStorage({ files: {}, directories: [] });
  const message = {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: `message-${suffix}`,
    correlationId: "correlation-a",
    operationId: "operation-a",
    sequence: 1,
    occurredAt: NOW,
    kind: "hook",
    payload: {
      host: "claude-code",
      hook: hookKind,
      phase: hookKind === "tool.before" ? "before" : "after",
      artifact: { ref: artifact, sha256: temporary.digests.sha256(staged) },
    },
  };
  return subject(
    { ...files, [artifact]: staged },
    directories,
    JSON.stringify(message),
  );
}

describe("workflow hook runtime", () => {
  it.each([
    {
      name: "ignores a budget added after an unbounded run starts",
      frozen: null,
      current: 100,
      sampled: 100,
      exhausted: false,
    },
    {
      name: "keeps a budget removed after a bounded run starts",
      frozen: 100,
      current: null,
      sampled: 100,
      exhausted: true,
    },
    {
      name: "keeps a lower frozen budget after the objective budget increases",
      frozen: 100,
      current: 200,
      sampled: 100,
      exhausted: true,
    },
    {
      name: "keeps a higher frozen budget after the objective budget decreases",
      frozen: 100,
      current: 50,
      sampled: 50,
      exhausted: false,
    },
  ])("$name", async ({ frozen, current, sampled, exhausted }) => {
    const base = await started(frozen);
    const files = withRunningMeasurement(settled(base));
    const feature = files[".brain/02-features/active"]?.trim() ?? "";
    const featurePath = `.brain/02-features/${feature}/state.json`;
    const state = JSON.parse(files[featurePath] ?? "") as {
      objective: { budget?: { tokens: number } };
    };
    if (current === null) delete state.objective.budget;
    else state.objective.budget = { tokens: current };
    files[featurePath] = `${JSON.stringify(state, null, 2)}\n`;

    const sampledRun = hookRun(
      files,
      base.storage.snapshot().directories,
      {
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        kind: "session.sample",
        sessionId: "session-a",
        occurredAt: NOW,
        usage: { cumulativeGrossTokens: sampled },
      },
      `frozen-${String(frozen)}-current-${String(current)}`,
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], sampledRun.ports),
    ).toBe(0);

    const after = settled(sampledRun);
    const runId =
      after[`.brain/02-features/${feature}/active-run`]?.trim() ?? "";
    const gatesText =
      after[`.brain/02-features/${feature}/runs/${runId}/gates.json`];
    const observedExhaustion =
      gatesText === undefined
        ? false
        : (JSON.parse(gatesText) as GateFactsV1).stopLoss.exhausted;
    expect(observedExhaustion).toBe(exhausted);
  });

  it("trips a run budget and keeps the latch on an identical retry", async () => {
    const base = await started(100);
    const files = withRunningMeasurement(settled(base));
    const feature = files[".brain/02-features/active"]?.trim() ?? "";
    const observation = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "session.sample",
      sessionId: "session-a",
      occurredAt: NOW,
      usage: { cumulativeGrossTokens: 100 },
    };
    const first = hookRun(
      files,
      base.storage.snapshot().directories,
      observation,
      "sample-one",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], first.ports),
    ).toBe(0);
    const after = settled(first);
    const runId =
      after[`.brain/02-features/${feature}/active-run`]?.trim() ?? "";
    const runRoot = `.brain/02-features/${feature}/runs/${runId}`;
    const usage = JSON.parse(
      after[`${runRoot}/usage.json`] ?? "",
    ) as RunUsageV1;
    const gates = JSON.parse(
      after[`${runRoot}/gates.json`] ?? "",
    ) as GateFactsV1;
    expect(usage.totalGrossTokens).toBe(100);
    expect(gates.stopLoss).toEqual({ tripped: false, exhausted: true });

    const retry = hookRun(
      after,
      first.storage.snapshot().directories,
      observation,
      "sample-retry",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], retry.ports),
    ).toBe(0);
    const retried = settled(retry);
    expect(JSON.parse(retried[`${runRoot}/usage.json`] ?? "")).toEqual(usage);
    expect(
      (JSON.parse(retried[`${runRoot}/gates.json`] ?? "") as GateFactsV1)
        .stopLoss,
    ).toEqual({ tripped: false, exhausted: true });

    const unlock = subject(
      retried,
      retry.storage.snapshot().directories,
      `UNLOCK ${runId}\n`,
    );
    expect(
      await runCommandLine(
        ["unlock", "stop-loss", "--run", runId],
        unlock.ports,
      ),
    ).toBe(0);
    const unlocked = settled(unlock);
    expect(
      (JSON.parse(unlocked[`${runRoot}/usage.json`] ?? "") as RunUsageV1).epoch,
    ).toEqual({
      number: 2,
      baselineGrossTokens: 100,
      exhaustedAt: null,
    });
    expect(
      (JSON.parse(unlocked[`${runRoot}/gates.json`] ?? "") as GateFactsV1)
        .stopLoss,
    ).toEqual({ tripped: false, exhausted: false });
  });

  it("persists one candidate for identical repeated failures", async () => {
    const base = await started();
    const failure = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "tool.failed",
      sessionId: "session-a",
      occurredAt: NOW,
      toolUseId: "tool-a",
      toolFamily: "shell",
      failureClass: "nonzero_exit",
      exitCode: 1,
      diagnostic:
        "\u001b[31mfailed at /project/src/file.ts on 2026-08-28T12:00:00.000Z\u001b[0m",
      usage: null,
    };
    const first = hookRun(
      settled(base),
      base.storage.snapshot().directories,
      failure,
      "failure-one",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], first.ports),
    ).toBe(0);
    const second = hookRun(
      settled(first),
      first.storage.snapshot().directories,
      {
        ...failure,
        diagnostic:
          "failed at /project/src/file.ts on 2026-08-28T12:01:00.000Z",
      },
      "failure-two",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], second.ports),
    ).toBe(0);
    const candidates = Object.keys(settled(second)).filter((path) =>
      path.startsWith(".brain/03-memory/candidates/"),
    );
    expect(candidates).toHaveLength(1);
  });

  it("captures a manual proposal once without changing curated memory", async () => {
    const base = await started();
    const proposal = `${JSON.stringify({
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      observation: "Deploy command failed at 2026-08-28T12:00:00.000Z",
    })}\n`;
    const first = subject(
      settled(base),
      base.storage.snapshot().directories,
      null,
      { "proposal.json": proposal },
    );
    expect(
      await runCommandLine(["memory", "capture", "proposal.json"], first.ports),
    ).toBe(0);

    const second = subject(
      settled(first),
      first.storage.snapshot().directories,
      null,
      { "proposal.json": proposal },
    );
    expect(
      await runCommandLine(
        ["memory", "capture", "proposal.json"],
        second.ports,
      ),
    ).toBe(0);

    const files = settled(second);
    expect(
      Object.keys(files).filter((path) =>
        path.startsWith(".brain/03-memory/candidates/"),
      ),
    ).toHaveLength(1);
    expect(files[".brain/03-memory/curated-memory.json"]).toBeDefined();
    expect(files[".brain/03-memory/gotchas.md"]).toBeDefined();
    expect(
      (
        JSON.parse(files[".brain/03-memory/curated-memory.json"] ?? "") as {
          confirmed: unknown[];
        }
      ).confirmed,
    ).toEqual([]);

    const listed = subject(files, second.storage.snapshot().directories);
    expect(await runCommandLine(["memory", "list"], listed.ports)).toBe(0);
    expect(settled(listed)).toEqual(files);
  });

  it("bounds automatic and manual candidate diagnostics by UTF-8 bytes", async () => {
    const base = await started();
    const diagnostic = "😀".repeat(1024);
    const automatic = hookRun(
      settled(base),
      base.storage.snapshot().directories,
      {
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        kind: "tool.failed",
        sessionId: "session-a",
        occurredAt: NOW,
        toolUseId: "tool-unicode",
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic,
        usage: null,
      },
      "unicode",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], automatic.ports),
    ).toBe(0);
    const automaticCandidate = Object.entries(settled(automatic)).find(
      ([path]) => path.startsWith(".brain/03-memory/candidates/"),
    );
    expect(automaticCandidate).toBeDefined();
    expect(
      Buffer.byteLength(
        (JSON.parse(automaticCandidate?.[1] ?? "") as { diagnostic: string })
          .diagnostic,
        "utf8",
      ),
    ).toBeLessThanOrEqual(2048);

    const manual = subject(
      settled(automatic),
      automatic.storage.snapshot().directories,
      null,
      {
        "proposal.json": `${JSON.stringify({
          contractVersion: "1.2.0",
          hostContract: "1.2.0",
          observation: diagnostic,
        })}\n`,
      },
    );
    expect(
      await runCommandLine(
        ["memory", "capture", "proposal.json"],
        manual.ports,
      ),
    ).toBe(0);
    const manualCandidate = Object.entries(settled(manual)).find(
      ([path, text]) =>
        path.startsWith(".brain/03-memory/candidates/") &&
        (JSON.parse(text) as { toolFamily: string }).toolFamily === "other",
    );
    expect(
      Buffer.byteLength(
        (JSON.parse(manualCandidate?.[1] ?? "") as { diagnostic: string })
          .diagnostic,
        "utf8",
      ),
    ).toBeLessThanOrEqual(2048);
  });

  it("rejects invalid manual proposals without promotion", async () => {
    const base = await started();
    const invalid = subject(
      settled(base),
      base.storage.snapshot().directories,
      null,
      { "proposal.json": "{}\n" },
    );
    expect(
      await runCommandLine(
        ["memory", "capture", "proposal.json"],
        invalid.ports,
      ),
    ).toBe(2);
    expect(settled(invalid)).toEqual(settled(base));
  });

  it("matches a readable legacy candidate whose ID differs from normalized identity", async () => {
    const base = await started();
    const files = settled(base);
    const legacyPath = `.brain/03-memory/candidates/${"a".repeat(64)}.json`;
    files[legacyPath] = `${JSON.stringify({
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      candidateId: "a".repeat(64),
      toolFamily: "other",
      failureClass: "unknown",
      exitCode: null,
      diagnostic: "Deploy failed at 2026-08-28T12:00:00.000+03:00",
      firstObservedAt: NOW,
    })}\n`;
    const manual = subject(files, base.storage.snapshot().directories, null, {
      "proposal.json": `${JSON.stringify({
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        observation: "Deploy failed at 2026-08-28T12:01:00.000+03:00",
      })}\n`,
    });

    expect(
      await runCommandLine(
        ["memory", "capture", "proposal.json"],
        manual.ports,
      ),
    ).toBe(0);
    const candidates = Object.keys(settled(manual)).filter((path) =>
      path.startsWith(".brain/03-memory/candidates/"),
    );
    expect(candidates).toEqual([legacyPath]);
  });

  it("finalizes session telemetry and clears transient files", async () => {
    const base = await started();
    const sample = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "session.sample",
      sessionId: "session-a",
      occurredAt: NOW,
      usage: { cumulativeGrossTokens: 42 },
    };
    const sampled = hookRun(
      withRunningMeasurement(settled(base)),
      base.storage.snapshot().directories,
      sample,
      "sample",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], sampled.ports),
    ).toBe(0);
    const ended = hookRun(
      settled(sampled),
      sampled.storage.snapshot().directories,
      { ...sample, kind: "session.end" },
      "end",
    );
    expect(
      await runCommandLine(["hook", "--host", "claude-code"], ended.ports),
    ).toBe(0);
    const files = settled(ended);
    expect(
      JSON.parse(files[".brain/03-memory/telemetry/session-a.json"] ?? ""),
    ).toMatchObject({ grossTokens: 42, toolFailures: 0 });
    expect(
      Object.keys(files).filter((path) =>
        path.startsWith(".brain/03-memory/.cache/hooks/session-a/"),
      ),
    ).toEqual([]);
  });
});
