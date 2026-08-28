import type {
  ContractId,
  ContractValue,
  StructuralReasonCode,
} from "./contracts.js";

export interface ContractRequest<I extends ContractId, V = unknown> {
  readonly id: I;
  readonly version: V;
  readonly value: unknown;
  readonly structuralReasonCode: StructuralReasonCode;
}

export interface ValidationDiagnostic {
  readonly contract: ContractId;
  readonly version: string | null;
  readonly pointer: string;
  readonly keyword: string;
  readonly reasonCode: string;
  readonly recovery: string;
}

export type ValidationResult<T> =
  | { readonly kind: "valid"; readonly value: T }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ValidationDiagnostic[];
    };

export interface SchemaRegistry {
  validate<I extends ContractId, V>(
    request: ContractRequest<I, V>,
  ): ValidationResult<ContractValue<I, V>>;
}
