import { basename, dirname, join } from "node:path";

import type {
  MigrationV1,
  MigrationV1_1,
  ProjectConfigV1,
} from "@kratos/contracts";

import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import { resolveInitAnswers } from "../domain/init/index.js";
import {
  planBrainMigration,
  type MigrationEntry,
  upgradeProjectConfiguration,
} from "../domain/migration/index.js";
import type { Result } from "../domain/result/index.js";
import { resultFor, usageFailure, USAGE_WHY } from "../domain/result/index.js";
import {
  canonicalizeJson,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { DurableFileSystem, RuntimePorts } from "../ports/index.js";

import { createRuntimeAt } from "./index.js";

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
  const entry = await ports.durableFileSystem.inspect(CONFIG_REF);
  if (entry.kind === "missing") return resultFailure("guard.config_missing");
  if (entry.kind !== "file") return resultFailure("guard.config_corrupt");

  let content: string;
  let parsed: unknown;
  try {
    content = await ports.durableFileSystem.readText(CONFIG_REF);
    parsed = JSON.parse(content) as unknown;
  } catch {
    return resultFailure("guard.config_corrupt");
  }
  if (
    encoder.encode(content).byteLength !== entry.size ||
    ports.digests.sha256(content) !== entry.sha256
  ) {
    return resultFailure("runtime.revision_conflict", CONFIG_REF);
  }

  const version = ownString(parsed, "stateContract");
  if (version === "1.1.0") {
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
    return resultFailure("contract.state_version_invalid");
  }
  if (version !== "1.0.0") {
    return resultFailure("contract.state_version_unsupported");
  }
  const source = registry.validate({
    id: "state.project-config",
    version,
    value: parsed,
    structuralReasonCode: "guard.config_corrupt",
  });
  if (source.kind !== "valid") return resultFailure("guard.config_corrupt");

  const document = await migrationAnswers(invocation, ports);
  if (document.kind === "failure") return document;
  const legacy = source.value as ProjectConfigV1;
  const supplemented = supplementLegacyDefaults(document.value, legacy);
  const answers = await resolveInitAnswers(
    supplemented,
    registry,
    ports.modelRouting,
  );
  if (answers.kind === "invalid") {
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
    answers.answers.language !== legacy.language ||
    answers.answers.policyMode !== legacy.policyMode ||
    answers.answers.snapshots !== legacy.managedState.snapshots
  ) {
    return resultFailure("trail.output_invalido");
  }

  const destination = upgradeProjectConfiguration(
    legacy,
    answers.answers.modelRoles,
  );
  const destinationContent = `${JSON.stringify(destination, null, 2)}\n`;
  const destinationDigest = ports.digests.sha256(destinationContent);
  const seedDigest = ports.digests.sha256(
    canonicalizeJson({
      sourceDigest: entry.sha256,
      destinationDigest,
      hosts: answers.answers.hosts,
      modelRoles: destination.modelRoles,
      defaulted: answers.defaulted,
    }),
  );
  const migrationId = `config-${seedDigest.slice(0, 24)}`;
  const root = `.brain/migrations/${migrationId}`;
  const writes = [
    CONFIG_REF,
    `${root}/backup/config.json`,
    `${root}/authorization.json`,
    `${root}/rollback.json`,
    `${root}/receipt.json`,
    `${root}/verification.json`,
  ] as const;
  const planDigest = ports.digests.sha256(
    canonicalizeJson({
      kind: "project-config-replacement",
      migrationId,
      source: { ref: CONFIG_REF, sha256: entry.sha256 },
      destination: { ref: CONFIG_REF, sha256: destinationDigest },
      hosts: answers.answers.hosts,
      modelRoles: destination.modelRoles,
      defaulted: answers.defaulted,
      writes,
    }),
  );
  return {
    kind: "observed",
    ports,
    observation: {
      kind: "migration",
      operation: {
        kind: "config",
        migrationId,
        now: ports.clock.now().toISOString(),
        source: { content, sha256: entry.sha256 },
        destination,
        destinationDigest,
        planDigest,
        expected: { kind: "file", size: entry.size, sha256: entry.sha256 },
        hosts: [...answers.answers.hosts],
        defaulted: [...answers.defaulted],
        writes,
      },
    },
  };
}

