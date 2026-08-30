import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const manifestPath = join(
  repositoryRoot,
  "packages/contracts/catalogs/contract-families.v1.json",
);
const resultSchemaPath = join(repositoryRoot, "schemas/result.v1.schema.json");
const acceptanceCriterionIdSchemaPath = join(
  repositoryRoot,
  "schemas/contracts/acceptance-criterion-id.v1.schema.json",
);
export const generatedContractsPath = join(
  repositoryRoot,
  "packages/contracts/src/generated/contracts.ts",
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function indent(source) {
  return source
    .trim()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function mergeConstraint(base, constraint) {
  if (constraint.$ref !== undefined || base.oneOf !== undefined) {
    return constraint;
  }
  return { ...base, ...constraint };
}

function closedObjectVariant(schema, constraints) {
  if (schema.properties === undefined || !Array.isArray(schema.required)) {
    throw new Error("closed schema cannot produce a generated union");
  }
  const properties = Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([name]) => constraints[name] !== false)
      .map(([name, definition]) => [
        name,
        constraints[name] === undefined
          ? definition
          : mergeConstraint(definition, constraints[name]),
      ]),
  );
  return {
    type: schema.type,
    additionalProperties: schema.additionalProperties,
    required: schema.required.filter((name) => constraints[name] !== false),
    properties,
  };
}

function conditionalUnion(schema) {
  if (
    !Array.isArray(schema.allOf) ||
    schema.allOf.length === 0 ||
    schema.properties === undefined ||
    !Array.isArray(schema.required)
  ) {
    throw new Error("conditional schema cannot produce a generated union");
  }
  const variants = schema.allOf.map((rule) => {
    const exitConstraint = rule.if?.properties?.exitCode;
    const thenProperties = rule.then?.properties;
    if (exitConstraint === undefined || thenProperties === undefined) {
      throw new Error("conditional schema branch is incomplete");
    }
    return closedObjectVariant(schema, {
      exitCode: exitConstraint,
      ...thenProperties,
    });
  });
  return {
    $schema: schema.$schema,
    $id: schema.$id,
    title: schema.title,
    oneOf: variants,
    $defs: schema.$defs,
  };
}

function transactionManifestTypeSchema(schema) {
  const operation = schema.$defs?.operation;
  if (operation === undefined) {
    throw new Error("transaction manifest operation schema is missing");
  }
  const writeOperation = closedObjectVariant(operation, {
    kind: { const: "write_file" },
    stagedPath: { $ref: "#/$defs/reference" },
  });
  const metadataOnlyOperation = closedObjectVariant(operation, {
    kind: { enum: ["create_directory", "delete_file"] },
    stagedPath: { type: "null" },
  });
  return {
    ...schema,
    $defs: {
      ...schema.$defs,
      operation: { oneOf: [writeOperation, metadataOnlyOperation] },
    },
  };
}

function transactionProgressTypeSchema(schema) {
  return {
    $schema: schema.$schema,
    $id: schema.$id,
    title: schema.title,
    oneOf: [
      closedObjectVariant(schema, {
        phase: { const: "begun" },
        manifestDigest: { type: "null" },
      }),
      closedObjectVariant(schema, {
        phase: { enum: ["prepared", "publishing", "committed"] },
        manifestDigest: { $ref: "#/$defs/sha256" },
      }),
      closedObjectVariant(schema, {
        phase: { const: "aborted" },
      }),
    ],
    $defs: schema.$defs,
  };
}

function phaseMeasurementTypeSchema(schema) {
  const [running, completed, interrupted] = schema.allOf ?? [];
  const runningProperties = running?.then?.properties;
  const completedProperties = completed?.then?.properties;
  const interruptedProperties = interrupted?.then?.properties;
  if (
    runningProperties === undefined ||
    completedProperties === undefined ||
    interruptedProperties === undefined
  ) {
    throw new Error("phase measurement schema is incomplete");
  }
  return {
    $schema: schema.$schema,
    $id: schema.$id,
    title: schema.title,
    oneOf: [
      closedObjectVariant(schema, {
        status: { const: "running" },
        ...runningProperties,
      }),
      closedObjectVariant(schema, {
        status: { const: "completed" },
        ...completedProperties,
      }),
      closedObjectVariant(schema, {
        status: { const: "interrupted" },
        ...interruptedProperties,
      }),
    ],
    $defs: schema.$defs,
  };
}

/**
 * The agent output contract validates as one closed object whose payload is
 * chosen by the `agent` discriminator, because that is what makes a refusal
 * name the offending path instead of the document root. TypeScript wants the
 * same contract as a discriminated union, so the union is rebuilt here from
 * the very conditionals the validator reads.
 */
