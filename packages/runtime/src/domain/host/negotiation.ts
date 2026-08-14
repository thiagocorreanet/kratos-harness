import {
  classifyContractVersion,
  contractFailureResult,
  type ContractFailureResult,
} from "@mestre-yoda/contracts";

/**
 * The host contract a message declares, read before anything validates it.
 *
 * `adapter-message.v1` pins `hostContract` to a constant, so a host speaking a
 * different revision fails schema validation as a bad field rather than as an
 * unsupported host. Reading it structurally first is what lets the runtime name
 * the contract instead of naming a property, and it is the same order the
 * answers document already uses.
 */
function declaredContract(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return undefined;
  return (document as Record<string, unknown>).hostContract;
}

/**
 * Judge the host contract a message declares.
 *
 * Returns `null` when the declared revision is one this bundle accepts, and the
 * refusal otherwise. The supplied value never reaches the result: an adapter
 * that sent something hostile would otherwise have it echoed back.
 */
export function classifyHostContract(
  document: unknown,
): ContractFailureResult | null {
  const classification = classifyContractVersion(
    "host",
    declaredContract(document),
  );
  return classification.classification === "current"
    ? null
    : contractFailureResult(classification);
}

/**
 * Every capability a host declared, as explicit comparable data.
 *
 * Sorted and deduplicated so two hosts that offer the same things produce the
 * same list, and an adapter cannot change a decision by reordering. A value
 * that is not a capability identifier is dropped rather than refused: the
 * runtime must not fail an operation over an unknown field it does not need,
 * and dropping it here keeps a later reader from treating it as offered.
 */
export function normalizeCapabilities(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
  const kept = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    if (typeof entry === "string" && identifier.test(entry)) kept.add(entry);
  }
  return Object.freeze(
    [...kept].sort((left, right) => (left < right ? -1 : 1)),
  );
}

/**
 * Whether a host offers everything an operation needs.
 *
 * Missing capabilities are reported rather than worked around. ADR-0004 is
 * explicit that a host lacking a preventive hook does not remove the runtime's
 * own checks, so a caller reads this to explain a refusal, never to decide that
 * a check can be skipped.
 */
export function missingCapabilities(
  offered: readonly string[],
  required: readonly string[],
): readonly string[] {
  const available = new Set(offered);
  return Object.freeze(
    [...new Set(required)]
      .filter((capability) => !available.has(capability))
      .sort((left, right) => (left < right ? -1 : 1)),
  );
}
