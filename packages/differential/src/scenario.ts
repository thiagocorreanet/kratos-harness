import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import type { DifferentialScenario } from "./types.ts";

const defaultSchemaPath = join(
  import.meta.dirname,
  "../../../schemas/compatibility/differential-scenario.v1.schema.json",
);
const defaultObservationSchemaPath = join(
  import.meta.dirname,
  "../../../schemas/compatibility/differential-observation.v1.schema.json",
);
const defaultMatrixPath = join(
  import.meta.dirname,
  "../../../compatibility/inventory/go-v3-v0.6.5/matrix.json",
);
const unsafePath =
  /(?:^|\/)(?:\.{1,2}|)(?:\/|$)|\\|^[A-Za-z]:|^[a-z][a-z0-9+.-]*:/iu;

interface MatrixDocument {
  rows: readonly { id: string }[];
}

function publicScenarioId(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id)
  ) {
    return value.id;
  }
  return "unknown";
}

export function validateSafeRelativePath(path: string): string {
  let hasControlCharacter = false;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      hasControlCharacter = true;
      break;
    }
  }
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("//") ||
    hasControlCharacter ||
    unsafePath.test(path)
  ) {
    throw new Error("Differential scenario path is unsafe");
  }
  return path;
}

export async function loadScenario(
  path: string,
  matrixPath = defaultMatrixPath,
): Promise<DifferentialScenario> {
  const [scenarioSource, schemaSource, observationSchemaSource, matrixSource] =
    await Promise.all([
      readFile(path, "utf8"),
      readFile(defaultSchemaPath, "utf8"),
      readFile(defaultObservationSchemaPath, "utf8"),
      readFile(matrixPath, "utf8"),
    ]);
  const candidate: unknown = JSON.parse(scenarioSource);
  const scenarioId = publicScenarioId(candidate);
  const ajv = new Ajv2020({ allErrors: false, strict: true });
  ajv.addSchema(JSON.parse(observationSchemaSource) as AnySchemaObject);
  const validate = ajv.compile(JSON.parse(schemaSource) as AnySchemaObject);
  if (!validate(candidate)) {
    const keyword = validate.errors?.[0]?.keyword ?? "schema";
    throw new Error(
      `Differential scenario ${scenarioId} is invalid: ${keyword}`,
    );
  }

  const scenario = candidate as DifferentialScenario;
  const matrix = JSON.parse(matrixSource) as MatrixDocument;
  const rowIds = new Set(matrix.rows.map(({ id }) => id));
  if (scenario.parityContractIds.some((id) => !rowIds.has(id))) {
    throw new Error(
      `Differential scenario ${scenario.id} references an unknown parity contract`,
    );
  }

  const foldedPaths = new Set<string>();
  for (const entry of scenario.workspace.entries) {
    validateSafeRelativePath(entry.path);
    if (entry.type === "symlink") validateSafeRelativePath(entry.target);
    const folded = entry.path.toLocaleLowerCase("en-US");
    if (foldedPaths.has(folded)) {
      throw new Error(
        `Differential scenario ${scenario.id} contains colliding workspace paths`,
      );
    }
    foldedPaths.add(folded);
  }

  return scenario;
}
