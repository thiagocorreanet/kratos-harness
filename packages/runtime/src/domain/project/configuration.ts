import {
  classifyContractVersion,
  type ProjectConfigV1_4,
} from "@kratos/contracts";

import type { ConfigurationObservation } from "./observation.js";
import type { ConfigurationValidator } from "./validation.js";

type ConfigurationFailureReason =
  | "guard.config_missing"
  | "guard.config_corrupt"
  | "contract.state_version_invalid"
  | "contract.state_version_unsupported";

export type ConfigurationOutcome =
  | { readonly kind: "valid"; readonly value: ProjectConfigV1_4 }
  | {
      readonly kind: "migration-required";
      readonly reasonCode: "profile.config_migration_required";
    }
  | {
      readonly kind: "failure";
      readonly reasonCode: ConfigurationFailureReason;
    };

function failure(reasonCode: ConfigurationFailureReason): ConfigurationOutcome {
  return { kind: "failure", reasonCode };
}

function stateContract(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>).stateContract;
}

/** Parse, classify, and validate a project configuration without mutation. */
export function classifyConfiguration(
  observation: ConfigurationObservation,
  validate: ConfigurationValidator,
): ConfigurationOutcome {
  if (observation.kind === "absent") {
    return failure("guard.config_missing");
  }
  if (observation.kind === "other") {
    return failure("guard.config_corrupt");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.text) as unknown;
  } catch {
    return failure("guard.config_corrupt");
  }

  const classification = classifyContractVersion(
    "state",
    stateContract(parsed),
  );
  if (classification.classification === "invalid") {
    return failure("contract.state_version_invalid");
  }
  if (
    stateContract(parsed) === "1.0.0" ||
    stateContract(parsed) === "1.1.0" ||
    stateContract(parsed) === "1.2.0" ||
    stateContract(parsed) === "1.3.0"
  ) {
    return {
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    };
  }
  if (classification.classification === "migration_required") {
    return failure("contract.state_version_unsupported");
  }
  if (classification.classification === "unsupported") {
    return failure("contract.state_version_unsupported");
  }

  const validated = validate(parsed);
  return validated.kind === "valid"
    ? { kind: "valid", value: validated.value as ProjectConfigV1_4 }
    : failure("guard.config_corrupt");
}
