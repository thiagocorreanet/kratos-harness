import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";

const provenanceId = "private-go-v3-hash-only";
const discoverySemanticSha256 =
  "26b34876226b28e307575a8a4a03d625482bc436583e5e78f31d2b0d79e1154e";
const expectedIdentity = {
  tag: "v0.6.5",
  tagObject: "720f0a35074451208a0673324d223803add249e0",
  commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
  distributionCommit: "e6e6803c9329a53d362217a8f829a2801c83609d",
};
const namespaceNames = [
  "aliases",
  "benchmarks",
  "command_forms",
  "commands",
  "documentation",
  "exit_codes",
  "flags",
  "generated_files",
  "global_flags",
  "human_gates",
  "io_contracts",
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

function assertSafeStrings(value, allowApprovalUrl = false) {
  if (typeof value === "string") {
    if (
      allowApprovalUrl &&
      /^https:\/\/github\.com\/thiagocorreanet\/yoda\/(?:issues|pull)\/\d+$/u.test(
        value,
      )
    ) {
      return;
    }
    if (isAbsolute(value) || win32.isAbsolute(value)) {
      fail("catalog contains unsafe private metadata");
    }
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
    for (const entry of value) assertSafeStrings(entry, allowApprovalUrl);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value))
      assertSafeStrings(entry, allowApprovalUrl);
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
  if (
    createHash("sha256").update(JSON.stringify(discovery)).digest("hex") !==
    discoverySemanticSha256
  ) {
    fail("immutable discovery content changed");
  }

  const allKeys = [];
  for (const namespace of namespaceNames) {
    const entries = discovery.namespaces[namespace];
    if (!Array.isArray(entries) || entries.length === 0) {
      fail(`namespace ${namespace} is empty`);
    }
    const keys = [];
    const names = [];
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
      if (new Set(entry.legacy_refs).size !== entry.legacy_refs.length) {
        fail(`entry in ${namespace} has duplicate legacy references`);
      }
      keys.push(entry.key);
      names.push(entry.name);
      allKeys.push(entry.key);
    }
    if (JSON.stringify(keys) !== JSON.stringify(keys.toSorted())) {
      fail(`namespace ${namespace} is not sorted`);
    }
    if (new Set(names).size !== names.length) {
      fail(`namespace ${namespace} has duplicate names`);
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

function privateGoFiles(root) {
  const files = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      fail("private discovery input could not be read");
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.toSorted();
}

function parseFlagList(value) {
  if (value.startsWith("rootValueFlags")) return ["--root"];
  return [...value.matchAll(/"(--[a-z][a-z-]*)"/gu)].map((match) => match[1]);
}

function discoverCatalogFlags(source) {
  const contents = readPrivate(source, "cmd/yoda/value_flags.go");
  const flags = new Set();
  let section = "";
  let parent = "";
  for (const line of contents.split("\n")) {
    if (line.includes("valueFlagsByCommand =")) section = "command";
    else if (line.includes("valueFlagsByAction =")) section = "action";
    const indent = /^\t*/u.exec(line)?.[0].length ?? 0;
    const entry = /^\s*"([a-z][a-z0-9-]*)":\s*(.+)$/u.exec(line);
    if (entry === null) continue;
    const [, name, value] = entry;
    if (section === "action" && indent === 2 && value.startsWith("{")) {
      parent = name;
      continue;
    }
    if (section === "command" && indent === 2) {
      const scope =
        { gen: "gen.codex-agents", views: "views.sync" }[name] ?? name;
      for (const flag of parseFlagList(value)) flags.add(`${scope}.${flag}`);
    } else if (section === "action" && indent === 3) {
      for (const flag of parseFlagList(value)) {
        flags.add(`${parent}.${name}.${flag}`);
      }
    }
  }
  return flags;
}

function functionSource(contents, name) {
  const start = contents.search(new RegExp(`^func\\s+${name}\\s*\\(`, "mu"));
  if (start < 0) fail("private CLI handler could not be discovered");
  const next = contents.indexOf("\nfunc ", start + 1);
  return contents.slice(start, next < 0 ? undefined : next);
}

function flagsMentionedIn(contents) {
  const flags = new Set();
  for (const line of contents.split("\n")) {
    if (
      /(?:hasFlag|valueFlag|splitValueFlag|flagOr|validateValueFlags)\(|case\s+"--|==\s*"--/u.test(
        line,
      )
    ) {
      for (const match of line.matchAll(/"(--[a-z][a-z-]*)"/gu)) {
        flags.add(match[1]);
      }
    }
    for (const match of line.matchAll(/\.Bool\("([a-z][a-z-]*)"/gu)) {
      flags.add(`--${match[1]}`);
    }
    for (const match of line.matchAll(/\.Var\([^,\n]+,\s*"([a-z][a-z-]*)"/gu)) {
      flags.add(`--${match[1]}`);
    }
  }
  return flags;
}

function discoverCommandFlags(checkout) {
  const flags = discoverCatalogFlags(checkout);
  const sources = new Map();
  const readSource = (relative) => {
    if (!sources.has(relative)) {
      sources.set(relative, readPrivate(checkout, relative));
    }
    return sources.get(relative);
  };
  const wholeFileScopes = [
    ["bench.gaps", "cmd/yoda/bench.go"],
    ["dashboard", "cmd/yoda/dashboard.go"],
    ["doctor", "cmd/yoda/doctor.go"],
    ["init", "cmd/yoda/init.go"],
    ["migrate.brain", "cmd/yoda/migrate.go"],
    ["stats", "cmd/yoda/telemetry.go"],
  ];
  for (const [scope, relative] of wholeFileScopes) {
    for (const flag of flagsMentionedIn(readSource(relative))) {
      flags.add(`${scope}.${flag}`);
    }
  }
  const trail = readSource("cmd/yoda/trailcli.go");
  for (const [scope, handler] of [
    ["objective", "objectiveArgs"],
    ["continue", "parseContinueArgs"],
    ["step", "runStep"],
  ]) {
    for (const flag of flagsMentionedIn(functionSource(trail, handler))) {
      flags.add(`${scope}.${flag}`);
    }
  }
  return [...flags].toSorted();
}

function discoverIoContracts(source) {
  const checks = [
    ["stderr.errors-and-reasons", "cmd/yoda/trailcli.go", /stderr/u],
    ["stdin.bench-gaps-detect", "cmd/yoda/bench.go", /stdin/u],
    ["stdin.hook-payload", "cmd/yoda/hook.go", /stdin/u],
    ["stdin.init-answers", "cmd/yoda/init.go", /stdin/u],
    ["stdin.migrate-brain-confirmation", "cmd/yoda/migrate.go", /stdin/u],
    ["stdin.step-maintenance", "cmd/yoda/trailcli.go", /runStep[\s\S]*stdin/u],
    [
      "stdin.unlock-confirmation",
      "cmd/yoda/guardrails.go",
      /runUnlock[\s\S]*stdin/u,
    ],
    [
      "stdin.validate-dash",
      "cmd/yoda/main.go",
      /target\s*==\s*"-"[\s\S]*io\.ReadAll\(stdin\)/u,
    ],
    ["stdout.success-and-echo", "cmd/yoda/trailcli.go", /stdout/u],
  ];
  return checks
    .filter(([, relative, pattern]) =>
      pattern.test(readPrivate(source, relative)),
    )
    .map(([name]) => name)
    .toSorted();
}

function discoverReasonCodes(source) {
  const codes = new Set();
  for (const file of privateGoFiles(source)) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(
      /^\s*(?:Code[A-Z][A-Za-z0-9_]*|Reason[A-Z][A-Za-z0-9_]*|reason[A-Z][A-Za-z0-9_]*)\s*=\s*"([a-z][a-z0-9_.-]+)"/gmu,
    )) {
      codes.add(match[1]);
    }
    for (const match of contents.matchAll(
      /\bReason:\s*"([a-z][a-z0-9_.-]+)"/gu,
    )) {
      codes.add(match[1]);
    }
  }
  return [...codes].toSorted();
}

export function discoverLegacy(source, distribution) {
  validatePrivateCheckoutIdentity({
    sourceTagObject: git(source, ["rev-parse", expectedIdentity.tag]),
    sourceTagCommit: git(source, [
      "rev-parse",
      `${expectedIdentity.tag}^{commit}`,
    ]),
    distributionTagCommit: git(distribution, [
      "rev-parse",
      `${expectedIdentity.tag}^{commit}`,
    ]),
    sourceHead: git(source, ["rev-parse", "HEAD"]),
    distributionHead: git(distribution, ["rev-parse", "HEAD"]),
    sourceBranch: git(source, ["rev-parse", "--abbrev-ref", "HEAD"]),
    distributionBranch: git(distribution, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]),
    sourceStatus: git(source, ["status", "--porcelain"]),
    distributionStatus: git(distribution, ["status", "--porcelain"]),
  });

  const help = readPrivate(source, "cmd/yoda/help.go");
  const commands = [...help.matchAll(/Cmd:\s*"([^"]+)"/gu)]
    .map((match) => match[1])
    .toSorted();
  const commandSource = privateGoFiles(join(source, "cmd/yoda"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const allGoSource = privateGoFiles(source)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const commandForms = [
    ...new Set(
      [
        ...commandSource.matchAll(
          /\byoda\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9-]*)/gu,
        ),
      ]
        .map((match) => `${match[1]}.${match[2]}`)
        .filter((name) => commands.includes(name.split(".")[0])),
    ),
  ].toSorted();
  const flags = discoverCommandFlags(source);
  const ioContracts = discoverIoContracts(source);
  const exitCodes = [0, 1, 2, 3]
    .filter((code) =>
      code === 3
        ? /ExitCode:\s*3/u.test(allGoSource)
        : new RegExp(`return\\s+${code}\\b`, "u").test(commandSource),
    )
    .map(
      (code) =>
        [
          "0.success-or-hook-continue",
          "1-domain-or-validation-failure",
          "2-usage-or-contract-failure",
          "3-gate-or-judge-refusal",
        ][code],
    );
  const modulePrefix = "github.com/betaup-sistemas/yoda";
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
  const reasonCodes = discoverReasonCodes(source);

  return {
    commands,
    commandForms,
    flags,
    ioContracts,
    exitCodes,
    packages,
    schemas,
    pluginFiles,
    workflows,
    reasonCodes,
  };
}

export function validatePrivateCheckoutIdentity(observed) {
  assertOnlyKeys(
    observed,
    [
      "sourceTagObject",
      "sourceTagCommit",
      "distributionTagCommit",
      "sourceHead",
      "distributionHead",
      "sourceBranch",
      "distributionBranch",
      "sourceStatus",
      "distributionStatus",
    ],
    "private checkout identity",
  );
  if (
    observed.sourceTagObject !== expectedIdentity.tagObject ||
    observed.sourceTagCommit !== expectedIdentity.commit ||
    observed.distributionTagCommit !== expectedIdentity.distributionCommit ||
    observed.sourceHead !== expectedIdentity.commit ||
    observed.distributionHead !== expectedIdentity.distributionCommit ||
    observed.sourceBranch !== "HEAD" ||
    observed.distributionBranch !== "HEAD" ||
    observed.sourceStatus !== "" ||
    observed.distributionStatus !== ""
  ) {
    fail("private discovery identity does not match");
  }
}

export function validatePrivateReferences(discovery, source, distribution) {
  for (const entry of Object.values(discovery.namespaces).flat()) {
    for (const reference of entry.legacy_refs) {
      const [relativePath, anchor] = reference.split("#", 2);
      const candidates = [
        join(source, relativePath),
        join(distribution, relativePath),
      ];
      const existing = candidates.find((candidate) => existsSync(candidate));
      if (existing === undefined) {
        fail("private legacy reference does not exist");
      }
      if (anchor !== undefined) {
        let stats;
        try {
          stats = statSync(existing);
        } catch {
          fail("private legacy reference could not be inspected");
        }
        if (
          !stats.isFile() ||
          !readFileSync(existing, "utf8").includes(anchor)
        ) {
          fail("private legacy reference anchor does not exist");
        }
      }
    }
  }
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

const verificationKinds = ["unit", "differential", "integration", "e2e"];
const verificationPrefixes = {
  unit: "UNIT",
  differential: "DIFF",
  integration: "INT",
  e2e: "E2E",
};
const rowStatuses = [
  "not_started",
  "in_progress",
  "parity",
  "intentional_difference",
];
const owners = [
  "@kratos/contracts",
  "@kratos/runtime",
  "@kratos/adapters",
  // Frozen source matrices retain the package owners that existed when the
  // Go-to-TypeScript baseline was captured. They are provenance, not current
  // package names.
  "@mestre-yoda/contracts",
  "@mestre-yoda/runtime",
  "@mestre-yoda/adapters",
  "plugin",
];
const specificityPhrases = {
  alias: ["dispatch"],
  benchmark: ["fixture", "machine-readable"],
  command: ["Observable contract:", "stderr"],
  "command-forms": ["nested command form", "exact usage"],
  documentation: ["public path", "relative links"],
  "exit-codes": ["numeric exit class", "stdout", "stderr"],
  flags: ["Type/default/effect:", "Parsing/precedence:"],
  generated_file: ["relative location", "merge/overwrite"],
  global_flag: ["before command dispatch", "compatibility check"],
  human_gate: ["explicit decision", "gate closed"],
  "io-contracts": ["stream", "framing"],
  package: ["responsibility", "exported behavior"],
  phase: ["predecessor artifacts", "phase transition"],
  plugin_file: ["public relative path", "packaging validation"],
  reason_code: ["exact stable reason code", "domain condition"],
  retired_command: ["remains unavailable", "agent-only trail"],
  schema: ["required fields", "conditional relationships"],
  state_transition: ["source condition", "destination condition"],
  workflow: ["trigger", "permissions"],
};
const prdSpecificityPhrases = {
  "PRD-OUTPUT-SCHEMA": ["completed", "needs_input"],
  "PRD-PROBLEM-DISCOVERY": ["5 Whys", "5W2H"],
  "PRD-RESEARCHER": ["needs_input", "WHAT/WHY"],
  "PRD-TEMPLATE": ["WHAT/WHY", "implementation architecture"],
};

function resolveRepositoryFile(repositoryRoot, path, context) {
  if (isAbsolute(path) || win32.isAbsolute(path)) {
    fail(`${context} path is absolute`);
  }
  const resolvedRoot = resolve(repositoryRoot);
  const resolvedPath = resolve(resolvedRoot, path);
  const offset = relative(resolvedRoot, resolvedPath);
  let stats;
  try {
    stats = statSync(resolvedPath);
  } catch {
    fail(`${context} path is missing or outside the repository`);
  }
  if (offset.startsWith("..") || isAbsolute(offset) || !stats.isFile()) {
    fail(`${context} path is missing or outside the repository`);
  }
  return resolvedPath;
}

function assertEvidencePath(repositoryRoot, evidence, context, kind, rowId) {
  if (evidence.status === "planned") {
    if (evidence.path !== null) fail(`${context} planned evidence has a path`);
    return;
  }
  if (evidence.status !== "passed" || typeof evidence.path !== "string") {
    fail(`${context} evidence status is invalid`);
  }
  const expectedPrefix =
    kind === "differential" ? "compatibility/fixtures/" : "tests/";
  if (
    !evidence.path.startsWith(expectedPrefix) ||
    (kind === "differential"
      ? !evidence.path.endsWith(".json")
      : !evidence.path.endsWith(".test.ts"))
  ) {
    fail(`${context} evidence path has the wrong kind`);
  }
  const resolvedPath = resolveRepositoryFile(
    repositoryRoot,
    evidence.path,
    `${context} evidence`,
  );
  const contents = readFileSync(resolvedPath, "utf8");
  if (
    contents.length === 0 ||
    (!contents.includes(evidence.id) && !contents.includes(rowId))
  ) {
    fail(`${context} evidence is empty or unrelated`);
  }
}

export function validateMatrix(discovery, matrix, repositoryRoot) {
  assertOnlyKeys(
    matrix,
    ["schema_version", "oracle_id", "discovery_algorithm_version", "rows"],
    "matrix",
  );
  if (
    matrix.schema_version !== 1 ||
    matrix.oracle_id !== "go-v3-v0.6.5" ||
    matrix.discovery_algorithm_version !== discovery.algorithm_version ||
    !Array.isArray(matrix.rows) ||
    matrix.rows.length === 0
  ) {
    fail("matrix identity or rows changed");
  }
  assertSafeStrings(matrix, true);

  const discoveredKeys = Object.values(discovery.namespaces)
    .flat()
    .map(({ key }) => key)
    .toSorted();
  const discoveredEntries = new Map(
    Object.values(discovery.namespaces)
      .flat()
      .map((entry) => [entry.key, entry]),
  );
  const allowedReferences = new Set(
    Object.values(discovery.namespaces)
      .flat()
      .flatMap(({ legacy_refs: references }) => references),
  );
  const rowIds = [];
  const caseIds = [];
  const coveredKeys = [];

  for (const row of matrix.rows) {
    assertOnlyKeys(
      row,
      [
        "id",
        "category",
        "title",
        "legacy_refs",
        "covers",
        "expected_behavior",
        "priority",
        "typescript_owner",
        "verification",
        "status",
        "intentional_difference",
      ],
      "matrix row",
    );
    if (
      typeof row.id !== "string" ||
      !/^[A-Z][A-Z0-9-]+$/u.test(row.id) ||
      typeof row.category !== "string" ||
      row.category.length === 0 ||
      typeof row.title !== "string" ||
      row.title.length === 0 ||
      typeof row.expected_behavior !== "string" ||
      !["P0", "P1", "P2"].includes(row.priority) ||
      !owners.includes(row.typescript_owner) ||
      !rowStatuses.includes(row.status) ||
      !Array.isArray(row.legacy_refs) ||
      row.legacy_refs.length === 0 ||
      !Array.isArray(row.covers) ||
      row.covers.length === 0
    ) {
      fail("matrix row is incomplete");
    }
    if (
      row.legacy_refs.some(
        (reference) =>
          typeof reference !== "string" || !allowedReferences.has(reference),
      )
    ) {
      fail(`${row.id} has an unknown legacy reference`);
    }
    if (new Set(row.legacy_refs).size !== row.legacy_refs.length) {
      fail(`${row.id} has duplicate legacy references`);
    }
    if (
      row.covers.some((key) => typeof key !== "string") ||
      new Set(row.covers).size !== row.covers.length
    ) {
      fail(`${row.id} has invalid discovery coverage`);
    }
    if (
      row.priority !== "P2" &&
      (!row.expected_behavior.startsWith("Normal:") ||
        !row.expected_behavior.includes(" Failure:") ||
        !row.expected_behavior.includes(" Edge:") ||
        row.expected_behavior.includes(
          "preserve the frozen contract with deterministic observable results",
        ) ||
        row.expected_behavior.includes(
          "preserve the frozen benchmark contract",
        ) ||
        row.expected_behavior.includes(
          "preserve the frozen command contract",
        ) ||
        row.expected_behavior.length < 180)
    ) {
      fail(`${row.id} lacks explicit verification requirements`);
    }
    if (
      row.priority !== "P2" &&
      row.category !== "prd" &&
      row.covers.some((key) => {
        const name = discoveredEntries.get(key)?.name;
        return (
          typeof name !== "string" || !row.expected_behavior.includes(name)
        );
      })
    ) {
      fail(`${row.id} lacks contract-specific verification requirements`);
    }
    if (row.priority !== "P2") {
      const phrases =
        row.category === "prd"
          ? prdSpecificityPhrases[row.id]
          : specificityPhrases[row.category];
      if (
        !Array.isArray(phrases) ||
        phrases.some((phrase) => !row.expected_behavior.includes(phrase))
      ) {
        fail(`${row.id} lacks domain-specific verification requirements`);
      }
    }
    assertOnlyKeys(
      row.verification,
      verificationKinds,
      `${row.id} verification`,
    );
    let everyCasePassed = true;
    for (const kind of verificationKinds) {
      const evidence = row.verification[kind];
      assertOnlyKeys(evidence, ["id", "status", "path"], `${row.id} ${kind}`);
      if (
        typeof evidence.id !== "string" ||
        evidence.id !== `${verificationPrefixes[kind]}-${row.id}`
      ) {
        fail(`${row.id} ${kind} evidence ID changed`);
      }
      assertEvidencePath(
        repositoryRoot,
        evidence,
        `${row.id} ${kind}`,
        kind,
        row.id,
      );
      everyCasePassed &&= evidence.status === "passed";
      caseIds.push(evidence.id);
    }
    if (row.status === "parity") {
      if (
        !everyCasePassed ||
        row.intentional_difference !== null ||
        new Set(verificationKinds.map((kind) => row.verification[kind].path))
          .size !== verificationKinds.length
      ) {
        fail(`${row.id} makes an unsupported parity claim`);
      }
    } else if (row.status === "intentional_difference") {
      assertOnlyKeys(
        row.intentional_difference,
        ["adr", "migration_note", "replacement_behavior", "approval"],
        `${row.id} intentional difference`,
      );
      const decision = row.intentional_difference;
      if (
        !everyCasePassed ||
        typeof decision.adr !== "string" ||
        typeof decision.migration_note !== "string" ||
        typeof decision.replacement_behavior !== "string" ||
        decision.replacement_behavior.length === 0 ||
        typeof decision.approval !== "string"
      ) {
        fail(`${row.id} intentional difference is incomplete`);
      }
      if (
        !decision.adr.startsWith("docs/adr/") ||
        !decision.adr.endsWith(".md") ||
        !decision.migration_note.startsWith("docs/") ||
        !decision.migration_note.endsWith(".md")
      ) {
        fail(`${row.id} approval path has the wrong kind`);
      }
      const adr = readFileSync(
        resolveRepositoryFile(repositoryRoot, decision.adr, `${row.id} ADR`),
        "utf8",
      );
      const migration = readFileSync(
        resolveRepositoryFile(
          repositoryRoot,
          decision.migration_note,
          `${row.id} migration note`,
        ),
        "utf8",
      );
      if (
        !/^Status: Accepted$/mu.test(adr) ||
        !migration.includes(row.id) ||
        new Set(verificationKinds.map((kind) => row.verification[kind].path))
          .size !== verificationKinds.length
      ) {
        fail(`${row.id} approval evidence is invalid or unrelated`);
      }
    } else if (row.intentional_difference !== null) {
      fail(`${row.id} has an inactive intentional difference`);
    }
    rowIds.push(row.id);
    coveredKeys.push(...row.covers);
  }

  if (
    new Set(rowIds).size !== rowIds.length ||
    JSON.stringify(rowIds) !== JSON.stringify(rowIds.toSorted())
  ) {
    fail("matrix row IDs are duplicated or unsorted");
  }
  if (new Set(caseIds).size !== caseIds.length) {
    fail("verification case IDs are duplicated");
  }
  if (
    JSON.stringify(coveredKeys.toSorted()) !== JSON.stringify(discoveredKeys)
  ) {
    fail("matrix discovery coverage is incomplete or duplicated");
  }
  if (
    !matrix.rows.some(({ priority }) => priority === "P0") ||
    !matrix.rows.some(({ priority }) => priority === "P1")
  ) {
    fail("matrix must retain nonempty P0 and P1 populations");
  }
  return matrix;
}

function parityFor(rows) {
  const credited = rows.filter(({ status }) =>
    ["parity", "intentional_difference"].includes(status),
  ).length;
  const basisPoints = Math.round((credited * 10_000) / rows.length);
  return {
    credited,
    total: rows.length,
    percent: `${Math.floor(basisPoints / 100)}.${String(
      basisPoints % 100,
    ).padStart(2, "0")}`,
  };
}

export function calculateParity(matrix) {
  return {
    overall: parityFor(matrix.rows),
    P0: parityFor(matrix.rows.filter(({ priority }) => priority === "P0")),
    P1: parityFor(matrix.rows.filter(({ priority }) => priority === "P1")),
  };
}
