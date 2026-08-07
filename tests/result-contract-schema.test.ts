import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const resultSchemaPath = join(repositoryRoot, "schemas/result.v1.schema.json");
const catalogSchemaPath = join(
  repositoryRoot,
  "schemas/reason-catalog.v1.schema.json",
);
const catalogPath = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.json",
);

type JsonObject = Record<string, unknown>;

let resultSchema: JsonObject;
let catalogSchema: JsonObject;
let catalog: JsonObject;

beforeAll(async () => {
  [resultSchema, catalogSchema, catalog] = await Promise.all(
    [resultSchemaPath, catalogSchemaPath, catalogPath].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
});

function baseResult(exitCode: number): JsonObject {
  const success = exitCode === 0;
  return {
    contractVersion: "1.0.0",
    status: success ? "success" : exitCode < 3 ? "failure" : "blocked",
    exitCode,
    reasonCode: success ? "trail.ok" : "runtime.internal_failure",
    summary: success ? "The operation completed." : "The operation stopped.",
    why: success ? [] : ["A contract condition was not satisfied."],
    evidence: [],
    stateChanged: success,
    retryable: false,
    recovery: success ? null : "Correct the named condition and retry.",
  };
}

describe("universal result JSON schemas", () => {
  it("publishes immutable strict v1 identities and fields", () => {
    expect(resultSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://mestre-yoda.dev/schemas/result/v1",
      title: "Mestre Yoda Universal Result v1",
      type: "object",
      additionalProperties: false,
    });
    expect(catalogSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://mestre-yoda.dev/schemas/reason-catalog/v1",
      additionalProperties: false,
    });
    expect(catalog).toMatchObject({
      contractVersion: "1.0.0",
      reasons: expect.any(Array),
    });
    expect(resultSchema.required).toEqual([
      "contractVersion",
      "status",
      "exitCode",
      "reasonCode",
      "summary",
      "why",
      "evidence",
      "stateChanged",
      "retryable",
      "recovery",
    ]);
  });

  it("validates all six exit/status/recovery categories", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateResult = ajv.compile(resultSchema);
    const validateCatalog = ajv.compile(catalogSchema);

    expect(
      validateCatalog(catalog),
      JSON.stringify(validateCatalog.errors),
    ).toBe(true);
    for (let exitCode = 0; exitCode <= 5; exitCode += 1) {
      expect(
        validateResult(baseResult(exitCode)),
        `${String(exitCode)}: ${JSON.stringify(validateResult.errors)}`,
      ).toBe(true);
    }
  });

  it.each([
    ["unknown property", { ...baseResult(0), stack: "private" }],
    ["empty failure why", { ...baseResult(1), why: [] }],
    ["success recovery", { ...baseResult(0), recovery: "Retry." }],
    [
      "absolute evidence ref",
      {
        ...baseResult(3),
        evidence: [{ kind: "artifact", ref: "/home/user/private.json" }],
      },
    ],
  ])("rejects %s", (_name, value) => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      resultSchema,
    );
    expect(validate(value)).toBe(false);
  });
});
