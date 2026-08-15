import type { MigrationV1 } from "@kratos/contracts";

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
