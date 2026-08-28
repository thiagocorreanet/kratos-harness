import goldenV1 from "./fixtures/events/golden-event-v1.json" with { type: "json" };

import type {
  EventV1,
  MigrationV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
} from "@kratos/contracts";
import { applyPlan, TransactionFailure } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { observeMigration } from "@kratos/runtime/composition/migration";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  authorizeMigration,
  completeMigration,
  plannedMigration,
} from "@kratos/runtime/domain/migration";
import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  type CommandObservation,
  type Decision,
} from "@kratos/runtime/domain/cli";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { renderResultJson } from "@kratos/runtime/domain/result";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  recordingOutput,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts, StandardInput } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

const ROOT = "/project";
const CONFIG_REF = ".brain/config.json";
const EVENTS_REF = ".brain/02-features/sample-feature/runs/run-01/events.jsonl";
const SNAPSHOT_REF = ".brain/02-features/sample-feature/runs/run-01/state.json";

const LEGACY_CONFIG: ProjectConfigV1 = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  pluginVersion: "0.0.0-development",
  hostContract: "1.0.0",
  language: "pt-BR",
  policyMode: "strict",
  managedState: {
    directory: ".brain",
    eventLog: "events.jsonl",
    snapshots: true,
  },
};

// Deliberately not canonicalized: migration and rollback must preserve these
// exact source bytes, including indentation and the final blank line.
const LEGACY_CONFIG_BYTES = `${JSON.stringify(LEGACY_CONFIG, null, 4)}\n\n`;

const ANSWERS = JSON.stringify({
  contractVersion: "1.1.0",
  hostContract: "1.1.0",
  hosts: ["claude", "codex"],
});

const EXPLICIT_ANSWERS = JSON.stringify({
  contractVersion: "1.1.0",
  hostContract: "1.1.0",
  hosts: ["codex"],
  modelRoles: {
    codex: {
      planner: "planner-alias",
      implementer: { model: "impl-alias", effort: "medium" },
      judge: "judge-alias",
    },
  },
});

function goldenEventBytes(): string {
  const event: EventV1 = {
    ...(JSON.parse(goldenV1.unsignedCanonical) as Omit<EventV1, "eventHash">),
    eventHash: goldenV1.eventHash,
  };
  return `${canonicalizeJson(event)}\n`;
}

function snapshotBytes(): string {
  return `${JSON.stringify(
    {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      projectId: "project-01",
      runId: "run-01",
      status: "active",
      currentStep: "code",
      eventCursor: 1,
      eventHash: goldenV1.eventHash,
      policyVersion: "policy-01",
      lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:01:00Z",
    },
    null,
    2,
  )}\n`;
}

function queuedInput(...documents: readonly (string | null)[]): StandardInput {
  const queue = [...documents];
  return {
    read: () => Promise.resolve(queue.shift() ?? null),
  };
}

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
  pending?: {
    readonly observation: Extract<
      CommandObservation,
      { readonly kind: "migration" }
    >;
    readonly ports: RuntimePorts;
    readonly planDigest: string;
  };
}

function legacyProjectWithHistory(
  answers: readonly (string | null)[] = [ANSWERS],
  modelRouting = fixedModelRouting([claudeCatalog(), codexCatalog()]),
  additions: Readonly<Record<string, string>> = {},
  answerFiles: Readonly<Record<string, string>> = {},
): Subject {
  const storage = memoryTransactionStorage({
    directories: [".brain/transactions"],
    files: {
      [CONFIG_REF]: LEGACY_CONFIG_BYTES,
      [EVENTS_REF]: goldenEventBytes(),
      [SNAPSHOT_REF]: snapshotBytes(),
      ".brain/02-features/sample-feature/01-prd.md": "# Original PRD\n",
      ".brain/approvals/approval-01.json": '{"approved":true}\n',
      ".brain/evidence/evidence-01.json": '{"kind":"test"}\n',
      ...additions,
    },
  });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock("2026-08-28T12:00:00.000Z"),
      ids: sequentialIds("transaction"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem(answerFiles),
      git: { observe: () => Promise.reject(new Error("unused")) },
      locks: {} as RuntimePorts["locks"],
      modelRouting,
      environment: fixedEnvironment({}, ROOT),
      output,
      standardInput: queuedInput(...answers),
      targetInspector: {
        capture: () =>
          Promise.resolve({
            inspect: (path) =>
              Promise.resolve({
                kind: "inside" as const,
                lexicalPath: path,
                canonicalPath: path,
              }),
          }),
      },
      workspace: memoryWorkspace({ directories: [ROOT] }),
    },
  };
}

