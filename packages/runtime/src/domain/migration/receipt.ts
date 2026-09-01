import type { MigrationV1, MigrationV1_1 } from "@kratos/contracts";

export interface MigrationReceiptRequest {
  readonly migrationId: string;
  readonly sourceContract: MigrationV1["sourceContract"];
  readonly planDigest: string;
  readonly authorizationRef: string;
  readonly backupDigest: string;
  readonly conversions: MigrationV1["conversions"];
  readonly rollbackRef: string;
  readonly now: string;
}

export function plannedMigration(
  request: MigrationReceiptRequest,
): MigrationV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    migrationId: request.migrationId,
    sourceContract: request.sourceContract,
    destinationContract: "1.0.0",
    planDigest: request.planDigest,
    authorizationRef: request.authorizationRef,
    backupDigest: request.backupDigest,
    status: "planned",
    conversions: [...request.conversions],
    verificationRefs: [],
    rollbackRef: request.rollbackRef,
    createdAt: request.now,
    updatedAt: request.now,
  };
}

export function authorizeMigration(
  receipt: MigrationV1,
  planDigest: string,
  authorizationRef: string,
  now: string,
): MigrationV1 | null {
  if (
    receipt.status !== "planned" ||
    receipt.planDigest !== planDigest ||
    receipt.authorizationRef !== authorizationRef
  ) {
    return null;
  }
  return { ...receipt, status: "authorized", updatedAt: now };
}

export function completeMigration(
  receipt: MigrationV1,
  verificationRefs: readonly string[],
  now: string,
): MigrationV1 | null {
  if (receipt.status !== "authorized" || verificationRefs.length === 0) {
    return null;
  }
  return {
    ...receipt,
    status: "completed",
    verificationRefs: [...new Set(verificationRefs)].sort(),
    updatedAt: now,
  };
}

export function rollBackMigration(
  receipt: MigrationV1,
  observedBackupDigest: string,
  now: string,
): MigrationV1 | null {
  if (
    receipt.status !== "completed" ||
    receipt.backupDigest !== observedBackupDigest
  ) {
    return null;
  }
  return { ...receipt, status: "rolled-back", updatedAt: now };
}

export interface ConfigMigrationReceiptRequest {
  readonly migrationId: string;
  readonly planDigest: string;
  readonly authorizationRef: string;
  readonly backupRef: string;
  readonly backupDigest: string;
  readonly destinationRef: string;
  readonly destinationDigest: string;
  readonly verificationRef: string;
  readonly now: string;
}

/** Build the v1.1 receipt for one exact configuration replacement. */
export function plannedConfigMigration(
  request: ConfigMigrationReceiptRequest,
): MigrationV1_1 {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    migrationId: request.migrationId,
    sourceContract: "1.0.0",
    destinationContract: "1.1.0",
    planDigest: request.planDigest,
    authorizationRef: request.authorizationRef,
    backupDigest: request.backupDigest,
    status: "planned",
    conversions: [
      {
        payloadContract: "state.project-config",
        sourceDigest: request.backupDigest,
        destinationDigest: request.destinationDigest,
      },
    ],
    verificationRefs: [],
    rollback: {
      kind: "replace",
      backupRef: request.backupRef,
      backupDigest: request.backupDigest,
      destinationRef: request.destinationRef,
      destinationDigest: request.destinationDigest,
    },
    createdAt: request.now,
    updatedAt: request.now,
  };
}

/** A replacement receipt for legacy free-form memory adoption. */
export function plannedMemoryMigration(
  request: ConfigMigrationReceiptRequest,
): MigrationV1_1 {
  const receipt = plannedConfigMigration(request);
  return {
    ...receipt,
    conversions: [
      {
        payloadContract: "state.curated-memory",
        sourceDigest: request.backupDigest,
        destinationDigest: request.destinationDigest,
      },
    ],
  };
}

export interface MemoryMigrationWrite {
  readonly path: string;
  readonly content: string;
}

/** Audit/write set for the adjacent curated-memory v1 -> v1.1 replacement. */
export function plannedCuratedMemoryUpgradeWrites(input: {
  readonly migrationId: string;
  readonly receiptPlanDigest: string;
  readonly proposalDigest: string;
  readonly source: { readonly content: string; readonly sha256: string };
  readonly ledgerContent: string;
  readonly ledgerDigest: string;
  readonly now: string;
}): readonly MemoryMigrationWrite[] {
  const root = `.brain/migrations/${input.migrationId}`;
  const authorizationRef = `${root}/authorization.json`;
  const backupRef = `${root}/backup/curated-memory.json`;
  const rollbackRef = `${root}/rollback.json`;
  const verificationRef = `${root}/verification.json`;
  const planned = plannedMemoryMigration({
    migrationId: input.migrationId,
    planDigest: input.receiptPlanDigest,
    authorizationRef,
    backupRef,
    backupDigest: input.source.sha256,
    destinationRef: ".brain/03-memory/curated-memory.json",
    destinationDigest: input.ledgerDigest,
    verificationRef,
    now: input.now,
  });
  const authorized = authorizeConfigMigration(
    planned,
    input.receiptPlanDigest,
    authorizationRef,
    input.now,
  );
  const receipt =
    authorized === null
      ? null
      : completeConfigMigration(
          authorized,
          verificationRef,
          input.ledgerDigest,
          input.now,
        );
  if (receipt === null) throw new Error("memory upgrade receipt invariant");
  const json = (value: unknown): string =>
    `${JSON.stringify(value, null, 2)}\n`;
  return [
    {
      path: ".brain/03-memory/curated-memory.json",
      content: input.ledgerContent,
    },
    {
      path: authorizationRef,
      content: json({
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        migrationId: input.migrationId,
        proposalDigest: input.proposalDigest,
        planDigest: input.receiptPlanDigest,
        source: {
          ref: ".brain/03-memory/curated-memory.json",
          sha256: input.source.sha256,
        },
        authorizedAt: input.now,
      }),
    },
    { path: backupRef, content: input.source.content },
    {
      path: rollbackRef,
      content: json({
        kind: "memory-state-replace",
        migrationId: input.migrationId,
        backupRef,
        backupDigest: input.source.sha256,
        destinationRef: ".brain/03-memory/curated-memory.json",
        destinationDigest: input.ledgerDigest,
        removeTargets: [],
      }),
    },
    {
      path: verificationRef,
      content: json({
        migrationId: input.migrationId,
        destinationDigest: input.ledgerDigest,
        verifiedAt: input.now,
      }),
    },
    { path: `${root}/receipt.json`, content: json(receipt) },
  ];
}

