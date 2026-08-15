#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  loadScenario,
  runScenario,
  validateSafeRelativePath,
} from "@kratos/differential";

const defaultCorpus = join(
  import.meta.dirname,
  "../compatibility/fixtures/differential/v1/corpus.json",
);
const parityMatrix = join(
  import.meta.dirname,
  "../compatibility/inventory/go-v3-v0.6.5/matrix.json",
);
const frozenOracleDigest =
  "da4ec4a2394ae90a94722f633bcb9157ddc5ee0133f46540b7c2c700abe378b8";

class UsageError extends Error {}
class ProvenanceError extends Error {}

function exactKeys(value, allowed) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function parseOptions(args) {
  const options = {
    className: "self-test",
    format: "json",
    corpus: defaultCorpus,
    oracle: undefined,
    candidate: undefined,
  };
  const seen = new Set();
  const names = new Map([
    ["--class", "className"],
    ["--format", "format"],
    ["--corpus", "corpus"],
    ["--oracle", "oracle"],
    ["--candidate", "candidate"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!names.has(name)) throw new UsageError("unknown option");
    if (seen.has(name)) throw new UsageError("duplicate option");
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError("missing value");
    }
    seen.add(name);
    options[names.get(name)] = value;
  }
  if (!["self-test", "live"].includes(options.className)) {
    throw new UsageError("invalid class");
  }
  if (!["json", "human"].includes(options.format)) {
    throw new UsageError("invalid format");
  }
  if (
    options.className === "live" &&
    (options.oracle === undefined || options.candidate === undefined)
  ) {
    throw new UsageError("live runners are required");
  }
  return options;
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function validateCorpus(candidate, rowIds) {
  if (
    !exactKeys(candidate, ["schemaVersion", "oracleId", "entries"]) ||
    candidate.schemaVersion !== 1 ||
    candidate.oracleId !== "go-v3-v0.6.5" ||
    !Array.isArray(candidate.entries)
  ) {
    throw new Error("Differential corpus is invalid");
  }
  const ids = new Set();
  for (const entry of candidate.entries) {
    if (
      exactKeys(entry, ["class", "path"]) &&
      ["self-test", "live"].includes(entry.class) &&
      typeof entry.path === "string"
    ) {
      validateSafeRelativePath(entry.path);
      continue;
    }
    if (
      !exactKeys(entry, ["class", "id", "parityContractIds", "requirements"]) ||
      entry.class !== "planned" ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id) ||
      !Array.isArray(entry.parityContractIds) ||
      entry.parityContractIds.length === 0 ||
      !entry.parityContractIds.every(
        (id) => typeof id === "string" && rowIds.has(id),
      ) ||
      !Array.isArray(entry.requirements) ||
      entry.requirements.length === 0 ||
      !entry.requirements.every(
        (requirement) =>
          typeof requirement === "string" && requirement.trim().length >= 20,
      ) ||
      ids.has(entry.id)
    ) {
      throw new Error("Differential corpus is invalid");
    }
    ids.add(entry.id);
  }
  return candidate;
}

async function verifyOracle(path) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) throw new ProvenanceError();
    const digest = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (digest !== frozenOracleDigest) throw new ProvenanceError();
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    throw new ProvenanceError();
  }
}

function sorted(value) {
  if (Array.isArray(value)) return value.map((entry) => sorted(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, entry]) => [key, sorted(entry)]),
    );
  }
  return value;
}

function renderHuman(report) {
  const status = report.equal ? "PASS" : "FAIL";
  const count = report.scenarios.length;
  const lines = [
    `Differential corpus ${report.class}: ${status} (${count} scenario${count === 1 ? "" : "s"}; ${report.planned} planned)`,
  ];
  for (const scenario of report.scenarios) {
    lines.push(`${scenario.equal ? "PASS" : "FAIL"} ${scenario.id}`);
    for (const mismatch of scenario.mismatches) {
      lines.push(`  ${mismatch.kind} ${mismatch.pointer}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.className === "live") await verifyOracle(options.oracle);

  const corpusPath = resolve(options.corpus);
  const corpusDirectory = dirname(corpusPath);
  let rowIds;
  try {
    const matrix = JSON.parse(await readFile(parityMatrix, "utf8"));
    rowIds = new Set(matrix.rows.map(({ id }) => id));
  } catch {
    // Distinguish a broken repository install from a bad corpus.
    throw new Error("Differential parity matrix is unreadable");
  }
  let corpus;
  try {
    corpus = validateCorpus(
      JSON.parse(await readFile(corpusPath, "utf8")),
      rowIds,
    );
  } catch {
    throw new Error("Differential corpus is invalid");
  }
  const selected = corpus.entries.filter(
    (entry) => entry.class === options.className,
  );
  // An empty selection would otherwise report a vacuous pass, because every
  // scenario is an equality claim and `[].every(...)` is true.
  if (selected.length === 0) {
    throw new Error("Differential corpus selected no runnable scenario");
  }
  const planned = corpus.entries.filter(
    (entry) => entry.class === "planned",
  ).length;
  const scenarios = [];
  for (const entry of selected) {
    const scenarioPath = resolve(corpusDirectory, entry.path);
    if (!inside(corpusDirectory, scenarioPath)) {
      throw new Error("Differential corpus is invalid");
    }
    const scenario = await loadScenario(scenarioPath);
    const result = await runScenario(
      scenario,
      options.oracle ?? process.execPath,
      options.candidate ?? process.execPath,
    );
    scenarios.push({
      id: result.scenarioId,
      equal: result.equal,
      mismatches: result.mismatches,
      parityContractIds: result.parityContractIds,
      normalization: result.normalization,
    });
  }
  const report = {
    schemaVersion: 1,
    oracleId:
      options.className === "live"
        ? "go-v3-v0.6.5"
        : "synthetic-public-self-test",
    class: options.className,
    equal: scenarios.every(({ equal }) => equal),
    planned,
    scenarios,
  };
  process.stdout.write(
    options.format === "human"
      ? renderHuman(report)
      : `${JSON.stringify(sorted(report))}\n`,
  );
  process.exitCode = report.equal ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.exitCode = 2;
  if (error instanceof UsageError) {
    process.stderr.write(
      `Differential harness usage error: ${error.message}\n`,
    );
  } else if (error instanceof ProvenanceError) {
    process.stderr.write(
      "Differential harness provenance error: oracle digest does not match go-v3-v0.6.5\n",
    );
  } else {
    process.stderr.write("Differential harness error: execution failed\n");
  }
}
