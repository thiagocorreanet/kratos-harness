export {
  TransactionPolicyError,
  toPersistedManagedOperation,
  type ManagedCreateDirectoryOperation,
  type ManagedDeleteFileOperation,
  type ManagedMutationPlan,
  type ManagedOperation,
  type ManagedWriteFileOperation,
  type PathFingerprint,
  type PersistedManagedOperation,
  type RecoveryDecision,
  type TransactionObservation,
} from "./model.js";
export {
  managedPathCollisionKey,
  normalizeManagedMutationPlan,
} from "./normalize.js";
export { decideRecovery } from "./recovery.js";
export { assertPhaseTransition } from "./transition.js";
