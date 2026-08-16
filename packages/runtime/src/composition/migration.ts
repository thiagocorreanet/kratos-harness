import { basename, dirname, join } from "node:path";

import type { MigrationV1 } from "@kratos/contracts";

import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import {
  planBrainMigration,
  type MigrationEntry,
} from "../domain/migration/index.js";
import type { Result } from "../domain/result/index.js";
import { usageFailure, USAGE_WHY } from "../domain/result/index.js";
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
  const destination = createRuntimeAt(target, sharedPorts(ports));
  if (invocation.command.path.join(" ") === "migrate rollback") {
    return observeRollback(invocation, destination, registry);
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
  let receipt: MigrationV1 | null = null;
  let targets: readonly string[] = [];
  try {
    const receiptEntry = await ports.durableFileSystem.inspect(
      `${root}/receipt.json`,
    );
    const rollbackEntry = await ports.durableFileSystem.inspect(
      `${root}/rollback.json`,
    );
    if (receiptEntry.kind === "file" && rollbackEntry.kind === "file") {
      const validated = registry.validate({
        id: "state.migration",
        version: "1.0.0",
        value: JSON.parse(
          await ports.durableFileSystem.readText(`${root}/receipt.json`),
        ) as unknown,
        structuralReasonCode: "runtime.state_corrupt",
      });
      const rollback = JSON.parse(
        await ports.durableFileSystem.readText(`${root}/rollback.json`),
      ) as unknown;
      if (
        validated.kind === "valid" &&
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
        now: ports.clock.now().toISOString(),
      },
    },
  };
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
