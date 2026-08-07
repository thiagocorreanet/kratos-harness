import {
  CONTRACT_IDENTITIES,
  YODA_VERSION,
  classifyContractVersion,
  contractFailureResult,
  type AdapterMessageV1,
  type ContractFailureResult,
} from "@mestre-yoda/contracts";

/**
 * Answer a host's compatibility handshake with the contract versions this
 * bundle carries. The full request/response conversation belongs to the host
 * adapter protocol; this is the runtime's half of it.
 */
export function buildHandshakeResponse(
  correlationId: string,
): AdapterMessageV1 {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: "handshake-response",
    messageType: "response",
    host: "unknown",
    operation: "handshake",
    capabilities: [],
    // A directly invoked runtime was handed no host identity to observe, and
    // the contract requires reporting that rather than inventing one.
    observedIdentity: { adapterVersion: YODA_VERSION, model: null },
    payloadContract: "result@1.0.0",
    payload: {
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "trail.ok",
      summary: `Plugin ${CONTRACT_IDENTITIES.plugin} carries result ${CONTRACT_IDENTITIES.result}, reasons ${CONTRACT_IDENTITIES.reasonCatalog}, state ${CONTRACT_IDENTITIES.state}, and host ${CONTRACT_IDENTITIES.host}.`,
      why: [],
      evidence: [],
      stateChanged: false,
      retryable: false,
      recovery: null,
    },
    correlationId,
  };
}

/**
 * Classify the version a caller pinned with `--expect`. Returns `null` when it
 * matches this bundle exactly, and a renderable failure otherwise. The supplied
 * value is never echoed back.
 */
export function classifyExpectedVersion(
  value: unknown,
): ContractFailureResult | null {
  const classification = classifyContractVersion("plugin", value);
  return classification.classification === "current"
    ? null
    : contractFailureResult(classification);
}
