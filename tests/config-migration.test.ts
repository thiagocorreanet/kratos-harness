import goldenV1 from "./fixtures/events/golden-event-v1.json" with { type: "json" };

import type {
  EventV1,
  MigrationV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
} from "@kratos/contracts";
import { applyPlan } from "@kratos/runtime/composition";
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
}

function legacyProjectWithHistory(
  answers: readonly (string | null)[] = [ANSWERS, ANSWERS],
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

interface PreviewAuthorization {
  readonly planDigest: string;
  readonly planTime: string;
}

function authorizedArguments(
  authorization: PreviewAuthorization,
  prefix: readonly string[] = [],
): readonly string[] {
  return [
    "migrate",
    "config",
    ...prefix,
    "--yes",
    "--plan-digest",
    authorization.planDigest,
    "--plan-time",
    authorization.planTime,
  ];
}

function previewAuthorization(output: string): PreviewAuthorization {
  const digest = /^Plan digest: ([a-f0-9]{64})$/mu.exec(output)?.[1];
  const planTime = /^Plan time: (\S+)$/mu.exec(output)?.[1];
  if (digest === undefined || planTime === undefined) {
    throw new Error(`migration authorization missing from preview:\n${output}`);
  }
  return { planDigest: digest, planTime };
}

async function runAuthorizedConfigMigration(
  run: Subject,
  prefix: readonly string[] = [],
): Promise<number> {
  const before = run.output.structured_.length;
  const previewArgs = ["migrate", "config", ...prefix];
  const previewExit = await runCommandLine(previewArgs, run.ports);
  if (previewExit !== 0) return previewExit;
  const preview = run.output.structured_.slice(before).join("");
  const authorization = previewAuthorization(preview);
  expect(preview).toContain(
    `kratos migrate config${prefix.length === 0 ? "" : ` ${prefix.join(" ")}`} --yes --plan-digest ${authorization.planDigest} --plan-time ${authorization.planTime}`,
  );
  return runCommandLine(authorizedArguments(authorization, prefix), run.ports);
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

async function migrateAndRollback(run: Subject): Promise<{
  readonly root: string;
  readonly receipt: MigrationV1_1;
}> {
  expect(await runAuthorizedConfigMigration(run)).toBe(0);
  const migrated = run.storage.snapshot().files;
  const root = migrationRoot(migrated);
  const receipt = JSON.parse(
    migrated[`${root}/receipt.json`] ?? "null",
  ) as MigrationV1_1;
  expect(
    await runCommandLine(
      ["migrate", "rollback", receipt.migrationId],
      run.ports,
    ),
  ).toBe(0);
  return { root, receipt };
}

async function observedConfigMigrationId(run: Subject): Promise<string> {
  const parsed = parseInvocation(["migrate", "config"], DEFAULT_REGISTRY);
  if (parsed.kind === "result") throw new Error("config migration not parsed");
  const observed = await observeMigration(
    parsed.invocation,
    run.ports,
    createSchemaRegistry(),
  );
  if (
    observed.kind !== "observed" ||
    observed.observation.kind !== "migration" ||
    observed.observation.operation.kind !== "config"
  ) {
    throw new Error("config migration not observed");
  }
  return observed.observation.operation.migrationId;
}

describe("configuration migration", () => {
  it("migrates only config and preserves every historical byte", async () => {
    const run = legacyProjectWithHistory();
    const before = run.storage.snapshot().files;

    expect(
      await runAuthorizedConfigMigration(run),
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
    expect(preview).toContain("Answers stdin SHA-256:");
    expect(preview).toContain("Catalog claude SHA-256:");
    expect(preview).toContain("Catalog codex SHA-256:");
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
    expect(preview.match(/^- .* sha256=[a-f0-9]{64}$/gmu)).toHaveLength(6);
    expect(preview).toContain("Plan time: 2026-08-28T12:00:00.000Z");
  });

  it("binds the plan digest to every exact write byte and plan timestamp", async () => {
    const run = legacyProjectWithHistory();
    const parsed = parseInvocation(["migrate", "config"], DEFAULT_REGISTRY);
    if (parsed.kind === "result")
      throw new Error("config migration not parsed");
    const observed = await observeMigration(
      parsed.invocation,
      run.ports,
      createSchemaRegistry(),
    );
    if (
      observed.kind !== "observed" ||
      observed.observation.kind !== "migration" ||
      observed.observation.operation.kind !== "config"
    ) {
      throw new Error("config migration not observed");
    }
    const operation = observed.observation.operation;

    expect(operation.writes).toHaveLength(6);
    for (const write of operation.writes) {
      expect(write.sha256, write.path).toBe(
        run.storage.digests.sha256(write.content),
      );
    }
    expect(operation.planDigest).toBe(
      run.storage.digests.sha256(
        canonicalizeJson({
          kind: "project-config-write-set",
          migrationId: operation.migrationId,
          planTime: operation.now,
          writes: operation.writes.map(({ path, sha256 }) => ({
            path,
            sha256,
          })),
        }),
      ),
    );
    for (const name of [
      "authorization.json",
      "receipt.json",
      "verification.json",
    ]) {
      expect(
        operation.writes.find(({ path }) => path.endsWith(name))?.content,
        name,
      ).toContain(operation.now);
    }
  });

  it("refuses changed source instead of silently replanning after preview", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS]);
    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);
    const preview = previewAuthorization(run.output.structured_.join(""));
    await mutateConfigAfterPreview(run);

    expect(
      await runCommandLine(
        ["--json", ...authorizedArguments(preview)],
        run.ports,
      ),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
    expect(run.storage.snapshot().files[CONFIG_REF]).toContain(" \n");
    expect(
      Object.keys(run.storage.snapshot().files).filter((path) =>
        path.startsWith(".brain/migrations/"),
      ),
    ).toEqual([]);
  });

  it("requires caller-carried preview authorization for apply", async () => {
    const run = legacyProjectWithHistory();
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["--json", "migrate", "config", "--yes"], run.ports),
    ).not.toBe(0);

    expect(run.storage.snapshot()).toEqual(before);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "trail.uso",
    });
  });

  it("refuses answer drift against a prior CLI preview", async () => {
    const run = legacyProjectWithHistory([ANSWERS, EXPLICIT_ANSWERS]);
    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);
    const preview = previewAuthorization(run.output.structured_.join(""));

    expect(
      await runCommandLine(
        ["--json", ...authorizedArguments(preview)],
        run.ports,
      ),
    ).not.toBe(0);
    expect(run.storage.snapshot().files[CONFIG_REF]).toBe(LEGACY_CONFIG_BYTES);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
  });

  it("binds authorization to exact answer bytes even when semantics match", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ` ${ANSWERS}\n`]);
    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);
    const preview = previewAuthorization(run.output.structured_.join(""));

    expect(
      await runCommandLine(
        ["--json", ...authorizedArguments(preview)],
        run.ports,
      ),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
  });

  it("refuses catalog drift against a prior CLI preview", async () => {
    let changed = false;
    const original = codexCatalog();
    const altered = {
      ...original,
      models: original.models.map((model, index) =>
        index === 0
          ? { ...model, aliases: [...model.aliases, "new-planner-alias"] }
          : model,
      ),
    };
    const run = legacyProjectWithHistory(
      [
        JSON.stringify({
          contractVersion: "1.1.0",
          hostContract: "1.1.0",
          hosts: ["codex"],
        }),
        JSON.stringify({
          contractVersion: "1.1.0",
          hostContract: "1.1.0",
          hosts: ["codex"],
        }),
      ],
      {
        observe: (host) =>
          Promise.resolve(
            host === "codex" ? (changed ? altered : original) : null,
          ),
      },
    );
    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);
    const preview = previewAuthorization(run.output.structured_.join(""));
    changed = true;

    expect(
      await runCommandLine(
        ["--json", ...authorizedArguments(preview)],
        run.ports,
      ),
    ).not.toBe(0);
    expect(run.storage.snapshot().files[CONFIG_REF]).toBe(LEGACY_CONFIG_BYTES);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
  });

  it("requires answers to confirm hosts even when host surfaces exist", async () => {
    const run = legacyProjectWithHistory([null], undefined, {
      ".claude/settings.json": "{}\n",
      ".codex/config.toml": "model = 'anything'\n",
    });
    const before = run.storage.snapshot();

    expect(await runAuthorizedConfigMigration(run)).not.toBe(0);

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
      await runAuthorizedConfigMigration(run, ["--answers", "migration.json"]),
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
    const run = legacyProjectWithHistory([EXPLICIT_ANSWERS, EXPLICIT_ANSWERS]);

    expect(await runAuthorizedConfigMigration(run)).toBe(0);

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

    expect(await runAuthorizedConfigMigration(run)).not.toBe(0);

    expect(run.storage.snapshot()).toEqual(before);
  });

  it("treats a current configuration as an idempotent no-op", async () => {
    const first = legacyProjectWithHistory();
    expect(await runAuthorizedConfigMigration(first)).toBe(0);
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
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS]);
    const before = run.storage.snapshot().files;
    expect(await runAuthorizedConfigMigration(run)).toBe(0);
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

  it.each([
    "rollback.json",
    "verification.json",
    "backup/config.json",
    "receipt.json",
    "destination",
  ])(
    "refuses a %s swap between rollback validation and apply preconditions",
    async (target) => {
      const run = legacyProjectWithHistory();
      expect(await runAuthorizedConfigMigration(run)).toBe(0);
      const migrated = run.storage.snapshot().files;
      const root = migrationRoot(migrated);
      const receipt = JSON.parse(
        migrated[`${root}/receipt.json`] ?? "null",
      ) as MigrationV1_1;
      const parsed = parseInvocation(
        ["migrate", "rollback", receipt.migrationId],
        DEFAULT_REGISTRY,
      );
      if (parsed.kind === "result") throw new Error("rollback not parsed");
      const observed = await observeMigration(
        parsed.invocation,
        run.ports,
        createSchemaRegistry(),
      );
      if (observed.kind === "failure") {
        throw new Error(observed.result.reasonCode);
      }
      const decision = dispatch({
        ...parsed.invocation,
        observation: observed.observation,
      });
      const targetPath =
        target === "destination" ? CONFIG_REF : `${root}/${target}`;
      await run.storage.fileSystem.write(targetPath, '{"swapped":true}\n');

      await expect(
        applyPlan(decision.plan, observed.ports),
      ).rejects.toMatchObject({
        reasonCode: "runtime.revision_conflict",
      });
      expect(run.storage.snapshot().files[targetPath]).toBe(
        '{"swapped":true}\n',
      );
    },
  );

  it.each([
    "rollback.json",
    "verification.json",
    "backup/config.json",
    "receipt.json",
    "destination",
  ])("refuses %s drift during its stable rollback read", async (target) => {
    const run = legacyProjectWithHistory();
    expect(await runAuthorizedConfigMigration(run)).toBe(0);
    const migrated = run.storage.snapshot().files;
    const root = migrationRoot(migrated);
    const receipt = JSON.parse(
      migrated[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    const targetPath =
      target === "destination" ? CONFIG_REF : `${root}/${target}`;
    const durable = run.ports.durableFileSystem;
    let swapped = false;
    const driftingPorts: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...durable,
        readText: async (path) => {
          const content = await durable.readText(path);
          if (path === targetPath && !swapped) {
            swapped = true;
            await run.storage.fileSystem.write(path, '{"reread-drift":true}\n');
          }
          return content;
        },
      },
    };

    expect(
      await runCommandLine(
        ["--json", "migrate", "rollback", receipt.migrationId],
        driftingPorts,
      ),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
    expect(run.storage.snapshot().files[targetPath]).toBe(
      '{"reread-drift":true}\n',
    );
  });

  it.each([
    "../x",
    "x/y",
    "x\\y",
    ".",
    "..",
    "%2f",
    "x\u2215y",
    "x\u2044y",
    "x-",
    "a".repeat(129),
    "a:b",
    "C:relative",
    "con",
    "CON",
    "con.txt",
    "PrN.json",
    "AUX.log",
    "nul.anything",
    "COM1",
    "com9.receipt",
    "LPT1",
    "lPt9.audit",
  ])(
    "rejects noncanonical rollback id %s before observing paths",
    async (migrationId) => {
      const run = legacyProjectWithHistory([null]);
      let inspections = 0;
      const durable = run.ports.durableFileSystem;
      const guardedPorts: RuntimePorts = {
        ...run.ports,
        durableFileSystem: {
          ...durable,
          inspect: (path) => {
            inspections += 1;
            return durable.inspect(path);
          },
        },
      };

      expect(
        await runCommandLine(
          ["--json", "migrate", "rollback", migrationId],
          guardedPorts,
        ),
      ).not.toBe(0);
      expect(inspections).toBe(0);
      expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject(
        { reasonCode: "trail.uso" },
      );
    },
  );

  it.each(["brain.v1", "migration@2026-08-28", "legacy_config-01"])(
    "accepts portable legacy migration id %s for observation",
    async (migrationId) => {
      const run = legacyProjectWithHistory([null]);
      let inspections = 0;
      const durable = run.ports.durableFileSystem;
      const guardedPorts: RuntimePorts = {
        ...run.ports,
        durableFileSystem: {
          ...durable,
          inspect: (path) => {
            inspections += 1;
            return durable.inspect(path);
          },
        },
      };

      expect(
        await runCommandLine(
          ["--json", "migrate", "rollback", migrationId],
          guardedPorts,
        ),
      ).not.toBe(0);
      expect(inspections).toBeGreaterThan(0);
      expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject(
        { reasonCode: "runtime.state_corrupt" },
      );
    },
  );

  it("rejects a schema-valid forged prior receipt", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    const receipt = JSON.parse(
      run.storage.snapshot().files[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    await run.storage.fileSystem.write(
      `${root}/receipt.json`,
      `${JSON.stringify({ ...receipt, planDigest: "f".repeat(64) }, null, 2)}\n`,
    );
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["--json", "migrate", "config"], run.ports),
    ).not.toBe(0);
    expect(run.storage.snapshot()).toEqual(before);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it.each([
    "authorization.json",
    "rollback.json",
    "verification.json",
    "backup/config.json",
  ])("rejects a tampered prior %s during retry preview", async (target) => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    await run.storage.fileSystem.write(
      `${root}/${target}`,
      '{"tampered":true}\n',
    );
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["--json", "migrate", "config"], run.ports),
    ).not.toBe(0);
    expect(run.storage.snapshot()).toEqual(before);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("rejects a missing prior audit companion", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    await run.storage.fileSystem.remove(`${root}/authorization.json`);
    const before = run.storage.snapshot();

    expect(
      await runCommandLine(["--json", "migrate", "config"], run.ports),
    ).not.toBe(0);
    expect(run.storage.snapshot()).toEqual(before);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("rejects a cross-root prior receipt reference", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    const receipt = JSON.parse(
      run.storage.snapshot().files[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    await run.storage.fileSystem.write(
      `${root}/receipt.json`,
      `${JSON.stringify(
        {
          ...receipt,
          authorizationRef: `${root}-attempt-2/authorization.json`,
        },
        null,
        2,
      )}\n`,
    );

    expect(
      await runCommandLine(["--json", "migrate", "config"], run.ports),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it.each([
    "authorization.json",
    "rollback.json",
    "verification.json",
    "backup/config.json",
    "receipt.json",
  ])("refuses prior %s mutation after retry preview", async (target) => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    expect(await runCommandLine(["migrate", "config"], run.ports)).toBe(0);
    const preview = previewAuthorization(run.output.structured_.at(-1) ?? "");
    await run.storage.fileSystem.write(
      `${root}/${target}`,
      '{"changed":true}\n',
    );

    expect(
      await runCommandLine(
        ["--json", ...authorizedArguments(preview)],
        run.ports,
      ),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
    expect(run.storage.snapshot().files[CONFIG_REF]).toBe(LEGACY_CONFIG_BYTES);
  });

  it.each([
    "authorization.json",
    "rollback.json",
    "verification.json",
    "backup/config.json",
    "receipt.json",
  ])(
    "preconditions the observed prior %s bytes at retry apply",
    async (target) => {
      const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
      const { root } = await migrateAndRollback(run);
      const parsed = parseInvocation(["migrate", "config"], DEFAULT_REGISTRY);
      if (parsed.kind === "result")
        throw new Error("config migration not parsed");
      const observed = await observeMigration(
        parsed.invocation,
        run.ports,
        createSchemaRegistry(),
      );
      if (
        observed.kind !== "observed" ||
        observed.observation.kind !== "migration" ||
        observed.observation.operation.kind !== "config"
      ) {
        throw new Error("retry migration not observed");
      }
      const operation = observed.observation.operation;
      const authorized = parseInvocation(
        authorizedArguments({
          planDigest: operation.planDigest,
          planTime: operation.now,
        }),
        DEFAULT_REGISTRY,
      );
      if (authorized.kind === "result") {
        throw new Error("authorized migration not parsed");
      }
      const decision = dispatch({
        ...authorized.invocation,
        observation: observed.observation,
      });
      await run.storage.fileSystem.write(
        `${root}/${target}`,
        '{"changed":true}\n',
      );

      await expect(
        applyPlan(decision.plan, observed.ports),
      ).rejects.toMatchObject({
        reasonCode: "runtime.revision_conflict",
      });
      expect(run.storage.snapshot().files[CONFIG_REF]).toBe(
        LEGACY_CONFIG_BYTES,
      );
    },
  );

  it("rejects an escaping prior audit reference", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS]);
    const { root } = await migrateAndRollback(run);
    const receipt = JSON.parse(
      run.storage.snapshot().files[`${root}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    if (receipt.rollback.kind !== "replace") throw new Error("not replacement");
    await run.storage.fileSystem.write(
      `${root}/receipt.json`,
      `${JSON.stringify(
        {
          ...receipt,
          rollback: {
            ...receipt.rollback,
            backupRef: `${root}/backup/../backup/config.json`,
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(
      await runCommandLine(["--json", "migrate", "config"], run.ports),
    ).not.toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("rejects a skipped retry attempt before trusting any receipt", async () => {
    const migrationId = await observedConfigMigrationId(
      legacyProjectWithHistory([ANSWERS]),
    );
    const run = legacyProjectWithHistory([ANSWERS]);
    const durable = run.ports.durableFileSystem;
    let receiptInspections = 0;
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...durable,
        inspect: (path) => {
          if (path === ".brain/migrations") {
            return Promise.resolve({ kind: "directory" as const });
          }
          if (path.endsWith("/receipt.json")) receiptInspections += 1;
          return durable.inspect(path);
        },
        list: (path) =>
          path === ".brain/migrations"
            ? Promise.resolve([migrationId, `${migrationId}-attempt-3`])
            : durable.list(path),
      },
    };

    expect(
      await runCommandLine(["--json", "migrate", "config"], ports),
    ).not.toBe(0);
    expect(receiptInspections).toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("refuses exactly at the configured attempt cap without emitting cap plus one", async () => {
    const migrationId = await observedConfigMigrationId(
      legacyProjectWithHistory([ANSWERS]),
    );
    const run = legacyProjectWithHistory([ANSWERS]);
    const durable = run.ports.durableFileSystem;
    let receiptInspections = 0;
    const attempts = Array.from({ length: 10_000 }, (_, index) =>
      index === 0 ? migrationId : `${migrationId}-attempt-${index + 1}`,
    );
    const ports: RuntimePorts = {
      ...run.ports,
      durableFileSystem: {
        ...durable,
        inspect: (path) => {
          if (path === ".brain/migrations") {
            return Promise.resolve({ kind: "directory" as const });
          }
          if (path.endsWith("/receipt.json")) receiptInspections += 1;
          return durable.inspect(path);
        },
        list: (path) =>
          path === ".brain/migrations"
            ? Promise.resolve(attempts)
            : durable.list(path),
      },
    };

    expect(
      await runCommandLine(["--json", "migrate", "config"], ports),
    ).not.toBe(0);
    expect(receiptInspections).toBe(0);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("retries after rollback under a new attempt id without overwriting prior audit", async () => {
    const run = legacyProjectWithHistory([ANSWERS, ANSWERS, ANSWERS, ANSWERS]);
    expect(await runAuthorizedConfigMigration(run)).toBe(0);
    const firstRoot = migrationRoot(run.storage.snapshot().files);
    const firstReceipt = JSON.parse(
      run.storage.snapshot().files[`${firstRoot}/receipt.json`] ?? "null",
    ) as MigrationV1_1;
    expect(
      await runCommandLine(
        ["migrate", "rollback", firstReceipt.migrationId],
        run.ports,
      ),
    ).toBe(0);
    const afterRollback = run.storage.snapshot().files;
    const firstAudit = Object.fromEntries(
      Object.entries(afterRollback).filter(([path]) =>
        path.startsWith(`${firstRoot}/`),
      ),
    );

    expect(await runAuthorizedConfigMigration(run)).toBe(0);
    const retried = run.storage.snapshot().files;
    const roots = Object.keys(retried)
      .filter((path) => /\/receipt\.json$/u.test(path))
      .map((path) => path.slice(0, -"/receipt.json".length))
      .filter((root) => root.startsWith(".brain/migrations/config-"))
      .sort();
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe(firstRoot);
    expect(roots[1]).toBe(`${firstRoot}-attempt-2`);
    for (const [path, content] of Object.entries(firstAudit)) {
      expect(retried[path], path).toBe(content);
    }
  });

  it("refuses rollback after destination drift", async () => {
    const run = legacyProjectWithHistory();
    expect(await runAuthorizedConfigMigration(run)).toBe(0);
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
      expect(await runAuthorizedConfigMigration(run)).toBe(0);
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
