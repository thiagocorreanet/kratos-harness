import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const provenanceId = "private-go-v3-hash-only";
const expectedIdentity = {
  tag: "v0.6.5",
  tagObject: "720f0a35074451208a0673324d223803add249e0",
  commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
  distributionCommit: "e6e6803c9329a53d362217a8f829a2801c83609d",
};
const namespaceNames = [
  "aliases",
  "benchmarks",
  "commands",
  "documentation",
  "generated_files",
  "global_flags",
  "human_gates",
  "packages",
  "phases",
  "plugin_files",
  "reason_codes",
  "retired_commands",
  "schemas",
  "state_transitions",
  "workflows",
];

function fail(message) {
  throw new Error(`Parity inventory validation failed: ${message}`);
}

function assertOnlyKeys(value, allowed, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${context} is not an object`);
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...allowed].sort())) {
    fail(`${context} fields changed`);
  }
}

function assertSafeStrings(value) {
  if (typeof value === "string") {
    const forbidden = [
      /[a-z][a-z0-9+.-]*:\/\//iu,
      /(?:^|[\s"'=])\/(?:home|Users|private|tmp|var|etc|opt|srv|mnt)\//u,
      /^[a-z]:[\\/]/iu,
      /^\\\\[a-z0-9._-]+[\\/]/iu,
      /(?:^|\/)\.\.(?:\/|$)/u,
      /\b[^\s@]+@[^\s:]+:[^\s]+/u,
      /(?:github_pat_|gh[pousr]_)[a-z0-9_]{20,}/iu,
      /AKIA[0-9A-Z]{16}/u,
      /BEGIN [A-Z ]*PRIVATE KEY/iu,
    ];
    if (forbidden.some((pattern) => pattern.test(value))) {
      fail("catalog contains unsafe private metadata");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeStrings(entry);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) assertSafeStrings(entry);
  }
}

export function validateDiscovery(discovery) {
  assertOnlyKeys(
    discovery,
    [
      "schema_version",
      "algorithm_version",
      "oracle_id",
      "source",
      "provenance_id",
      "namespaces",
    ],
    "discovery",
  );
  assertOnlyKeys(
    discovery.source,
    ["tag", "tag_object", "commit", "distribution_commit"],
    "discovery source",
  );
  if (
    discovery.schema_version !== 1 ||
    discovery.algorithm_version !== 1 ||
    discovery.oracle_id !== "go-v3-v0.6.5" ||
    discovery.provenance_id !== provenanceId ||
    discovery.source.tag !== expectedIdentity.tag ||
    discovery.source.tag_object !== expectedIdentity.tagObject ||
    discovery.source.commit !== expectedIdentity.commit ||
    discovery.source.distribution_commit !== expectedIdentity.distributionCommit
  ) {
    fail("immutable discovery identity changed");
  }
  assertOnlyKeys(discovery.namespaces, namespaceNames, "discovery namespaces");
  assertSafeStrings(discovery);

  const allKeys = [];
  for (const namespace of namespaceNames) {
    const entries = discovery.namespaces[namespace];
    if (!Array.isArray(entries) || entries.length === 0) {
      fail(`namespace ${namespace} is empty`);
    }
    const keys = [];
    for (const entry of entries) {
      assertOnlyKeys(
        entry,
        ["key", "name", "legacy_refs", "provenance_id"],
        `entry in ${namespace}`,
      );
      if (
        typeof entry.key !== "string" ||
        !entry.key.startsWith(`${namespace}.`) ||
        typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        entry.provenance_id !== provenanceId ||
        !Array.isArray(entry.legacy_refs) ||
        entry.legacy_refs.length === 0 ||
        entry.legacy_refs.some(
          (reference) =>
            typeof reference !== "string" || reference.length === 0,
        )
      ) {
        fail(`entry in ${namespace} is incomplete`);
      }
      keys.push(entry.key);
      allKeys.push(entry.key);
    }
    if (JSON.stringify(keys) !== JSON.stringify(keys.toSorted())) {
      fail(`namespace ${namespace} is not sorted`);
    }
  }
  if (new Set(allKeys).size !== allKeys.length) {
    fail("discovery keys are not unique");
  }
  return discovery;
}

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail("private discovery command did not complete successfully");
  }
  return result.stdout.trim();
}

function git(checkout, args) {
  return command("git", ["-C", checkout, ...args]);
}

function readPrivate(source, relative) {
  try {
    return readFileSync(join(source, relative), "utf8");
  } catch {
    fail("private discovery input could not be read");
  }
}

export function discoverLegacy(source, distribution) {
  if (
    git(source, ["rev-parse", expectedIdentity.tag]) !==
      expectedIdentity.tagObject ||
    git(source, ["rev-parse", `${expectedIdentity.tag}^{commit}`]) !==
      expectedIdentity.commit ||
    git(distribution, ["rev-parse", `${expectedIdentity.tag}^{commit}`]) !==
      expectedIdentity.distributionCommit
  ) {
    fail("private discovery identity does not match");
  }

  const help = readPrivate(source, "cmd/yoda/help.go");
  const commands = [...help.matchAll(/Cmd:\s*"([^"]+)"/gu)]
    .map((match) => match[1])
    .toSorted();
  const modulePrefix = "github.com/betaup-sistemas/mestre-yoda";
  const packages = command("go", ["list", "./..."], { cwd: source })
    .split("\n")
    .map((name) =>
      name === modulePrefix ? "." : name.replace(`${modulePrefix}/`, ""),
    )
    .toSorted();
  let schemas;
  let workflows;
  try {
    schemas = readdirSync(join(source, "schemas"))
      .filter((name) => name.endsWith(".schema.json"))
      .toSorted();
    workflows = readdirSync(join(source, ".github/workflows"))
      .filter((name) => /\.ya?ml$/u.test(name))
      .toSorted();
  } catch {
    fail("private discovery input could not be read");
  }
  const pluginFiles = git(distribution, ["ls-files"]).split("\n").toSorted();
  const reasonFiles = [
    "internal/decide/codes.go",
    "internal/guard/codes.go",
    "internal/complete/codes.go",
  ];
  const reasonCodes = reasonFiles
    .flatMap((relative) => [
      ...readPrivate(source, relative).matchAll(/=\s*"([a-z][a-z0-9_.-]+)"/gu),
    ])
    .map((match) => match[1])
    .concat(["judge.auto_julgamento", "judge.modelo_divergente"])
    .toSorted();

  return { commands, packages, schemas, pluginFiles, workflows, reasonCodes };
}

export function loadCatalogs({ discoveryPath, matrixPath }) {
  try {
    return {
      discovery: JSON.parse(readFileSync(discoveryPath, "utf8")),
      matrix: JSON.parse(readFileSync(matrixPath, "utf8")),
    };
  } catch {
    fail("catalog input could not be read");
  }
}