async function migrationAnswers(
  invocation: Invocation,
  ports: RuntimePorts,
): Promise<
  | { readonly kind: "document"; readonly value: unknown }
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
    return { kind: "document", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "document", value: null };
  }
}

function supplementLegacyDefaults(
  document: unknown,
  legacy: ProjectConfigV1,
): unknown {
  if (!isRecord(document)) return document;
  return {
    ...document,
    language: document.language ?? legacy.language,
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

function resultFailure(
  reasonCode: string,
  evidenceRef?: string,
): Extract<ObservedMigration, { readonly kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor(reasonCode, {
      why: [
        reasonCode === "runtime.revision_conflict"
          ? "The observed migration source or destination changed after the authorized decision."
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
  const root = `.brain/migrations/${migrationId}`;
  let receipt: MigrationV1 | MigrationV1_1 | null = null;
  let targets: readonly string[] = [];
  let replacement: Extract<
    Extract<CommandObservation, { readonly kind: "migration" }>["operation"],
    { readonly kind: "rollback" }
  >["replacement"] = null;
  try {
    const receiptEntry = await ports.durableFileSystem.inspect(
      `${root}/receipt.json`,
    );
    const rollbackEntry = await ports.durableFileSystem.inspect(
      `${root}/rollback.json`,
    );
    if (receiptEntry.kind === "file" && rollbackEntry.kind === "file") {
      const rawReceipt = JSON.parse(
        await ports.durableFileSystem.readText(`${root}/receipt.json`),
      ) as unknown;
      const rollback = JSON.parse(
        await ports.durableFileSystem.readText(`${root}/rollback.json`),
      ) as unknown;
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

async function observeConfigReplacement(
  receipt: MigrationV1_1,
  rollbackManifest: unknown,
  migrationId: string,
  root: string,
  ports: RuntimePorts,
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
    receipt.conversions[0]?.payloadContract !== "state.project-config" ||
    receipt.conversions[0]?.sourceDigest !== receipt.backupDigest ||
    receipt.conversions[0]?.destinationDigest !==
      receipt.rollback.destinationDigest ||
    !validConfigRollbackManifest(rollbackManifest, receipt)
  ) {
    return { kind: "corrupt" };
  }
  const verificationEntry = await ports.durableFileSystem.inspect(
    `${root}/verification.json`,
  );
  const receiptEntry = await ports.durableFileSystem.inspect(
    `${root}/receipt.json`,
  );
  const backupEntry = await ports.durableFileSystem.inspect(
    receipt.rollback.backupRef,
  );
  const destinationEntry = await ports.durableFileSystem.inspect(
    receipt.rollback.destinationRef,
  );
  if (
    verificationEntry.kind !== "file" ||
    receiptEntry.kind !== "file" ||
    backupEntry.kind !== "file" ||
    backupEntry.sha256 !== receipt.rollback.backupDigest ||
    receiptEntry.sha256 !==
      ports.digests.sha256(
        await ports.durableFileSystem.readText(`${root}/receipt.json`),
      )
  ) {
    return { kind: "corrupt" };
  }
  if (
    destinationEntry.kind !== "file" ||
    destinationEntry.sha256 !== receipt.rollback.destinationDigest
  ) {
    return { kind: "revision-conflict" };
  }
  const [verificationText, backupContent] = await Promise.all([
    ports.durableFileSystem.readText(`${root}/verification.json`),
    ports.durableFileSystem.readText(receipt.rollback.backupRef),
  ]);
  const verification = JSON.parse(verificationText) as unknown;
  if (
    ports.digests.sha256(backupContent) !== receipt.rollback.backupDigest ||
    !validConfigVerification(verification, receipt)
  ) {
    return { kind: "corrupt" };
  }
  return {
    kind: "ready",
    value: {
      destinationRef: receipt.rollback.destinationRef,
      content: backupContent,
      expected: {
        kind: "file",
        size: destinationEntry.size,
        sha256: destinationEntry.sha256,
      },
      backupRef: receipt.rollback.backupRef,
      backupExpected: {
        kind: "file",
        size: backupEntry.size,
        sha256: backupEntry.sha256,
      },
      receiptExpected: {
        kind: "file",
        size: receiptEntry.size,
        sha256: receiptEntry.sha256,
      },
      backupDigest: receipt.rollback.backupDigest,
      destinationDigest: receipt.rollback.destinationDigest,
    },
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
    verifiedAt: receipt.updatedAt,
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