/** One immutable audit/write set; outer authorization hashes these exact bytes. */
export function plannedMemoryMigrationWrites(input: {
  readonly migrationId: string;
  readonly receiptPlanDigest: string;
  readonly proposalDigest: string;
  readonly source: { readonly content: string; readonly sha256: string };
  readonly ledgerContent: string;
  readonly ledgerDigest: string;
  readonly projection: string;
  readonly projectionDigest: string;
  readonly now: string;
}): readonly MemoryMigrationWrite[] {
  const root = `.brain/migrations/${input.migrationId}`;
  const authorizationRef = `${root}/authorization.json`;
  const backupRef = `${root}/backup/gotchas.md`;
  const rollbackRef = `${root}/rollback.json`;
  const receiptRef = `${root}/receipt.json`;
  const verificationRef = `${root}/verification.json`;
  const planned = plannedMemoryMigration({
    migrationId: input.migrationId,
    planDigest: input.receiptPlanDigest,
    authorizationRef,
    backupRef,
    backupDigest: input.source.sha256,
    destinationRef: ".brain/03-memory/gotchas.md",
    destinationDigest: input.projectionDigest,
    verificationRef,
    now: input.now,
  });
  const authorized = authorizeConfigMigration(
    planned,
    input.receiptPlanDigest,
    authorizationRef,
    input.now,
  );
  const receipt =
    authorized === null
      ? null
      : completeConfigMigration(
          authorized,
          verificationRef,
          input.projectionDigest,
          input.now,
        );
  if (receipt === null) throw new Error("memory migration receipt invariant");
  const json = (value: unknown): string =>
    `${JSON.stringify(value, null, 2)}\n`;
  return [
    {
      path: ".brain/03-memory/curated-memory.json",
      content: input.ledgerContent,
    },
    { path: ".brain/03-memory/gotchas.md", content: input.projection },
    {
      path: authorizationRef,
      content: json({
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        migrationId: input.migrationId,
        proposalDigest: input.proposalDigest,
        planDigest: input.receiptPlanDigest,
        source: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: input.source.sha256,
        },
        authorizedAt: input.now,
      }),
    },
    { path: backupRef, content: input.source.content },
    {
      path: rollbackRef,
      content: json({
        kind: "memory-replace",
        migrationId: input.migrationId,
        backupRef,
        backupDigest: input.source.sha256,
        destinationRef: ".brain/03-memory/gotchas.md",
        destinationDigest: input.projectionDigest,
        removeTargets: [".brain/03-memory/curated-memory.json"],
      }),
    },
    {
      path: verificationRef,
      content: json({
        migrationId: input.migrationId,
        destinationDigest: input.projectionDigest,
        ledgerDigest: input.ledgerDigest,
        verifiedAt: input.now,
      }),
    },
    { path: receiptRef, content: json(receipt) },
  ];
}

export function authorizeConfigMigration(
  receipt: MigrationV1_1,
  planDigest: string,
  authorizationRef: string,
  now: string,
): MigrationV1_1 | null {
  if (
    receipt.status !== "planned" ||
    receipt.planDigest !== planDigest ||
    receipt.authorizationRef !== authorizationRef
  ) {
    return null;
  }
  return { ...receipt, status: "authorized", updatedAt: now };
}

export function completeConfigMigration(
  receipt: MigrationV1_1,
  verificationRef: string,
  observedDestinationDigest: string,
  now: string,
): MigrationV1_1 | null {
  if (
    receipt.status !== "authorized" ||
    receipt.rollback.kind !== "replace" ||
    receipt.rollback.destinationDigest !== observedDestinationDigest
  ) {
    return null;
  }
  return {
    ...receipt,
    status: "completed",
    verificationRefs: [verificationRef],
    updatedAt: now,
  };
}

export function rollBackConfigMigration(
  receipt: MigrationV1_1,
  observedBackupDigest: string,
  observedDestinationDigest: string,
  now: string,
): MigrationV1_1 | null {
  if (
    receipt.status !== "completed" ||
    receipt.rollback.kind !== "replace" ||
    receipt.backupDigest !== observedBackupDigest ||
    receipt.rollback.backupDigest !== observedBackupDigest ||
    receipt.rollback.destinationDigest !== observedDestinationDigest
  ) {
    return null;
  }
  return { ...receipt, status: "rolled-back", updatedAt: now };
}