async function previewConfigMigration(run: Subject): Promise<{
  readonly planDigest: string;
  readonly decision: Decision;
}> {
  const parsed = parseInvocation(["migrate", "config"], DEFAULT_REGISTRY);
  if (parsed.kind === "result") throw new Error("config migration not parsed");
  const observed = await observeMigration(
    parsed.invocation,
    run.ports,
    createSchemaRegistry(),
  );
  if (observed.kind === "failure") throw new Error(observed.result.reasonCode);
  if (
    observed.observation.kind !== "migration" ||
    observed.observation.operation.kind !== "config"
  ) {
    throw new Error("config migration not observed");
  }
  const decision = dispatch({
    ...parsed.invocation,
    observation: observed.observation,
  });
  const planDigest = observed.observation.operation.planDigest;
  run.pending = {
    observation: observed.observation,
    ports: observed.ports,
    planDigest,
  };
  return { planDigest, decision };
}

async function applyConfigMigration(
  run: Subject,
  planDigest: string,
): Promise<{ readonly reasonCode: string }> {
  const pending = run.pending;
  if (pending === undefined || pending.planDigest !== planDigest) {
    throw new Error("preview digest not pending");
  }
  const parsed = parseInvocation(
    ["migrate", "config", "--yes"],
    DEFAULT_REGISTRY,
  );
  if (parsed.kind === "result") throw new Error("config migration not parsed");
  const decision = dispatch({
    ...parsed.invocation,
    observation: pending.observation,
  });
  try {
    await applyPlan(decision.plan, pending.ports);
    return { reasonCode: decision.result.reasonCode };
  } catch (error) {
    if (!(error instanceof TransactionFailure)) throw error;
    return { reasonCode: error.reasonCode };
  }
}

async function mutateConfigAfterPreview(run: Subject): Promise<void> {
  await run.storage.fileSystem.write(
    CONFIG_REF,
    LEGACY_CONFIG_BYTES.replace("\n\n", " \n"),
  );
}

function migrationRoot(files: Readonly<Record<string, string>>): string {
  const receipt = Object.keys(files).find((path) =>
    /^\.brain\/migrations\/[^/]+\/receipt\.json$/u.test(path),
  );
  if (receipt === undefined) throw new Error("migration receipt missing");
  return receipt.slice(0, -"/receipt.json".length);
}

