export type PathFingerprint =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" }
  | {
      readonly kind: "file";
      readonly size: number;
      readonly sha256: string;
    };

interface ManagedOperationBase {
  readonly operationId: string;
  readonly path: string;
  readonly expected: PathFingerprint;
  readonly result: PathFingerprint;
}

export interface ManagedCreateDirectoryOperation extends ManagedOperationBase {
  readonly kind: "create_directory";
  readonly stagedPath: null;
}

export interface ManagedWriteFileOperation extends ManagedOperationBase {
  readonly kind: "write_file";
  readonly stagedPath: string;
  readonly content: string;
}

export interface ManagedDeleteFileOperation extends ManagedOperationBase {
  readonly kind: "delete_file";
  readonly stagedPath: null;
}

export type ManagedOperation =
  | ManagedCreateDirectoryOperation
  | ManagedWriteFileOperation
  | ManagedDeleteFileOperation;

export type PersistedManagedOperation =
  | ManagedCreateDirectoryOperation
  | Omit<ManagedWriteFileOperation, "content">
  | ManagedDeleteFileOperation;

export interface ManagedMutationPlan {
  readonly operations: readonly ManagedOperation[];
}

export interface TransactionObservation {
  readonly destinations: ReadonlyMap<string, PathFingerprint>;
  readonly stagedPayloads: ReadonlyMap<string, PathFingerprint>;
}

export type RecoveryDecision =
  | { readonly kind: "abort" }
  | { readonly kind: "record_published"; readonly operationId: string }
  | { readonly kind: "publish"; readonly operationId: string }
  | { readonly kind: "commit" }
  | { readonly kind: "cleanup"; readonly terminal: "committed" | "aborted" }
  | { readonly kind: "complete"; readonly terminal: "committed" | "aborted" }
  | {
      readonly kind: "blocked";
      readonly reasonCode: "runtime.state_corrupt";
      readonly operationId: string | null;
    };

export class TransactionPolicyError extends Error {
  public constructor(
    public readonly reasonCode: "guard.outside_allow" | "runtime.state_corrupt",
  ) {
    super("Managed mutation plan is invalid");
    this.name = "TransactionPolicyError";
  }
}

export function toPersistedManagedOperation(
  operation: ManagedOperation,
): PersistedManagedOperation {
  if (operation.kind !== "write_file") return operation;
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    path: operation.path,
    expected: operation.expected,
    result: operation.result,
    stagedPath: operation.stagedPath,
  };
}
