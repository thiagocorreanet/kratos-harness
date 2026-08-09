import { reasonPolicy } from "@mestre-yoda/contracts";
import type { ErrorObject } from "ajv/dist/2020.js";

import type {
  ContractId,
  StructuralReasonCode,
  ValidationDiagnostic,
} from "../../domain/schema/index.js";

function registryIntegrityError(): Error {
  return new Error("Embedded schema registry is invalid");
}

function recoveryFor(reasonCode: StructuralReasonCode): string {
  const recovery = reasonPolicy(reasonCode)?.recovery;
  if (recovery === null || recovery === undefined) {
    throw registryIntegrityError();
  }
  return recovery;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function requiredProperty(error: ErrorObject): string | undefined {
  if (error.keyword !== "required") return undefined;
  const missingProperty = (error.params as Readonly<Record<string, unknown>>)
    .missingProperty;
  return typeof missingProperty === "string" ? missingProperty : undefined;
}

function normalizedPointer(error: ErrorObject): string {
  const parent = error.instancePath === "" ? "" : error.instancePath;
  const property = requiredProperty(error);
  if (property === undefined) return parent;
  return `${parent}/${escapePointerSegment(property)}`;
}

function diagnosticKey(diagnostic: ValidationDiagnostic): string {
  return JSON.stringify([
    diagnostic.contract,
    diagnostic.version,
    diagnostic.pointer,
    diagnostic.keyword,
    diagnostic.reasonCode,
    diagnostic.recovery,
  ]);
}

export function normalizeAjvDiagnostics(
  errors: readonly ErrorObject[] | null | undefined,
  contract: ContractId,
  version: string,
  structuralReasonCode: StructuralReasonCode,
): readonly ValidationDiagnostic[] {
  const recovery = recoveryFor(structuralReasonCode);
  if (!errors?.length) {
    throw registryIntegrityError();
  }

  const unique = new Map<string, ValidationDiagnostic>();
  for (const error of errors) {
    const diagnostic: ValidationDiagnostic = {
      contract,
      version,
      pointer: normalizedPointer(error),
      keyword: error.keyword,
      reasonCode: structuralReasonCode,
      recovery,
    };
    unique.set(diagnosticKey(diagnostic), diagnostic);
  }

  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.pointer, right.pointer) ||
      compareText(left.keyword, right.keyword),
  );
}

export function dataShapeDiagnostics(
  contract: ContractId,
  version: string,
  structuralReasonCode: StructuralReasonCode,
): readonly ValidationDiagnostic[] {
  return [
    {
      contract,
      version,
      pointer: "",
      keyword: "type",
      reasonCode: structuralReasonCode,
      recovery: recoveryFor(structuralReasonCode),
    },
  ];
}
