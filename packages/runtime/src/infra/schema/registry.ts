import type {
  ContractClassification,
  classifyContractVersion as classifyVersion,
  contractFailureResult as contractFailure,
} from "@kratos/contracts";
import type { ValidateFunction } from "ajv/dist/2020.js";

import type {
  ContractId,
  ContractRequest,
  SchemaRegistry,
  ValidationDiagnostic,
} from "../../domain/schema/index.js";
import { assertObjectPrototypeEnvironmentSafe } from "./prototype-environment.js";
import type { EmbeddedSchemaEntry } from "./types.js";

const REGISTRY_INTEGRITY_ERROR = "Embedded schema registry is invalid";

assertObjectPrototypeEnvironmentSafe();

const contractsModule = await import("@kratos/contracts");
const ajvModule = await import("ajv/dist/2020.js");
const catalogModule = await import("./catalog.js");
const dataShapeModule = await import("./data-shape.js");
const diagnosticsModule = await import("./diagnostics.js");

const classifyContractVersion: typeof classifyVersion =
  contractsModule.classifyContractVersion;
const contractFailureResult: typeof contractFailure =
  contractsModule.contractFailureResult;
const { Ajv2020 } = ajvModule;
const {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  assertSchemaCatalog,
} = catalogModule;
const { isInertJsonData } = dataShapeModule;
const { dataShapeDiagnostics, normalizeAjvDiagnostics } = diagnosticsModule;

function registryIntegrityError(): Error {
  return new Error(REGISTRY_INTEGRITY_ERROR);
}

function registryKey(id: ContractId, version: string): string {
  return `${id}\u0000${version}`;
}

function schemaId(schema: object): string {
  const id = (schema as Readonly<Record<string, unknown>>).$id;
  if (typeof id !== "string" || id.length === 0) {
    throw registryIntegrityError();
  }
  return id;
}

function requestedVersion(
  classification: ContractClassification,
  value: unknown,
): string | null {
  if (classification.classification === "invalid") return null;
  if (classification.classification === "migration_required") {
    const syntax = classifyContractVersion("host", value);
    return syntax.classification === "invalid" ? null : (value as string);
  }
  // Every non-invalid compatibility classification carries parsed string
  // syntax; invalid values returned above before reaching this invariant.
  return value as string;
}

function rejectedClassification(
  classification: ContractClassification,
): ContractClassification {
  if (classification.classification !== "migration_required") {
    return classification;
  }
  return {
    family: "state",
    classification: "unsupported",
    reasonCode: "contract.state_version_unsupported",
    selectedVersion: null,
  };
}

function versionDiagnostic(
  id: ContractId,
  version: unknown,
  classification: ContractClassification,
): ValidationDiagnostic {
  const failure = contractFailureResult(rejectedClassification(classification));
  return {
    contract: id,
    version: requestedVersion(classification, version),
    pointer: "",
    keyword: "version",
    reasonCode: failure.reasonCode,
    recovery: failure.recovery,
  };
}

export function compileSchemaRegistry(
  entries: readonly EmbeddedSchemaEntry[],
  dependencies: readonly object[],
): SchemaRegistry {
  const validators = new Map<string, ValidateFunction>();
  const families = new Map<ContractId, "state" | "host">();

  try {
    assertObjectPrototypeEnvironmentSafe();
    assertSchemaCatalog(entries);
    const ajv = new Ajv2020({
      allErrors: true,
      coerceTypes: false,
      ownProperties: true,
      removeAdditional: false,
      strict: true,
      useDefaults: false,
      validateFormats: false,
    });

    for (const dependency of dependencies) {
      ajv.addSchema(dependency);
    }
    for (const entry of entries) {
      ajv.addSchema(entry.schema);
      families.set(entry.id, entry.family);
    }
    for (const entry of entries) {
      const validator = ajv.getSchema(schemaId(entry.schema));
      if (validator === undefined) throw registryIntegrityError();
      validators.set(registryKey(entry.id, entry.version), validator);
    }
  } catch {
    throw registryIntegrityError();
  }

  const validate = (request: ContractRequest<ContractId>) => {
    const id = request.id;
    const family = families.get(id);
    if (family === undefined) throw registryIntegrityError();
    const requestedContractVersion = request.version;
    const classification = classifyContractVersion(
      family,
      requestedContractVersion,
    );
    if (classification.classification !== "current") {
      try {
        return {
          kind: "invalid" as const,
          diagnostics: [
            versionDiagnostic(id, requestedContractVersion, classification),
          ],
        };
      } catch {
        throw registryIntegrityError();
      }
    }

    const version = classification.selectedVersion;
    if (version === null) throw registryIntegrityError();
    const validator = validators.get(registryKey(id, version));
    if (validator === undefined) throw registryIntegrityError();
    try {
      const structuralReasonCode = request.structuralReasonCode;
      const value = request.value;
      if (!isInertJsonData(value)) {
        return {
          kind: "invalid" as const,
          diagnostics: dataShapeDiagnostics(id, version, structuralReasonCode),
        };
      }
      if (!validator(value)) {
        return {
          kind: "invalid" as const,
          diagnostics: normalizeAjvDiagnostics(
            validator.errors,
            id,
            version,
            structuralReasonCode,
          ),
        };
      }
      return {
        kind: "valid" as const,
        // AJV accepted this exact request's schema. The public registry
        // signature reconnects this runtime-validated value to its selected
        // contract type without forcing TypeScript to expand every contract
        // union at this generic implementation boundary.
        value,
      };
    } catch {
      throw registryIntegrityError();
    }
  };
  return Object.freeze({ validate }) as SchemaRegistry;
}

export function ajvSchemaRegistry(): SchemaRegistry {
  return compileSchemaRegistry(
    EMBEDDED_SCHEMA_CATALOG,
    EMBEDDED_SCHEMA_DEPENDENCIES,
  );
}
