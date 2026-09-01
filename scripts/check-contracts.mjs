import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  generateContractTypes,
  generatedContractsPath,
} from "./generate-contract-types.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

class UsageError extends Error {}
class VerificationError extends Error {}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sortedUnique(values, label) {
  if (
    new Set(values).size !== values.length ||
    JSON.stringify(values) !== JSON.stringify([...values].sort())
  ) {
    throw new VerificationError(`${label} are not sorted and unique`);
  }
}

function unique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new VerificationError(`${label} are not unique`);
  }
}

async function schemaInventory(directory) {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
    .map((entry) =>
      relative(repositoryRoot, join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    );
}

async function verifyArtifacts() {
  const manifest = await readJson(
    join(
      repositoryRoot,
      "packages/contracts/catalogs/contract-families.v1.json",
    ),
  );
  const manifestSchema = await readJson(
    join(
      repositoryRoot,
      "schemas/contracts/contract-manifest.v1.9.schema.json",
    ),
  );
  const resultSchema = await readJson(
    join(repositoryRoot, "schemas/result.v1.schema.json"),
  );
  const acceptanceCriterionIdSchema = await readJson(
    join(
      repositoryRoot,
      "schemas/contracts/acceptance-criterion-id.v1.schema.json",
    ),
  );
  // The runtime registry compiles these same schemas with `validateFormats`
  // off, because the offline validator bundled into the plugin implements no
  // format at all. Verifying them under a stricter setting here would accept
  // schemas the shipped runtime cannot compile.
  const manifestValidator = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  }).compile(manifestSchema);
  if (!manifestValidator(manifest)) {
    throw new VerificationError("manifest does not satisfy its closed schema");
  }
  unique(
    manifest.schemas.map(({ id, version }) => `${id}@${version}`),
    "schema identifier/version pairs",
  );
  sortedUnique(
    manifest.legacyProfiles.map(({ name }) => name),
    "legacy profile names",
  );
  const registered = manifest.schemas.map(({ path }) => path).sort();
  const inventory = [
    ...(await schemaInventory(join(repositoryRoot, "schemas/state"))),
    ...(await schemaInventory(join(repositoryRoot, "schemas/host"))),
  ].sort();
  if (JSON.stringify(registered) !== JSON.stringify(inventory)) {
    throw new VerificationError("registered schemas differ from inventory");
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  ajv.addSchema(resultSchema);
  ajv.addSchema(acceptanceCriterionIdSchema);
  const registeredSchemas = await Promise.all(
    manifest.schemas.map(({ path }) => readJson(join(repositoryRoot, path))),
  );
  for (const schema of registeredSchemas) {
    ajv.addSchema(schema);
  }
  for (const schema of registeredSchemas) {
    if (ajv.getSchema(schema.$id) === undefined) {
      throw new VerificationError("registered schema could not be compiled");
    }
  }
  return manifest;
}

function parseArguments(argv) {
  if (argv.length === 0) return { generatedPath: generatedContractsPath };
  if (argv.length === 2 && argv[0] === "--generated" && argv[1]?.length > 0) {
    return { generatedPath: argv[1] };
  }
  throw new UsageError("expected at most one --generated path");
}

async function main(argv) {
  const { generatedPath } = parseArguments(argv);
  const manifest = await verifyArtifacts();
  const directory = await mkdtemp(join(tmpdir(), "kratos-contracts-"));
  try {
    const candidate = join(directory, "contracts.ts");
    await generateContractTypes({ outputPath: candidate });
    const [candidateText, committedText] = await Promise.all([
      readFile(candidate, "utf8"),
      readFile(generatedPath, "utf8"),
    ]);
    if (candidateText !== committedText) {
      throw new VerificationError("generated declarations drifted");
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  console.log(
    `contract families v${manifest.contractVersion}: verified (${manifest.schemas.length} schemas; ${manifest.legacyProfiles.length} legacy profiles; generated types current)`,
  );
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Contract verification usage error: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof VerificationError) {
    console.error(`Contract verification failed: ${error.message}`);
    process.exitCode = 1;
  } else {
    // Naming the underlying failure is what makes a red run diagnosable
    // without re-running the script by hand.
    console.error(
      `Contract verification failed: contract artifacts could not be verified (${error instanceof Error ? error.message : String(error)})`,
    );
    process.exitCode = 1;
  }
}
