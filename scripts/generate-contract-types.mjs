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

export async function generateContractTypes({
  outputPath = generatedContractsPath,
} = {}) {
  const [manifest, resultSchemaText] = await Promise.all([
    readJson(manifestPath),
    readFile(resultSchemaPath, "utf8"),
  ]);
  const headers = [];
  const declarations = [];

  for (const entry of manifest.schemas) {
    const schemaPath = join(repositoryRoot, entry.path);
    const schemaText = await readFile(schemaPath, "utf8");
    const schema = JSON.parse(schemaText);
    headers.push(
      `// source: ${schema.$id} sha256:${createHash("sha256").update(schemaText).digest("hex")}`,
    );
    schema.title = entry.typeName;
    const compiled = await compile(schema, entry.typeName, {
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
            canRead: /^https:\/\/mestre-yoda\.dev\/schemas\/result\/v1$/u,
            read: resultSchemaText,
          },
        },
      },
    });
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
