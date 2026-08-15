import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  loadResultContract,
  validateResultContract,
} from "./lib/result-contract.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const usageMessage = "expected documented option/value pairs";

class UsageError extends Error {}

function parseArguments(argv) {
  const allowed = new Set([
    "--result-schema",
    "--catalog-schema",
    "--catalog",
    "--examples",
  ]);
  if (argv.length % 2 !== 0) throw new UsageError(usageMessage);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.length === 0) {
      throw new UsageError(usageMessage);
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const input = await loadResultContract({
    resultSchemaPath:
      options["result-schema"] ??
      join(repositoryRoot, "schemas/result.v1.schema.json"),
    catalogSchemaPath:
      options["catalog-schema"] ??
      join(repositoryRoot, "schemas/reason-catalog.v1.schema.json"),
    catalogPath:
      options.catalog ??
      join(repositoryRoot, "packages/contracts/catalogs/reason-codes.v1.json"),
    examplesPath:
      options.examples ?? join(repositoryRoot, "fixtures/result-contract/v1"),
    discoveryPath: join(
      repositoryRoot,
      "compatibility/inventory/go-v3-v0.6.5/discovery.json",
    ),
  });
  validateResultContract(input);
  const exits = input.examples
    .map(({ exitCode }) => exitCode)
    .sort((a, b) => a - b)
    .join(",");
  console.log(
    `result contract v${CONTRACT_VERSION}: verified (${input.catalog.reasons.length} reasons; exits ${exits}; ${input.examples.length} examples)`,
  );
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Result contract usage error: ${usageMessage}`);
    process.exitCode = 2;
  } else if (
    error instanceof Error &&
    error.message.startsWith("Result contract validation failed:")
  ) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error(
      "Result contract validation failed: contract input could not be read",
    );
    process.exitCode = 1;
  }
}
