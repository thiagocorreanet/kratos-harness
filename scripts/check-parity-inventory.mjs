import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  calculateParity,
  discoverLegacy,
  loadCatalogs,
  validatePrivateReferences,
  validateDiscovery,
  validateMatrix,
} from "./lib/parity-inventory.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const inventoryRoot = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5",
);
const usageMessage =
  "expected documented option/value pairs; private source and distribution must be provided together";

class UsageError extends Error {}

function parseArguments(argv) {
  const allowed = new Set([
    "--discovery",
    "--matrix",
    "--source",
    "--dist-source",
  ]);
  const options = {};
  if (argv.length % 2 !== 0) throw new UsageError(usageMessage);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.length === 0) {
      throw new UsageError(usageMessage);
    }
    options[flag.slice(2)] = value;
  }
  if (
    (options.source === undefined) !==
    (options["dist-source"] === undefined)
  ) {
    throw new UsageError(usageMessage);
  }
  return options;
}

function names(discovery, namespace) {
  return discovery.namespaces[namespace].map(({ name }) => name);
}

function assertPrivateDiscovery(discovery, actual) {
  const mappings = [
    ["commands", "commands"],
    ["command_forms", "commandForms"],
    ["flags", "flags"],
    ["io_contracts", "ioContracts"],
    ["exit_codes", "exitCodes"],
    ["packages", "packages"],
    ["schemas", "schemas"],
    ["plugin_files", "pluginFiles"],
    ["workflows", "workflows"],
    ["reason_codes", "reasonCodes"],
  ];
  for (const [namespace, property] of mappings) {
    if (
      JSON.stringify(names(discovery, namespace)) !==
      JSON.stringify(actual[property])
    ) {
      throw new Error(
        `Parity inventory validation failed: private ${namespace} discovery changed`,
      );
    }
  }
}

function printReport(discovery, matrix) {
  const totalKeys = Object.values(discovery.namespaces).flat().length;
  const parity = calculateParity(matrix);
  console.log(
    `discovery ${discovery.oracle_id}: verified (${totalKeys} keys; ${discovery.namespaces.commands.length} commands; ${discovery.namespaces.command_forms.length} command forms; ${discovery.namespaces.flags.length} command flags; ${discovery.namespaces.io_contracts.length} I/O contracts; ${discovery.namespaces.exit_codes.length} exit classes; ${discovery.namespaces.packages.length} packages; ${discovery.namespaces.schemas.length} schemas; ${discovery.namespaces.plugin_files.length} plugin files; ${discovery.namespaces.workflows.length} workflows; ${discovery.namespaces.reason_codes.length} reason codes)`,
  );
  for (const label of ["overall", "P0", "P1"]) {
    const value = parity[label];
    console.log(
      `parity ${label}: ${value.credited} / ${value.total} (${value.percent}%)`,
    );
  }
}

function main(argv) {
  const options = parseArguments(argv);
  const { discovery, matrix } = loadCatalogs({
    discoveryPath: options.discovery ?? join(inventoryRoot, "discovery.json"),
    matrixPath: options.matrix ?? join(inventoryRoot, "matrix.json"),
  });
  validateDiscovery(discovery);
  validateMatrix(discovery, matrix, repositoryRoot);
  if (options.source !== undefined) {
    const actual = discoverLegacy(options.source, options["dist-source"]);
    validatePrivateReferences(
      discovery,
      options.source,
      options["dist-source"],
    );
    assertPrivateDiscovery(discovery, actual);
  }
  printReport(discovery, matrix);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Parity inventory usage error: ${usageMessage}`);
    process.exitCode = 2;
  } else if (
    error instanceof Error &&
    error.message.startsWith("Parity inventory validation failed:")
  ) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error(
      "Parity inventory validation failed: catalog or private input could not be verified",
    );
    process.exitCode = 1;
  }
}
