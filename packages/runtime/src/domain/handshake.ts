import {
  CONTRACT_IDENTITIES,
  KRATOS_VERSION,
  classifyContractVersion,
  contractFailureResult,
  type AdapterMessageV1,
  type ContractFailureResult,
} from "@kratos/contracts";

/** Answer a host with the contract versions this bundle carries. */
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
    observedIdentity: { adapterVersion: KRATOS_VERSION, model: null },
    payloadContract: "result@1.0.0",
    payload: {
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "runtime.orientation_ok",
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

/** Classify a caller's plugin-version pin without echoing its value. */
export function classifyExpectedVersion(
  value: unknown,
): ContractFailureResult | null {
  const classification = classifyContractVersion("plugin", value);
  return classification.classification === "current"
    ? null
    : contractFailureResult(classification);
}
