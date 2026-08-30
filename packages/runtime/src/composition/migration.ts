import { basename, dirname, join } from "node:path";

import type {
  MigrationV1,
  MigrationV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
} from "@kratos/contracts";

import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import { resolveInitAnswers } from "../domain/init/index.js";
import {
  authorizeConfigMigration,
  completeConfigMigration,
  migrateLegacyLanguage,
  planBrainMigration,
  plannedConfigMigration,
  rollBackConfigMigration,
  type MigrationEntry,
  upgradeProjectConfiguration,
  upgradeProjectConfigurationV1_2,
  upgradeProjectConfigurationV1_3,
} from "../domain/migration/index.js";
import type { Result } from "../domain/result/index.js";
import type { HostModelCatalog } from "../domain/model-roles/index.js";
import { resultFor, usageFailure, USAGE_WHY } from "../domain/result/index.js";
import {
  canonicalizeJson,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { DurableFileSystem, RuntimePorts } from "../ports/index.js";

import { createRuntimeAt } from "./index.js";
import { observeModelCatalog } from "./model-routing.js";

export type ObservedMigration =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      readonly ports: RuntimePorts;
    };

export async function observeMigration(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedMigration> {
  const requested = invocation.flags.get("--root");
  const target = await ports.workspace.canonicalize(
    typeof requested === "string"
      ? requested
      : ports.environment.workingDirectory(),
    ports.environment.workingDirectory(),
  );
  if (target === null) {
    return { kind: "failure", result: usageFailure(USAGE_WHY.missingValue) };
  }
  const destination =
    target === ports.environment.workingDirectory()
      ? ports
      : createRuntimeAt(target, sharedPorts(ports));
  const command = invocation.command.path.join(" ");
  if (command === "migrate rollback") {
    return observeRollback(invocation, destination, registry);
  }
  if (command === "migrate config") {
    return observeConfig(invocation, destination, registry);
  }
  const sourceRoot = join(dirname(target), `${basename(target)}-brain`);
  const canonicalSource = await ports.workspace.canonicalize(
    sourceRoot,
    ports.environment.workingDirectory(),
  );
  const source =
    canonicalSource === null
      ? null
      : createRuntimeAt(canonicalSource, sharedPorts(ports));
  const [legacyTree, destinationTree] = await Promise.all([
    source === null ? Promise.resolve([]) : walkBrain(source.durableFileSystem),
    walkBrain(destination.durableFileSystem),
  ]);
  const plan = planBrainMigration(
    {
      candidates: canonicalSource === null ? [] : [canonicalSource],
      legacy: source === null ? null : legacyTree.map(migrationEntry),
      destination: destinationTree.map(migrationEntry),
    },
    (value) => destination.digests.sha256(value),
  );
  return {
    kind: "observed",
    ports: destination,
    observation: {
      kind: "migration",
      operation: {
        kind: "brain",
        migrationId: destination.ids.next(),
        now: destination.clock.now().toISOString(),
        plan,
        backupDigest: destination.digests.sha256(
          canonicalizeJson(destinationTree.map(migrationEntry)),
        ),
        sourceFiles: legacyTree
          .filter((entry) => entry.kind === "file")
          .map(({ path, content, sha256 }) => ({
            path,
            content,
            sha256: sha256 ?? "",
          })),
      },
    },
  };
}

const CONFIG_REF = ".brain/config.json";
const encoder = new TextEncoder();

async function observeConfig(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedMigration> {
  const requestedDigest = invocation.flags.get("--plan-digest");
  const requestedTime = invocation.flags.get("--plan-time");
  const authorized = invocation.flags.get("--yes") === true;
  if (
    (authorized &&
      (typeof requestedDigest !== "string" ||
        typeof requestedTime !== "string")) ||
    (!authorized &&
      (requestedDigest !== undefined || requestedTime !== undefined)) ||
    (typeof requestedDigest === "string" &&
      !/^[a-f0-9]{64}$/u.test(requestedDigest)) ||
    (typeof requestedTime === "string" && !isCanonicalInstant(requestedTime))
  ) {
    return { kind: "failure", result: usageFailure(USAGE_WHY.missingValue) };
  }
  const planTime =
    typeof requestedTime === "string"
      ? requestedTime
      : ports.clock.now().toISOString();
  const sourceFile = await readStableFile(CONFIG_REF, ports);
  if (sourceFile.kind !== "file") {
    if (authorized || sourceFile.kind === "revision-conflict") {
      return resultFailure("runtime.revision_conflict", CONFIG_REF);
    }
    return resultFailure(
      sourceFile.kind === "missing"
        ? "guard.config_missing"
        : "guard.config_corrupt",
    );
  }

  const { content, entry } = sourceFile;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return resultFailure(
      authorized ? "runtime.revision_conflict" : "guard.config_corrupt",
      authorized ? CONFIG_REF : undefined,
    );
  }

  const version = ownString(parsed, "stateContract");
  if (version === "1.3.0") {
    if (authorized) {
      return resultFailure("runtime.revision_conflict", CONFIG_REF);
    }
    const current = registry.validate({
      id: "state.project-config",
      version,
      value: parsed,
      structuralReasonCode: "guard.config_corrupt",
    });
    if (current.kind !== "valid") return resultFailure("guard.config_corrupt");
    return {
      kind: "observed",
      ports,
      observation: {
        kind: "migration",
        operation: { kind: "config-current", sha256: entry.sha256 },
      },
    };
  }
  if (version === null) {
    return resultFailure(
      authorized
        ? "runtime.revision_conflict"
        : "contract.state_version_invalid",
      authorized ? CONFIG_REF : undefined,
    );
  }
  if (version !== "1.0.0" && version !== "1.1.0" && version !== "1.2.0") {
    return resultFailure(
      authorized
        ? "runtime.revision_conflict"
        : "contract.state_version_unsupported",
      authorized ? CONFIG_REF : undefined,
    );
  }
  const source = registry.validate({
    id: "state.project-config",
    version,
    value: parsed,
    structuralReasonCode: "guard.config_corrupt",
  });
  if (source.kind !== "valid") {
    return resultFailure(
      authorized ? "runtime.revision_conflict" : "guard.config_corrupt",
      authorized ? CONFIG_REF : undefined,
    );
  }

  let destination: ProjectConfigV1_3;
  let hosts: readonly ("claude" | "codex")[];
  let answersAuthority: { readonly ref: string; readonly sha256: string };
  let defaulted: readonly string[];
  const observedCatalogs = new Map<
    "claude" | "codex",
    HostModelCatalog | null
  >();

  if (version === "1.0.0") {
    const document = await migrationAnswers(invocation, ports);
    if (document.kind === "failure") {
      return authorized
        ? resultFailure("runtime.revision_conflict", CONFIG_REF)
        : document;
    }
    const legacy = source.value as ProjectConfigV1;
    const supplemented = supplementLegacyDefaults(document.value, legacy);
    const answers = await resolveInitAnswers(supplemented, registry, {
      observe: async (host) => {
        const catalog = await observeModelCatalog(ports.modelRouting, host);
        observedCatalogs.set(host, catalog);
        return catalog;
      },
    });
    if (answers.kind === "invalid") {
      if (authorized) {
        return resultFailure("runtime.revision_conflict", CONFIG_REF);
      }
      return {
        kind: "failure",
        result: resultFor(answers.reasonCode, {
          why: [migrationAnswerFailure(answers.subject)],
          evidence:
            answers.subject === undefined
              ? []
              : [
                  {
                    kind: "observation",
                    ref: `model-routing/${answers.subject.host}${
                      answers.subject.role === undefined
                        ? ""
                        : `/${answers.subject.role}`
                    }`,
                  },
                ],
        }),
      };
    }
    const legacyPolicy = migrateLegacyLanguage(legacy.language);
    if (
      !sameJson(answers.answers.language, legacyPolicy) ||
      answers.answers.policyMode !== legacy.policyMode ||
      answers.answers.snapshots !== legacy.managedState.snapshots
    ) {
      return resultFailure("trail.output_invalido");
    }
    destination = upgradeProjectConfigurationV1_3(
      upgradeProjectConfiguration(legacy, answers.answers.modelRoles),
      answers.answers.projectProfile,
    );
    hosts = answers.answers.hosts;
    answersAuthority = document.authority;
    defaulted = answers.defaulted;
  } else if (version === "1.1.0") {
    const legacy = source.value as ProjectConfigV1_1;
    const document = await migrationAnswers(invocation, ports);
    if (document.kind === "document") {
      const supplemented = supplementLegacyDefaults(document.value, legacy);
      const answers = await resolveInitAnswers(supplemented, registry, {
        observe: async (host) => {
          const catalog = await observeModelCatalog(ports.modelRouting, host);
          observedCatalogs.set(host, catalog);
          return catalog;
        },
      });
      if (answers.kind === "invalid") {
        if (authorized) {
          return resultFailure("runtime.revision_conflict", CONFIG_REF);
        }
        return {
          kind: "failure",
          result: resultFor(answers.reasonCode, {
            why: [migrationAnswerFailure(answers.subject)],
            evidence:
              answers.subject === undefined
                ? []
                : [
                    {
                      kind: "observation",
                      ref: `model-routing/${answers.subject.host}${
                        answers.subject.role === undefined
                          ? ""
                          : `/${answers.subject.role}`
                      }`,
                    },
                  ],
          }),
        };
      }
      const legacyPolicy = migrateLegacyLanguage(legacy.language);
      if (
        !sameJson(answers.answers.language, legacyPolicy) ||
        answers.answers.policyMode !== legacy.policyMode ||
        answers.answers.snapshots !== legacy.managedState.snapshots
      ) {
        return resultFailure("trail.output_invalido");
      }
      const modelRoles = mergeExplicitModelRoles(
        document.value,
        legacy.modelRoles,
        answers.answers.modelRoles,
      );
      destination = upgradeProjectConfigurationV1_3(
        upgradeProjectConfigurationV1_2({ ...legacy, modelRoles }),
        answers.answers.projectProfile,
      );
      hosts = configuredHosts(modelRoles);
      answersAuthority = document.authority;
      defaulted = answers.defaulted.filter(
        (path) => !path.startsWith("modelRoles."),
      );
    } else {
      if (
        document.result.why[0] !==
        resultFor("trail.uso", { why: [USAGE_WHY.missingValue] }).why[0]
      ) {
        return authorized
          ? resultFailure("runtime.revision_conflict", CONFIG_REF)
          : document;
      }
      hosts = (["claude", "codex"] as const).filter(
        (host) => legacy.modelRoles[host] !== undefined,
      );
      answersAuthority = { ref: "config", sha256: entry.sha256 };
      defaulted = [];
      destination = upgradeProjectConfigurationV1_3(
        upgradeProjectConfigurationV1_2(legacy),
      );
    }
  } else {
    const legacy = source.value as ProjectConfigV1_2;
    const document = await migrationAnswers(invocation, ports);
    if (document.kind === "document") {
      const supplemented = supplementLegacyDefaults(document.value, legacy);
      const answers = await resolveInitAnswers(supplemented, registry, {
        observe: async (host) => {
          const catalog = await observeModelCatalog(ports.modelRouting, host);
          observedCatalogs.set(host, catalog);
          return catalog;
        },
      });
      if (answers.kind === "invalid") {
        if (authorized) {
          return resultFailure("runtime.revision_conflict", CONFIG_REF);
        }
        return {
          kind: "failure",
          result: resultFor(answers.reasonCode, {
            why: [migrationAnswerFailure(answers.subject)],
            evidence:
              answers.subject === undefined
                ? []
                : [
                    {
                      kind: "observation",
                      ref: `model-routing/${answers.subject.host}${
                        answers.subject.role === undefined
                          ? ""
                          : `/${answers.subject.role}`
                      }`,
                    },
                  ],
          }),
        };
      }
      if (
        !sameJson(answers.answers.language, legacy.language) ||
        answers.answers.policyMode !== legacy.policyMode ||
        answers.answers.snapshots !== legacy.managedState.snapshots
      ) {
        return resultFailure("trail.output_invalido");
      }
      const modelRoles = mergeExplicitModelRoles(
        document.value,
        legacy.modelRoles,
        answers.answers.modelRoles,
      );
      destination = upgradeProjectConfigurationV1_3(
        { ...legacy, modelRoles },
        answers.answers.projectProfile,
      );
      hosts = configuredHosts(modelRoles);
      answersAuthority = document.authority;
      defaulted = answers.defaulted.filter(
        (path) => !path.startsWith("modelRoles."),
      );
    } else {
      if (
        document.result.why[0] !==
        resultFor("trail.uso", { why: [USAGE_WHY.missingValue] }).why[0]
      ) {
        return authorized
          ? resultFailure("runtime.revision_conflict", CONFIG_REF)
          : document;
      }
      hosts = (["claude", "codex"] as const).filter(
        (host) => legacy.modelRoles[host] !== undefined,
      );
      answersAuthority = { ref: "config", sha256: entry.sha256 };
      defaulted = [];
      destination = upgradeProjectConfigurationV1_3(legacy);
    }
  }

  const catalogs = await Promise.all(
    hosts.map(async (host) => {
      let catalog = observedCatalogs.get(host);
      if (catalog === undefined) {
        catalog = await observeModelCatalog(ports.modelRouting, host);
        observedCatalogs.set(host, catalog);
      }
      if (catalog === null) {
        throw new Error("resolved model catalog was not captured");
      }
      return {
        host,
        sha256: ports.digests.sha256(canonicalizeJson(catalog)),
      };
    }),
  );

  const destinationContent = `${JSON.stringify(destination, null, 2)}\n`;
  const destinationDigest = ports.digests.sha256(destinationContent);
  const seedDigest = ports.digests.sha256(
    canonicalizeJson({
      sourceDigest: entry.sha256,
      destinationDigest,
      hosts,
      answers: answersAuthority,
      catalogs,
      modelRoles: destination.modelRoles,
      defaulted,
    }),
  );
  const baseMigrationId = `config-${seedDigest.slice(0, 24)}`;
  const attempt = await nextConfigAttempt(
    baseMigrationId,
    {
      source: { content, sha256: entry.sha256 },
      destinationDigest,
      hosts,
      answers: answersAuthority,
      catalogs,
      modelRoles: destination.modelRoles,
      defaulted,
    },
    ports,
    registry,
  );
  if (attempt.kind === "failure") {
    return authorized && attempt.result.reasonCode === "runtime.state_corrupt"
      ? resultFailure("runtime.revision_conflict", ".brain/migrations")
      : attempt;
  }
  const migrationId = attempt.migrationId;
  const root = `.brain/migrations/${migrationId}`;
  const backupRef = `${root}/backup/config.json`;
  const authorizationRef = `${root}/authorization.json`;
  const rollbackRef = `${root}/rollback.json`;
  const receiptRef = `${root}/receipt.json`;
  const verificationRef = `${root}/verification.json`;
  const receiptPlanDigest = ports.digests.sha256(
    canonicalizeJson({
      kind: "project-config-replacement",
      migrationId,
      planTime,
      source: { ref: CONFIG_REF, sha256: entry.sha256 },
      destination: { ref: CONFIG_REF, sha256: destinationDigest },
      hosts,
      modelRoles: destination.modelRoles,
      defaulted,
    }),
  );
  const planned = plannedConfigMigration({
    migrationId,
    planDigest: receiptPlanDigest,
    authorizationRef,
    backupRef,
    backupDigest: entry.sha256,
    destinationRef: CONFIG_REF,
    destinationDigest,
    verificationRef,
    now: planTime,
  });
  const authorizedReceipt = authorizeConfigMigration(
    planned,
    receiptPlanDigest,
    authorizationRef,
    planTime,
  );
  const completed =
    authorizedReceipt === null
      ? null
      : completeConfigMigration(
          authorizedReceipt,
          verificationRef,
          destinationDigest,
          planTime,
        );
  if (completed?.rollback.kind !== "replace") {
    return resultFailure("runtime.state_corrupt");
  }
  const missing = { kind: "missing" } as const;
  const plannedWrites = [
    {
      path: CONFIG_REF,
      content: destinationContent,
      expected: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    },
    { path: backupRef, content, expected: missing },
    {
      path: authorizationRef,
      content: json({
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        migrationId,
        planDigest: receiptPlanDigest,
        answers: answersAuthority,
        catalogs,
        plan: {
          hosts,
          modelRoles: destination.modelRoles,
          defaulted,
        },
        source: { ref: CONFIG_REF, sha256: entry.sha256 },
        destination: { ref: CONFIG_REF, sha256: destinationDigest },
        authorizedAt: planTime,
      }),
      expected: missing,
    },
    {
      path: rollbackRef,
      content: json({
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        migrationId,
        planDigest: receiptPlanDigest,
        rollback: completed.rollback,
      }),
      expected: missing,
    },
    { path: receiptRef, content: json(completed), expected: missing },
    {
      path: verificationRef,
      content: json({
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        migrationId,
        planDigest: receiptPlanDigest,
        backup: { ref: backupRef, sha256: entry.sha256 },
        destination: { ref: CONFIG_REF, sha256: destinationDigest },
        verifiedAt: planTime,
      }),
      expected: missing,
    },
  ].map((write) => ({
    ...write,
    sha256: ports.digests.sha256(write.content),
  }));
  const planDigest = ports.digests.sha256(
    canonicalizeJson({
      kind: "project-config-write-set",
      migrationId,
      planTime,
      ...(attempt.guards.length === 0
        ? {}
        : {
            guards: attempt.guards.map(({ path, expected }) => ({
              path,
              sha256: expected.sha256,
            })),
          }),
      writes: plannedWrites.map(({ path, sha256 }) => ({ path, sha256 })),
    }),
  );
  if (typeof requestedDigest === "string" && requestedDigest !== planDigest) {
    return resultFailure("runtime.revision_conflict", CONFIG_REF);
  }
  return {
    kind: "observed",
    ports,
    observation: {
      kind: "migration",
      operation: {
        kind: "config",
        migrationId,
        now: planTime,
        source: { content, sha256: entry.sha256 },
        destination,
        destinationDigest,
        planDigest,
        receiptPlanDigest,
        expected: { kind: "file", size: entry.size, sha256: entry.sha256 },
        hosts: [...hosts],
        answers: answersAuthority,
        catalogs,
        defaulted: [...defaulted],
        guards: attempt.guards,
        writes: plannedWrites,
      },
    },
  };
}

type StableFileObservation =
  | {
      readonly kind: "file";
      readonly content: string;
      readonly entry: Extract<
        Awaited<ReturnType<DurableFileSystem["inspect"]>>,
        { readonly kind: "file" }
      >;
    }
  | { readonly kind: "missing" | "corrupt" | "revision-conflict" };

async function readStableFile(
  path: string,
  ports: RuntimePorts,
): Promise<StableFileObservation> {
  const before = await ports.durableFileSystem.inspect(path);
  if (before.kind === "missing") return { kind: "missing" };
  if (before.kind !== "file") return { kind: "corrupt" };
  let content: string;
  try {
    content = await ports.durableFileSystem.readText(path);
  } catch {
    return { kind: "revision-conflict" };
  }
  const after = await ports.durableFileSystem.inspect(path);
  if (
    after.kind !== "file" ||
    after.size !== before.size ||
    after.sha256 !== before.sha256 ||
    encoder.encode(content).byteLength !== before.size ||
    ports.digests.sha256(content) !== before.sha256
  ) {
    return { kind: "revision-conflict" };
  }
  return { kind: "file", content, entry: before };
}

interface ConfigLineageContext {
  readonly source: { readonly content: string; readonly sha256: string };
  readonly destinationDigest: string;
  readonly hosts: readonly ("claude" | "codex")[];
  readonly answers: { readonly ref: string; readonly sha256: string };
  readonly catalogs: readonly {
    readonly host: "claude" | "codex";
    readonly sha256: string;
  }[];
  readonly modelRoles: ProjectConfigV1_3["modelRoles"];
  readonly defaulted: readonly string[];
}

interface ConfigAttemptGuard {
  readonly path: string;
  readonly content: string;
  readonly expected: {
    readonly kind: "file";
    readonly size: number;
    readonly sha256: string;
  };
}

const MAX_CONFIG_MIGRATION_ATTEMPTS = 10_000;

async function nextConfigAttempt(
  baseMigrationId: string,
  context: ConfigLineageContext,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "attempt";
      readonly migrationId: string;
      readonly guards: readonly ConfigAttemptGuard[];
    }
  | Extract<ObservedMigration, { readonly kind: "failure" }>
> {
  const migrations = await ports.durableFileSystem.inspect(".brain/migrations");
  if (migrations.kind === "missing") {
    return { kind: "attempt", migrationId: baseMigrationId, guards: [] };
  }
  if (migrations.kind !== "directory") {
    return resultFailure("runtime.state_corrupt", ".brain/migrations");
  }
  const entries = new Set(
    await ports.durableFileSystem.list(".brain/migrations"),
  );
  const lineage = [...entries]
    .flatMap((entry): number[] => {
      if (entry === baseMigrationId) return [1];
      const suffix = entry.slice(`${baseMigrationId}-attempt-`.length);
      if (!entry.startsWith(`${baseMigrationId}-attempt-`)) return [];
      if (!/^(?:[2-9]|[1-9][0-9]+)$/u.test(suffix)) return [Number.NaN];
      return [Number(suffix)];
    })
    .sort((left, right) => left - right);
  if (
    lineage.some(
      (attempt, index) =>
        !Number.isSafeInteger(attempt) ||
        attempt > MAX_CONFIG_MIGRATION_ATTEMPTS ||
        attempt !== index + 1,
    )
  ) {
    return resultFailure("runtime.state_corrupt", ".brain/migrations");
  }
  if (lineage.length >= MAX_CONFIG_MIGRATION_ATTEMPTS) {
    return resultFailure("runtime.state_corrupt", ".brain/migrations");
  }
  const guards: ConfigAttemptGuard[] = [];
  for (const index of lineage) {
    const candidate =
      index === 1
        ? baseMigrationId
        : `${baseMigrationId}-attempt-${String(index)}`;
    const observed = await observePriorConfigAttempt(
      candidate,
      context,
      ports,
      registry,
    );
    if (observed.kind === "failure") return observed;
    guards.push(...observed.guards);
  }
  const next = lineage.length + 1;
  return {
    kind: "attempt",
    migrationId:
      next === 1
        ? baseMigrationId
        : `${baseMigrationId}-attempt-${String(next)}`,
    guards,
  };
}

interface PriorAttemptFiles {
  readonly authorization: Extract<
    StableFileObservation,
    { readonly kind: "file" }
  >;
  readonly backup: Extract<StableFileObservation, { readonly kind: "file" }>;
  readonly receipt: Extract<StableFileObservation, { readonly kind: "file" }>;
  readonly rollback: Extract<StableFileObservation, { readonly kind: "file" }>;
  readonly verification: Extract<
    StableFileObservation,
    { readonly kind: "file" }
  >;
}

async function observePriorConfigAttempt(
  migrationId: string,
  context: ConfigLineageContext,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | { readonly kind: "bundle"; readonly guards: readonly ConfigAttemptGuard[] }
  | Extract<ObservedMigration, { readonly kind: "failure" }>
> {
  const root = `.brain/migrations/${migrationId}`;
  const paths = {
    authorization: `${root}/authorization.json`,
    backup: `${root}/backup/config.json`,
    receipt: `${root}/receipt.json`,
    rollback: `${root}/rollback.json`,
    verification: `${root}/verification.json`,
  } as const;
  const files = await readPriorAttemptFiles(paths, ports);
  if (files.kind !== "files") {
    return resultFailure(
      files.kind === "revision-conflict"
        ? "runtime.revision_conflict"
        : "runtime.state_corrupt",
      root,
    );
  }

  let authorization: unknown;
  let rawReceipt: unknown;
  let rollbackManifest: unknown;
  let verification: unknown;
  try {
    authorization = JSON.parse(files.value.authorization.content) as unknown;
    rawReceipt = JSON.parse(files.value.receipt.content) as unknown;
    rollbackManifest = JSON.parse(files.value.rollback.content) as unknown;
    verification = JSON.parse(files.value.verification.content) as unknown;
  } catch {
    return resultFailure("runtime.state_corrupt", root);
  }
  const validated = registry.validate({
    id: "state.migration",
    version: ownString(rawReceipt, "stateContract") ?? "",
    value: rawReceipt,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (
    validated.kind !== "valid" ||
    validated.value.stateContract !== "1.1.0" ||
    validated.value.migrationId !== migrationId ||
    validated.value.status !== "rolled-back" ||
    validated.value.rollback.kind !== "replace"
  ) {
    return resultFailure("runtime.state_corrupt", paths.receipt);
  }
  const receipt = validated.value;
  const receiptPlanDigest = ports.digests.sha256(
    canonicalizeJson({
      kind: "project-config-replacement",
      migrationId,
      planTime: receipt.createdAt,
      source: { ref: CONFIG_REF, sha256: context.source.sha256 },
      destination: { ref: CONFIG_REF, sha256: context.destinationDigest },
      hosts: context.hosts,
      modelRoles: context.modelRoles,
      defaulted: context.defaulted,
    }),
  );
  const planned = plannedConfigMigration({
    migrationId,
    planDigest: receiptPlanDigest,
    authorizationRef: paths.authorization,
    backupRef: paths.backup,
    backupDigest: context.source.sha256,
    destinationRef: CONFIG_REF,
    destinationDigest: context.destinationDigest,
    verificationRef: paths.verification,
    now: receipt.createdAt,
  });
  const authorized = authorizeConfigMigration(
    planned,
    receiptPlanDigest,
    paths.authorization,
    receipt.createdAt,
  );
  const completed =
    authorized === null
      ? null
      : completeConfigMigration(
          authorized,
          paths.verification,
          context.destinationDigest,
          receipt.createdAt,
        );
  const expectedReceipt =
    completed === null
      ? null
      : rollBackConfigMigration(
          completed,
          context.source.sha256,
          context.destinationDigest,
          receipt.updatedAt,
        );
  const expectedAuthorization = {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    migrationId,
    planDigest: receiptPlanDigest,
    answers: context.answers,
    catalogs: context.catalogs,
    plan: {
      hosts: context.hosts,
      modelRoles: context.modelRoles,
      defaulted: context.defaulted,
    },
    source: { ref: CONFIG_REF, sha256: context.source.sha256 },
    destination: { ref: CONFIG_REF, sha256: context.destinationDigest },
    authorizedAt: receipt.createdAt,
  };
  if (
    receipt.planDigest !== receiptPlanDigest ||
    expectedReceipt === null ||
    !sameJson(receipt, expectedReceipt) ||
    !sameJson(authorization, expectedAuthorization) ||
    !validConfigRollbackManifest(rollbackManifest, receipt) ||
    !validConfigVerificationAt(verification, receipt, receipt.createdAt) ||
    files.value.backup.content !== context.source.content ||
    files.value.backup.entry.sha256 !== context.source.sha256
  ) {
    return resultFailure("runtime.state_corrupt", root);
  }
  const guards = (
    Object.entries(files.value) as readonly [
      keyof PriorAttemptFiles,
      PriorAttemptFiles[keyof PriorAttemptFiles],
    ][]
  )
    .map(([name, file]) => ({
      path: paths[name],
      content: file.content,
      expected: expectedFile(file),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  return { kind: "bundle", guards };
}

async function readPriorAttemptFiles(
  paths: Readonly<Record<keyof PriorAttemptFiles, string>>,
  ports: RuntimePorts,
): Promise<
  | { readonly kind: "files"; readonly value: PriorAttemptFiles }
  | { readonly kind: "missing-or-corrupt" | "revision-conflict" }
> {
  const [authorization, backup, receipt, rollback, verification] =
    await Promise.all([
      readStableFile(paths.authorization, ports),
      readStableFile(paths.backup, ports),
      readStableFile(paths.receipt, ports),
      readStableFile(paths.rollback, ports),
      readStableFile(paths.verification, ports),
    ]);
  if (
    authorization.kind === "revision-conflict" ||
    backup.kind === "revision-conflict" ||
    receipt.kind === "revision-conflict" ||
    rollback.kind === "revision-conflict" ||
    verification.kind === "revision-conflict"
  ) {
    return { kind: "revision-conflict" };
  }
  if (
    authorization.kind !== "file" ||
    backup.kind !== "file" ||
    receipt.kind !== "file" ||
    rollback.kind !== "file" ||
    verification.kind !== "file"
  ) {
    return { kind: "missing-or-corrupt" };
  }
  return {
    kind: "files",
    value: { authorization, backup, receipt, rollback, verification },
  };
}

function isCanonicalInstant(value: string): boolean {
  if (value.length !== 24) return false;
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function migrationAnswers(
  invocation: Invocation,
  ports: RuntimePorts,
): Promise<
  | {
      readonly kind: "document";
      readonly value: unknown;
      readonly authority: { readonly ref: string; readonly sha256: string };
    }
  | Extract<ObservedMigration, { readonly kind: "failure" }>
> {
  const path = invocation.flags.get("--answers");
  const piped = await ports.standardInput.read();
  if (typeof path === "string" && piped !== null) {
    return {
      kind: "failure",
      result: usageFailure(USAGE_WHY.conflictingFlag),
    };
  }
  let text = piped;
  if (typeof path === "string") {
    try {
      text = await ports.fileSystem.read(path);
    } catch {
      text = null;
    }
  }
  if (text === null) {
    return { kind: "failure", result: usageFailure(USAGE_WHY.missingValue) };
  }
  try {
    return {
      kind: "document",
      value: JSON.parse(text) as unknown,
      authority: {
        ref: typeof path === "string" ? path : "stdin",
        sha256: ports.digests.sha256(text),
      },
    };
  } catch {
    return {
      kind: "document",
      value: null,
      authority: {
        ref: typeof path === "string" ? path : "stdin",
        sha256: ports.digests.sha256(text),
      },
    };
  }
}

function supplementLegacyDefaults(
  document: unknown,
  legacy: ProjectConfigV1 | ProjectConfigV1_1 | ProjectConfigV1_2,
): unknown {
  if (!isRecord(document)) return document;
  const legacyLanguage =
    typeof legacy.language === "string"
      ? migrateLegacyLanguage(legacy.language)
      : legacy.language;
  return {
    ...document,
    language: document.language ?? legacyLanguage,
    policyMode: document.policyMode ?? legacy.policyMode,
    snapshots: document.snapshots ?? legacy.managedState.snapshots,
  };
}

function migrationAnswerFailure(
  subject:
    { readonly host: "claude" | "codex"; readonly role?: string } | undefined,
): string {
  if (subject === undefined) {
    return "The migration answers do not satisfy their contract.";
  }
  return subject.role === undefined
    ? `The model catalog for host \`${subject.host}\` is unavailable.`
    : `The configured role \`${subject.role}\` for host \`${subject.host}\` cannot be resolved independently.`;
}

function ownString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function configuredHosts(
  modelRoles: ProjectConfigV1_3["modelRoles"],
): readonly ("claude" | "codex")[] {
  return (["claude", "codex"] as const).filter(
    (host) => modelRoles[host] !== undefined,
  );
}

function mergeExplicitModelRoles(
  document: unknown,
  persisted: ProjectConfigV1_3["modelRoles"],
  resolved: ProjectConfigV1_3["modelRoles"],
): ProjectConfigV1_3["modelRoles"] {
  const supplied =
    isRecord(document) && isRecord(document.modelRoles)
      ? document.modelRoles
      : undefined;
  const claude =
    supplied !== undefined && hasOwn(supplied, "claude")
      ? resolved.claude
      : undefined;
  const codex =
    supplied !== undefined && hasOwn(supplied, "codex")
      ? resolved.codex
      : undefined;
  return {
    ...persisted,
    ...(claude === undefined ? {} : { claude }),
    ...(codex === undefined ? {} : { codex }),
  };
}

function resultFailure(
  reasonCode: string,
  evidenceRef?: string,
): Extract<ObservedMigration, { readonly kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor(reasonCode, {
      why: [
        reasonCode === "runtime.revision_conflict"
          ? "The authorized migration inputs or exact write plan changed after preview."
          : "The observed migration input does not satisfy the requested operation.",
      ],
      evidence:
        evidenceRef === undefined
          ? []
          : [{ kind: "artifact", ref: evidenceRef }],
    }),
  };
}

function migrationEntry(entry: ObservedEntry): MigrationEntry {
  const sensitive =
    /(^|\/)(\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))/iu.test(
      entry.path,
    ) || /\.pem$/iu.test(entry.path);
  return {
    path: entry.path,
    kind: sensitive ? "other" : entry.kind,
    sha256: sensitive ? null : entry.sha256,
    bytes: entry.bytes,
  };
}

async function observeRollback(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedMigration> {
  const migrationId = invocation.positionals[0] ?? "";
  if (!isCanonicalMigrationId(migrationId)) {
    return { kind: "failure", result: usageFailure(USAGE_WHY.missingValue) };
  }
  const root = `.brain/migrations/${migrationId}`;
  let receipt: MigrationV1 | MigrationV1_1 | null = null;
  let targets: readonly string[] = [];
  let replacement: Extract<
    Extract<CommandObservation, { readonly kind: "migration" }>["operation"],
    { readonly kind: "rollback" }
  >["replacement"] = null;
  try {
    const receiptFile = await readStableFile(`${root}/receipt.json`, ports);
    const rollbackFile = await readStableFile(`${root}/rollback.json`, ports);
    if (
      receiptFile.kind === "revision-conflict" ||
      rollbackFile.kind === "revision-conflict"
    ) {
      return resultFailure("runtime.revision_conflict", root);
    }
    if (receiptFile.kind === "file" && rollbackFile.kind === "file") {
      const rawReceipt = JSON.parse(receiptFile.content) as unknown;
      const rollback = JSON.parse(rollbackFile.content) as unknown;
      const version = ownString(rawReceipt, "stateContract");
      if (version === "1.0.0") {
        const validated = registry.validate({
          id: "state.migration",
          version,
          value: rawReceipt,
          structuralReasonCode: "runtime.state_corrupt",
        });
        if (
          validated.kind === "valid" &&
          validated.value.stateContract === "1.0.0" &&
          validRollbackManifest(rollback, validated.value, migrationId, root) &&
          (await rollbackTargetsUnchanged(
            rollback.targets,
            validated.value,
            ports,
          ))
        ) {
          receipt = validated.value;
          targets = [...new Set(rollback.targets)].sort();
        }
      } else if (version === "1.1.0") {
        const validated = registry.validate({
          id: "state.migration",
          version,
          value: rawReceipt,
          structuralReasonCode: "runtime.state_corrupt",
        });
        if (
          validated.kind === "valid" &&
          validated.value.stateContract === "1.1.0"
        ) {
          const observed = await observeConfigReplacement(
            validated.value,
            rollback,
            migrationId,
            root,
            ports,
            receiptFile,
            rollbackFile,
          );
          if (observed.kind === "revision-conflict") {
            return resultFailure("runtime.revision_conflict", CONFIG_REF);
          }
          if (observed.kind === "ready") {
            receipt = validated.value;
            replacement = observed.value;
          }
        }
      }
    }
  } catch {
    receipt = null;
    targets = [];
  }
  return {
    kind: "observed",
    ports,
    observation: {
      kind: "migration",
      operation: {
        kind: "rollback",
        migrationId,
        receipt,
        targets,
        replacement,
        now: ports.clock.now().toISOString(),
      },
    },
  };
}

function isCanonicalMigrationId(value: string): boolean {
  const windowsBasename = value.split(".", 1)[0]?.toUpperCase() ?? "";
  return (
    value.length <= 128 &&
    !value.includes("..") &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBasename) &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9._@-]{0,126}[a-zA-Z0-9])?$/u.test(value)
  );
}

async function observeConfigReplacement(
  receipt: MigrationV1_1,
  rollbackManifest: unknown,
  migrationId: string,
  root: string,
  ports: RuntimePorts,
  receiptFile: Extract<StableFileObservation, { readonly kind: "file" }>,
  rollbackFile: Extract<StableFileObservation, { readonly kind: "file" }>,
): Promise<ConfigReplacementObservation> {
  if (
    receipt.migrationId !== migrationId ||
    receipt.status !== "completed" ||
    receipt.authorizationRef !== `${root}/authorization.json` ||
    receipt.rollback.kind !== "replace" ||
    receipt.rollback.backupRef !== `${root}/backup/config.json` ||
    receipt.rollback.destinationRef !== CONFIG_REF ||
    receipt.backupDigest !== receipt.rollback.backupDigest ||
    receipt.verificationRefs.length !== 1 ||
    receipt.verificationRefs[0] !== `${root}/verification.json` ||
    receipt.conversions.length !== 1 ||
    receipt.conversions[0].payloadContract !== "state.project-config" ||
    receipt.conversions[0].sourceDigest !== receipt.backupDigest ||
    receipt.conversions[0].destinationDigest !==
      receipt.rollback.destinationDigest ||
    !validConfigRollbackManifest(rollbackManifest, receipt)
  ) {
    return { kind: "corrupt" };
  }
  const [verificationFile, backupFile, destinationFile] = await Promise.all([
    readStableFile(`${root}/verification.json`, ports),
    readStableFile(receipt.rollback.backupRef, ports),
    readStableFile(receipt.rollback.destinationRef, ports),
  ]);
  if (
    verificationFile.kind === "revision-conflict" ||
    backupFile.kind === "revision-conflict" ||
    destinationFile.kind === "revision-conflict"
  ) {
    return { kind: "revision-conflict" };
  }
  if (
    verificationFile.kind !== "file" ||
    backupFile.kind !== "file" ||
    backupFile.entry.sha256 !== receipt.rollback.backupDigest
  ) {
    return { kind: "corrupt" };
  }
  if (
    destinationFile.kind !== "file" ||
    destinationFile.entry.sha256 !== receipt.rollback.destinationDigest
  ) {
    return { kind: "revision-conflict" };
  }
  const verification = JSON.parse(verificationFile.content) as unknown;
  if (
    ports.digests.sha256(backupFile.content) !==
      receipt.rollback.backupDigest ||
    !validConfigVerification(verification, receipt)
  ) {
    return { kind: "corrupt" };
  }
  return {
    kind: "ready",
    value: {
      destinationRef: receipt.rollback.destinationRef,
      content: backupFile.content,
      expected: {
        kind: "file",
        size: destinationFile.entry.size,
        sha256: destinationFile.entry.sha256,
      },
      backupRef: receipt.rollback.backupRef,
      backupExpected: {
        kind: "file",
        size: backupFile.entry.size,
        sha256: backupFile.entry.sha256,
      },
      receiptExpected: {
        kind: "file",
        size: receiptFile.entry.size,
        sha256: receiptFile.entry.sha256,
      },
      guards: [
        {
          path: receipt.rollback.backupRef,
          content: backupFile.content,
          expected: expectedFile(backupFile),
        },
        {
          path: `${root}/rollback.json`,
          content: rollbackFile.content,
          expected: expectedFile(rollbackFile),
        },
        {
          path: `${root}/verification.json`,
          content: verificationFile.content,
          expected: expectedFile(verificationFile),
        },
      ],
      backupDigest: receipt.rollback.backupDigest,
      destinationDigest: receipt.rollback.destinationDigest,
    },
  };
}

function expectedFile(
  file: Extract<StableFileObservation, { readonly kind: "file" }>,
): {
  readonly kind: "file";
  readonly size: number;
  readonly sha256: string;
} {
  return {
    kind: "file",
    size: file.entry.size,
    sha256: file.entry.sha256,
  };
}

type ConfigReplacement = NonNullable<
  Extract<
    Extract<CommandObservation, { readonly kind: "migration" }>["operation"],
    { readonly kind: "rollback" }
  >["replacement"]
>;

type ConfigReplacementObservation =
  | { readonly kind: "ready"; readonly value: ConfigReplacement }
  | { readonly kind: "revision-conflict" }
  | { readonly kind: "corrupt" };

function validConfigRollbackManifest(
  value: unknown,
  receipt: MigrationV1_1,
): boolean {
  if (!isRecord(value)) return false;
  return sameJson(value, {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    migrationId: receipt.migrationId,
    planDigest: receipt.planDigest,
    rollback: receipt.rollback,
  });
}

function validConfigVerification(
  value: unknown,
  receipt: MigrationV1_1,
): boolean {
  return validConfigVerificationAt(value, receipt, receipt.updatedAt);
}

function validConfigVerificationAt(
  value: unknown,
  receipt: MigrationV1_1,
  verifiedAt: string,
): boolean {
  if (!isRecord(value) || receipt.rollback.kind !== "replace") return false;
  return sameJson(value, {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    migrationId: receipt.migrationId,
    planDigest: receipt.planDigest,
    backup: {
      ref: receipt.rollback.backupRef,
      sha256: receipt.rollback.backupDigest,
    },
    destination: {
      ref: receipt.rollback.destinationRef,
      sha256: receipt.rollback.destinationDigest,
    },
    verifiedAt,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

interface RollbackManifest {
  readonly migrationId: string;
  readonly backupDigest: string;
  readonly targets: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRollbackManifest(
  value: unknown,
  receipt: MigrationV1,
  migrationId: string,
  root: string,
): value is RollbackManifest {
  if (!isRecord(value)) return false;
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["backupDigest", "migrationId", "targets"]) ||
    value.migrationId !== migrationId ||
    value.backupDigest !== receipt.backupDigest ||
    receipt.rollbackRef !== `${root}/rollback.json` ||
    !Array.isArray(value.targets) ||
    !value.targets.every(
      (target): target is string =>
        typeof target === "string" &&
        target.startsWith(".brain/") &&
        !target.split("/").includes(".."),
    )
  ) {
    return false;
  }
  return (
    new Set(value.targets).size === value.targets.length &&
    JSON.stringify(value.targets) ===
      JSON.stringify(receipt.verificationRefs) &&
    receipt.status === "completed" &&
    receipt.conversions.length === value.targets.length
  );
}

async function rollbackTargetsUnchanged(
  targets: readonly string[],
  receipt: MigrationV1,
  ports: RuntimePorts,
): Promise<boolean> {
  for (const [index, target] of targets.entries()) {
    const entry = await ports.durableFileSystem.inspect(target);
    const conversion = receipt.conversions[index];
    if (
      entry.kind !== "file" ||
      entry.sha256 !== conversion?.destinationDigest
    ) {
      return false;
    }
  }
  return true;
}

function sharedPorts(ports: RuntimePorts): Partial<RuntimePorts> {
  return {
    environment: ports.environment,
    output: ports.output,
    standardInput: ports.standardInput,
    workspace: ports.workspace,
    modelRouting: ports.modelRouting,
  };
}

interface ObservedEntry extends MigrationEntry {
  readonly content: string;
}

async function walkBrain(
  fileSystem: DurableFileSystem,
): Promise<readonly ObservedEntry[]> {
  const root = await fileSystem.inspect(".brain");
  if (root.kind === "missing") return [];
  if (root.kind !== "directory") {
    return [{ path: ".", kind: "other", sha256: null, bytes: 0, content: "" }];
  }
  const values: ObservedEntry[] = [];
  await walkDirectory(".brain", "", fileSystem, values);
  return values.sort((left, right) =>
    left.path.localeCompare(right.path, "en-US"),
  );
}

async function walkDirectory(
  absolute: string,
  relative: string,
  fileSystem: DurableFileSystem,
  values: ObservedEntry[],
): Promise<void> {
  for (const name of [...(await fileSystem.list(absolute))].sort()) {
    const path = relative === "" ? name : `${relative}/${name}`;
    const full = `${absolute}/${name}`;
    const entry = await fileSystem.inspect(full);
    if (entry.kind === "directory") {
      values.push({
        path,
        kind: "directory",
        sha256: null,
        bytes: 0,
        content: "",
      });
      await walkDirectory(full, path, fileSystem, values);
    } else if (entry.kind === "file") {
      values.push({
        path,
        kind: "file",
        sha256: entry.sha256,
        bytes: entry.size,
        content: await fileSystem.readText(full),
      });
    } else {
      values.push({ path, kind: "other", sha256: null, bytes: 0, content: "" });
    }
  }
}
