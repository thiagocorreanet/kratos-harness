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
) {
  const storage = memoryTransactionStorage({ files, directories });
  return {
    storage,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({}),
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

async function started() {
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
    await runCommandLine(["objective", "Ship hooks"], objective.ports),
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
  it("trips a run budget and keeps the latch on an identical retry", async () => {
    const base = await started();
    const files = settled(base);
    const feature = files[".brain/02-features/active"]?.trim() ?? "";
    const featurePath = `.brain/02-features/${feature}/state.json`;
    const state = JSON.parse(files[featurePath] ?? "") as {
      objective: { budget?: { tokens: number } };
    };
    state.objective.budget = { tokens: 100 };
    files[featurePath] = `${JSON.stringify(state, null, 2)}\n`;
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
      diagnostic: "failed at /project/src/file.ts",
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
      failure,
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
      settled(base),
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