function agentOutputTypeSchema(schema) {
  const variants = schema.allOf.map((rule) => {
    const agent = rule.if?.properties?.agent;
    const payload = rule.then?.properties?.payload;
    if (agent === undefined || payload === undefined) {
      throw new Error("agent output conditional branch is incomplete");
    }
    return closedObjectVariant(schema, { agent, payload });
  });
  return {
    $schema: schema.$schema,
    $id: schema.$id,
    title: schema.title,
    oneOf: variants,
    $defs: schema.$defs,
  };
}

function adapterMessageV1_1TypeSchema(schema) {
  const common = schema.$defs?.common;
  const variants = [
    "requestMessage",
    "responseMessage",
    "catalogMessage",
    "phaseExecutionMessage",
  ].map((name) => {
    const rule = schema.$defs?.[name];
    const constraints = rule?.allOf?.[1]?.properties;
    if (constraints === undefined) {
      throw new Error("adapter message variant is incomplete");
    }
    return closedObjectVariant(common, constraints);
  });
  return {
    $schema: schema.$schema,
    $id: schema.$id,
    title: schema.title,
    oneOf: variants,
    $defs: schema.$defs,
  };
}

function schemaForTypeGeneration(id, schema) {
  if (id === "host.agent-output") {
    return agentOutputTypeSchema(schema);
  }
  if (id === "state.transaction-manifest") {
    return transactionManifestTypeSchema(schema);
  }
  if (id === "state.transaction-progress") {
    return transactionProgressTypeSchema(schema);
  }
  if (id === "state.phase-measurement") {
    return phaseMeasurementTypeSchema(schema);
  }
  if (
    id === "host.adapter-message" &&
    schema.$id === "https://kratos.dev/schemas/host/adapter-message/v1.1"
  ) {
    return adapterMessageV1_1TypeSchema(schema);
  }
  return schema;
}

export async function generateContractTypes({
  outputPath = generatedContractsPath,
} = {}) {
  const [manifest, resultSchemaText, acceptanceCriterionIdSchemaText] =
    await Promise.all([
      readJson(manifestPath),
      readFile(resultSchemaPath, "utf8"),
      readFile(acceptanceCriterionIdSchemaPath, "utf8"),
    ]);
  const headers = [];
  const declarations = [];
  const resultSchema = JSON.parse(resultSchemaText);
  const generatedResultSchemaText = JSON.stringify(
    conditionalUnion(resultSchema),
  );
  headers.push(
    `// dependency: ${resultSchema.$id} sha256:${createHash("sha256").update(resultSchemaText).digest("hex")}`,
    `// dependency: https://kratos.dev/schemas/contracts/acceptance-criterion-id/v1 sha256:${createHash("sha256").update(acceptanceCriterionIdSchemaText).digest("hex")}`,
  );

  for (const entry of manifest.schemas) {
    const schemaPath = join(repositoryRoot, entry.path);
    const schemaText = await readFile(schemaPath, "utf8");
    const schema = JSON.parse(schemaText);
    headers.push(
      `// source: ${schema.$id} sha256:${createHash("sha256").update(schemaText).digest("hex")}`,
    );
    schema.title = entry.typeName;
    const compiled = await compile(
      schemaForTypeGeneration(entry.id, schema),
      entry.typeName,
      {
        bannerComment: "",
        cwd: repositoryRoot,
        format: false,
        ignoreMinAndMaxItems: false,
        strictIndexSignatures: true,
        $refOptions: {
          resolve: {
            http: false,
            universalResult: {
              order: 1,
              canRead: /^https:\/\/kratos\.dev\/schemas\/result\/v1$/u,
              read: generatedResultSchemaText,
            },
            acceptanceCriterionId: {
              order: 2,
              canRead:
                /^https:\/\/kratos\.dev\/schemas\/contracts\/acceptance-criterion-id\/v1$/u,
              read: acceptanceCriterionIdSchemaText,
            },
          },
        },
      },
    );
    const namespace = `${entry.typeName}Contract`;
    declarations.push(
      `export namespace ${namespace} {\n${indent(compiled)}\n}\nexport type ${entry.typeName} = ${namespace}.${entry.typeName};`,
    );
  }

  const source = [
    "// Generated from registered JSON Schemas. Do not edit.",
    ...headers,
    "",
    ...declarations,
    "",
  ].join("\n");
  const formatted = await format(source, {
    parser: "typescript",
    endOfLine: "lf",
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatted, "utf8");
  return formatted;
}

function parseArguments(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === "--output" && argv[1]?.length > 0) {
    return { outputPath: argv[1] };
  }
  throw new Error("expected at most one --output path");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await generateContractTypes(parseArguments(process.argv.slice(2)));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "expected at most one --output path"
    ) {
      console.error(`Contract generation usage error: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(
        "Contract generation failed: schema types could not be generated",
      );
      process.exitCode = 1;
    }
  }
}
