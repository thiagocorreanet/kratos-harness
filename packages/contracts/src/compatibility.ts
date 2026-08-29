import contractManifest from "../catalogs/contract-families.v1.json" with { type: "json" };
import reasonCatalog from "../catalogs/reason-codes.v1.8.json" with { type: "json" };

/**
 * The contract identities this bundle carries. Consumers report these rather
 * than reading the manifest from disk, so a bundled runtime stays
 * self-contained.
 */
export const CONTRACT_IDENTITIES = {
  plugin: contractManifest.pluginVersion,
  result: contractManifest.resultContract,
  reasonCatalog: contractManifest.reasonCatalog,
  state: contractManifest.stateContract.current,
  host: contractManifest.hostContract.current,
} as const;

export const CONTRACT_VERSIONS = {
  "host.adapter-message": "1.1.0",
  "state.project-config": "1.2.0",
  "state.event": "1.1.0",
  "state.migration": "1.1.0",
  "host.init-answers": "1.2.0",
  "host.phase-handoff": "1.1.0",
  "host.agent-output": "1.0.0",
  "host.gap-proposal": "1.0.0",
  "host.hook-observation": "1.0.0",
  "host.operation-message": "1.0.0",
  "host.pre-tool-use": "1.0.0",
  "state.acceptance-criteria-snapshot": "1.0.0",
  "state.acceptance-verdict": "1.0.0",
  "state.approval": "1.0.0",
  "state.evidence": "1.0.0",
  "state.failure-candidate": "1.0.0",
  "state.feature": "1.0.0",
  "state.feature-scope": "1.0.0",
  "state.gap": "1.0.0",
  "state.gates": "1.0.0",
  "state.guardrails": "1.0.0",
  "state.lock": "1.0.0",
  "state.requirement-discovery": "1.0.0",
  "state.run-usage": "1.0.0",
  "state.session-telemetry": "1.0.0",
  "state.snapshot": "1.0.0",
  "state.transaction-manifest": "1.0.0",
  "state.transaction-progress": "1.0.0",
} as const;

export type ContractFamily = "plugin" | "state" | "host";
export type CompatibilityClass =
  "current" | "migration_required" | "invalid" | "unsupported";

type ContractReasonCode =
  | "contract.plugin_version_invalid"
  | "contract.plugin_version_unsupported"
  | "contract.host_version_invalid"
  | "contract.host_version_unsupported"
  | "contract.state_version_invalid"
  | "contract.state_version_unsupported";

export interface ContractClassification {
  readonly family: ContractFamily;
  readonly classification: CompatibilityClass;
  readonly reasonCode: ContractReasonCode | null;
  readonly selectedVersion: string | null;
}

export interface ContractFailureResult {
  readonly contractVersion: "1.0.0";
  readonly status: "failure" | "blocked";
  readonly exitCode: number;
  readonly reasonCode: ContractReasonCode;
  readonly summary: string;
  readonly why: readonly [string];
  readonly evidence: readonly [];
  readonly stateChanged: false;
  readonly retryable: false;
  readonly recovery: string;
}

const exactSemver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

const familyWhy: Record<ContractFamily, string> = {
  plugin: "The installed plugin identity did not pass compatibility checks.",
  state: "The persisted state identity did not pass compatibility checks.",
  host: "The host adapter identity did not pass compatibility checks.",
};

function reasonCode(
  family: ContractFamily,
  kind: "invalid" | "unsupported",
): ContractReasonCode {
  return `contract.${family}_version_${kind}`;
}

function rejected(
  family: ContractFamily,
  classification: "invalid" | "unsupported",
): ContractClassification {
  return {
    family,
    classification,
    reasonCode: reasonCode(family, classification),
    selectedVersion: null,
  };
}

function isCurrent(family: ContractFamily, value: string): boolean {
  if (family === "plugin") return value === contractManifest.pluginVersion;
  if (family === "state") {
    return contractManifest.stateContract.readable.includes(value);
  }
  return contractManifest.hostContract.accepted.includes(value);
}

export function classifyContractVersion(
  family: ContractFamily,
  value: unknown,
): ContractClassification {
  if (
    family === "state" &&
    typeof value === "string" &&
    contractManifest.stateContract.migrationOnly.includes(value)
  ) {
    return {
      family,
      classification: "migration_required",
      reasonCode: null,
      selectedVersion: null,
    };
  }
  if (typeof value !== "string" || !exactSemver.test(value)) {
    return rejected(family, "invalid");
  }
  if (isCurrent(family, value)) {
    return {
      family,
      classification: "current",
      reasonCode: null,
      selectedVersion: value,
    };
  }
  return rejected(family, "unsupported");
}

export function contractFailureResult(
  classification: ContractClassification,
): ContractFailureResult {
  if (
    classification.reasonCode === null ||
    (classification.classification !== "invalid" &&
      classification.classification !== "unsupported")
  ) {
    throw new Error(
      "Contract failure result requires a rejected classification",
    );
  }
  if (
    classification.reasonCode !==
    reasonCode(classification.family, classification.classification)
  ) {
    throw new Error("Contract failure classification is inconsistent");
  }
  const reason = reasonCatalog.reasons.find(
    ({ code }) => code === classification.reasonCode,
  );
  if (
    reason === undefined ||
    (reason.status !== "failure" && reason.status !== "blocked") ||
    reason.recovery === null
  ) {
    throw new Error("Contract failure policy is unavailable");
  }
  return {
    contractVersion: "1.0.0",
    status: reason.status,
    exitCode: reason.exitCode,
    reasonCode: classification.reasonCode,
    summary: reason.description,
    why: [familyWhy[classification.family]],
    evidence: [],
    stateChanged: false,
    retryable: false,
    recovery: reason.recovery,
  };
}