describe("configuration migration", () => {
  it("migrates only config and preserves every historical byte", async () => {
    const run = legacyProjectWithHistory();
    const before = run.storage.snapshot().files;

    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
      run.output.human_.join(""),
    ).toBe(0);

    const after = run.storage.snapshot().files;
    expect(JSON.parse(after[CONFIG_REF] ?? "null")).toMatchObject({
      stateContract: "1.1.0",
      language: "pt-BR",
      policyMode: "strict",
      modelRoles: expect.any(Object) as unknown,
    });
    for (const [path, content] of Object.entries(before)) {
      if (path !== CONFIG_REF) expect(after[path], path).toBe(content);
    }
  });

  it("previews every default and exact write without mutation", async () => {
    const run = legacyProjectWithHistory();
    const before = run.storage.snapshot();

    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);

    expect(run.storage.snapshot()).toEqual(before);
    const preview = run.output.structured_.join("");
    expect(preview).toContain("Source SHA-256:");
    expect(preview).toContain("Destination SHA-256:");
    expect(preview).toContain("Confirmed hosts: claude, codex");
    for (const assignment of [
      "claude.planner = planner-canonical@medium (defaulted)",
      "claude.implementer = implementer-canonical@high (defaulted)",
      "claude.judge = judge-canonical@medium (defaulted)",
      "codex.planner = planner-canonical@medium (defaulted)",
      "codex.implementer = implementer-canonical@high (defaulted)",
      "codex.judge = judge-canonical@medium (defaulted)",
    ]) {
      expect(preview).toContain(assignment);
    }
    for (const path of [
      ".brain/config.json",
      "/backup/config.json",
      "/authorization.json",
      "/rollback.json",
      "/receipt.json",
      "/verification.json",
    ]) {
      expect(preview).toContain(path);
    }
  });

  it("refuses changed source instead of silently replanning after preview", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS]);
    const preview = await previewConfigMigration(run);
    await mutateConfigAfterPreview(run);

    expect(await applyConfigMigration(run, preview.planDigest)).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
    expect(run.storage.snapshot().files[CONFIG_REF]).toContain(" \n");
    expect(
      Object.keys(run.storage.snapshot().files).filter((path) =>
        path.startsWith(".brain/migrations/"),
      ),
    ).toEqual([]);
  });

  it("requires answers to confirm hosts even when host surfaces exist", async () => {
    const run = legacyProjectWithHistory([null], undefined, {
      ".claude/settings.json": "{}\n",
      ".codex/config.toml": "model = 'anything'\n",
    });
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
    ).not.toBe(0);

    expect(run.storage.snapshot()).toEqual(before);
  });

  it("reads explicit host confirmation from --answers", async () => {
    const run = legacyProjectWithHistory(
      [null],
      undefined,
      {},
      { "migration.json": EXPLICIT_ANSWERS },
    );

    expect(
      await runCommandLine(
        ["migrate", "config", "--answers", "migration.json", "--yes"],
        run.ports,
      ),
    ).toBe(0);

    expect(
      (
        JSON.parse(
          run.storage.snapshot().files[CONFIG_REF] ?? "null",
        ) as ProjectConfigV1_1
      ).modelRoles,
    ).toHaveProperty("codex");
  });

  it("normalizes explicit roles and lets them override adapter defaults", async () => {
    const run = legacyProjectWithHistory([EXPLICIT_ANSWERS]);

    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
    ).toBe(0);

    const migrated = JSON.parse(
      run.storage.snapshot().files[CONFIG_REF] ?? "null",
    ) as ProjectConfigV1_1;
    expect(migrated.modelRoles).toEqual({
      codex: {
        planner: { model: "planner-canonical", effort: "medium" },
        implementer: { model: "implementer-canonical", effort: "medium" },
        judge: { model: "judge-canonical", effort: "medium" },
      },
    });
    expect(run.output.structured_.join("")).not.toContain(
      "modelRoles.codex.planner",
    );
  });

  it.each([
    {
      label: "invalid answers",
      answers: JSON.stringify({
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
        hosts: [],
      }),
      routing: fixedModelRouting([codexCatalog()]),
    },
    {
      label: "missing catalog",
      answers: JSON.stringify({
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
        hosts: ["codex"],
      }),
      routing: fixedModelRouting([]),
    },
    {
      label: "equal implementer and judge defaults",
      answers: JSON.stringify({
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
        hosts: ["codex"],
      }),
      routing: fixedModelRouting([
        {
          ...codexCatalog(),
          defaults: {
            ...codexCatalog().defaults,
            judge: codexCatalog().defaults.implementer,
          },
        },
      ]),
    },
  ])("writes nothing for $label", async ({ answers, routing }) => {
    const run = legacyProjectWithHistory([answers], routing);
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
    ).not.toBe(0);

    expect(run.storage.snapshot()).toEqual(before);
  });

  it("treats a current configuration as an idempotent no-op", async () => {
    const first = legacyProjectWithHistory();
    expect(
      await runCommandLine(["migrate", "config", "--yes"], first.ports),
    ).toBe(0);
    const settled = first.storage.snapshot().files;
    const current = legacyProjectWithHistory([null], undefined, settled);
    await current.storage.fileSystem.write(
      CONFIG_REF,
      settled[CONFIG_REF] ?? "missing",
    );
    const before = current.storage.snapshot();

    expect(
      await runCommandLine(["--json", "migrate", "config"], current.ports),
    ).toBe(0);

    expect(current.storage.snapshot()).toEqual(before);
    expect(JSON.parse(current.output.structured_.join(""))).toMatchObject({
      stateChanged: false,
    });
  });

  it("writes a verified receipt and rollback restores exact original bytes", async () => {
    const run = legacyProjectWithHistory([ANSWERS]);
    const before = run.storage.snapshot().files;
    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
    ).toBe(0);
    const migrated = run.storage.snapshot().files;
    const root = migrationRoot(migrated);
    const receipt = JSON.parse(
      migrated[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;

    expect(receipt).toMatchObject({
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      sourceContract: "1.0.0",
      destinationContract: "1.1.0",
      status: "completed",
      rollback: {
        kind: "replace",
        backupRef: `${root}/backup/config.json`,
        destinationRef: CONFIG_REF,
      },
    });
    expect(migrated[`${root}/backup/config.json`]).toBe(LEGACY_CONFIG_BYTES);
    expect(receipt.backupDigest).toBe(
      run.storage.digests.sha256(LEGACY_CONFIG_BYTES),
    );
    expect(receipt.verificationRefs).toEqual([`${root}/verification.json`]);
    expect(
      Object.keys(migrated)
        .filter((path) => path.startsWith(`${root}/`))
        .map((path) => path.slice(root.length + 1))
        .sort(),
    ).toEqual([
      "authorization.json",
      "backup/config.json",
      "receipt.json",
      "rollback.json",
      "verification.json",
    ]);

    expect(
      await runCommandLine(
        ["migrate", "rollback", receipt.migrationId],
        run.ports,
      ),
    ).toBe(0);

    const rolledBack = run.storage.snapshot().files;
    expect(rolledBack[CONFIG_REF]).toBe(LEGACY_CONFIG_BYTES);
    expect(
      JSON.parse(rolledBack[`${root}/receipt.json`] ?? "null"),
    ).toMatchObject({ status: "rolled-back" });
    for (const [path, content] of Object.entries(before)) {
      expect(rolledBack[path], path).toBe(content);
    }
  });

  it("refuses rollback after destination drift", async () => {
    const run = legacyProjectWithHistory();
    expect(
      await runCommandLine(["migrate", "config", "--yes"], run.ports),
    ).toBe(0);
    const migrated = run.storage.snapshot().files;
    const root = migrationRoot(migrated);
    const receipt = JSON.parse(
      migrated[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    const drift = `${migrated[CONFIG_REF] ?? ""} `;
    await run.storage.fileSystem.write(CONFIG_REF, drift);
    const parsed = parseInvocation(
      ["--json", "migrate", "rollback", receipt.migrationId],
      DEFAULT_REGISTRY,
    );
    if (parsed.kind === "result") throw new Error("rollback not parsed");
    const observation = await observeMigration(
      parsed.invocation,
      run.ports,
      createSchemaRegistry(),
    );
    expect(observation).toMatchObject({
      kind: "failure",
      result: { reasonCode: "runtime.revision_conflict" },
    });
    if (observation.kind === "failure") {
      expect(() => renderResultJson(observation.result)).not.toThrow();
    }

    expect(
      await runCommandLine(
        ["--json", "migrate", "rollback", receipt.migrationId],
        run.ports,
      ),
    ).not.toBe(0);

    expect(run.storage.snapshot().files[CONFIG_REF]).toBe(drift);
    expect(run.storage.snapshot().files[`${root}/receipt.json`]).toBe(
      migrated[`${root}/receipt.json`],
    );
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
  });

  it.each(["backup", "receipt"] as const)(
    "refuses rollback when the %s cannot verify",
    async (target) => {
      const run = legacyProjectWithHistory();
      expect(
        await runCommandLine(["migrate", "config", "--yes"], run.ports),
      ).toBe(0);
      const migrated = run.storage.snapshot().files;
      const root = migrationRoot(migrated);
      const receipt = JSON.parse(
        migrated[`${root}/receipt.json`] ?? "null",
      ) as MigrationV1_1;
      await run.storage.fileSystem.write(
        target === "backup"
          ? `${root}/backup/config.json`
          : `${root}/receipt.json`,
        '{"tampered":true}\n',
      );
      const current = run.storage.snapshot().files[CONFIG_REF];

      expect(
        await runCommandLine(
          ["migrate", "rollback", receipt.migrationId],
          run.ports,
        ),
      ).not.toBe(0);

      expect(run.storage.snapshot().files[CONFIG_REF]).toBe(current);
    },
  );

  it("preserves the legacy Brain rollback as delete-only", () => {
    const root = ".brain/migrations/brain-01";
    const planned = plannedMigration({
      migrationId: "brain-01",
      sourceContract: "go-v3@0.6.5",
      planDigest: "1".repeat(64),
      authorizationRef: `${root}/authorization.json`,
      backupDigest: "2".repeat(64),
      conversions: [
        {
          payloadContract: "artifact:example",
          sourceDigest: "3".repeat(64),
          destinationDigest: "3".repeat(64),
        },
      ],
      rollbackRef: `${root}/rollback.json`,
      now: "2026-08-28T12:00:00.000Z",
    });
    const authorized = authorizeMigration(
      planned,
      planned.planDigest,
      planned.authorizationRef,
      planned.createdAt,
    );
    if (authorized === null) throw new Error("authorization failed");
    const receipt = completeMigration(
      authorized,
      [".brain/copied.json"],
      planned.createdAt,
    );
    if (receipt === null) throw new Error("completion failed");
    const parsed = parseInvocation(
      ["migrate", "rollback", "brain-01"],
      DEFAULT_REGISTRY,
    );
    if (parsed.kind === "result") throw new Error("rollback not parsed");

    const decision = dispatch({
      ...parsed.invocation,
      observation: {
        kind: "migration",
        operation: {
          kind: "rollback",
          migrationId: "brain-01",
          receipt,
          targets: [".brain/copied.json"],
          replacement: null,
          now: "2026-08-28T12:01:00.000Z",
        },
      },
    });

    expect(decision.plan.effects).toEqual([
      { kind: "delete_file", path: ".brain/copied.json" },
      {
        kind: "write_file",
        path: `${root}/receipt.json`,
        content: expect.stringContaining('"status": "rolled-back"') as string,
      },
    ]);
  });
});
