import { canonicalizeJson } from "./canonical-json.js";
import type { ContractId, ContractValue } from "./contracts.js";
import type {
  ContractRequest,
  SchemaRegistry,
  ValidationDiagnostic,
} from "./validation.js";

export type PreparedContract<I extends ContractId> =
  | {
      readonly kind: "valid";
      readonly value: ContractValue<I>;
      readonly canonical: string;
    }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ValidationDiagnostic[];
    };

export function prepareContract<I extends ContractId>(
  registry: SchemaRegistry,
  request: ContractRequest<I>,
): PreparedContract<I> {
  const result = registry.validate(request);
  if (result.kind === "invalid") return result;

  return {
    kind: "valid",
    value: result.value,
    canonical: canonicalizeJson(result.value),
  };
}
