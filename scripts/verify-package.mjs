import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

const PHASE_AGENT_IDS = [
  "code-implementer",
  "implementation-evaluator",
  "prd-researcher",
  "spec-planner",
  "spec-reviewer",
];

const PROJECT_PROFILE_QUESTIONS = [
  [
    "projectProfile.commands.test",
    "What exact test command should run from the project root?",
  ],
  [
    "projectProfile.commands.lint",
    "What exact lint command should run from the project root?",
  ],
  [
    "projectProfile.commands.build",
    "What exact build command should run from the project root?",
  ],
  [
    "projectProfile.commands.run",
    "What exact application command should run from the project root?",
  ],
  [
    "projectProfile.paths.source",
    "Which project-relative paths contain source code?",
  ],
  ["projectProfile.paths.tests", "Which project-relative paths contain tests?"],
  [
    "projectProfile.paths.configuration",
    "Which project-relative paths contain configuration?",
  ],
  [
    "projectProfile.conventions.directoryLayout",
    "What directory-layout convention should phase agents preserve?",
  ],
  [
    "projectProfile.conventions.naming",
    "What naming convention should phase agents preserve?",
  ],
  [
    "projectProfile.conventions.implementationLanguages",
    "Which implementation languages does this project use?",
  ],
].map(([key, prompt]) => ({ key, prompt }));

const PROJECT_PROFILE_PROBE = {
  "projectProfile.commands.test": {
    status: "resolved",
    value: "node --test profile-probe",
  },
  "projectProfile.commands.lint": {
    status: "not-applicable",
    reason: "The probe has no lint command.",
  },
  "projectProfile.commands.build": { status: "unresolved" },
  "projectProfile.commands.run": {
    status: "resolved",
    value: "node profile-probe.mjs",
  },
  "projectProfile.paths.source": {
    status: "resolved",
    value: ["probe/source", "probe/shared"],
  },
  "projectProfile.paths.tests": {
    status: "not-applicable",
    reason: "Probe tests are external.",
  },
  "projectProfile.paths.configuration": { status: "unresolved" },
  "projectProfile.conventions.directoryLayout": {
    status: "resolved",
    value: "Keep probe modules under probe/source.",
  },
  "projectProfile.conventions.naming": {
    status: "not-applicable",
    reason: "The probe has no naming rule.",
  },
  "projectProfile.conventions.implementationLanguages": {
    status: "resolved",
    value: ["ProbeLang", "OtherLang"],
  },
};

const PROJECT_PROFILE_EXPECTED = {
  commands: {
    test: PROJECT_PROFILE_PROBE["projectProfile.commands.test"],
    lint: PROJECT_PROFILE_PROBE["projectProfile.commands.lint"],
    build: PROJECT_PROFILE_PROBE["projectProfile.commands.build"],
    run: PROJECT_PROFILE_PROBE["projectProfile.commands.run"],
  },
  paths: {
    source: PROJECT_PROFILE_PROBE["projectProfile.paths.source"],
    tests: PROJECT_PROFILE_PROBE["projectProfile.paths.tests"],
    configuration: PROJECT_PROFILE_PROBE["projectProfile.paths.configuration"],
  },
  conventions: {
    directoryLayout:
      PROJECT_PROFILE_PROBE["projectProfile.conventions.directoryLayout"],
    naming: PROJECT_PROFILE_PROBE["projectProfile.conventions.naming"],
    implementationLanguages:
      PROJECT_PROFILE_PROBE[
        "projectProfile.conventions.implementationLanguages"
      ],
  },
};

const PROJECT_PROFILE_RENDERED_FRAGMENTS = [
  "### Test\n\n```text\nnode --test profile-probe\n```",
  "### Lint\n\nNot applicable: The probe has no lint command\\.",
  "`<UNRESOLVED: projectProfile.commands.build>`",
  "### Run\n\n```text\nnode profile-probe.mjs\n```",
  "| Source | probe/source, probe/shared |",
  "| Tests | Not applicable: Probe tests are external\\. |",
  "| Configuration | `<UNRESOLVED: projectProfile.paths.configuration>` |",
  "| Directory layout | Keep probe modules under probe/source\\. |",
  "| Naming | Not applicable: The probe has no naming rule\\. |",
  "| Implementation languages | ProbeLang, OtherLang |",
];

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    const path = join(entry.parentPath, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink()) fail("package contains a symbolic link");
    if (details.isFile()) result.push(path);
  }
  return result.sort();
}

async function digestTree(directory, selected = null) {
  const hash = createHash("sha256");
  for (const file of selected ?? (await files(directory))) {
    hash.update(relative(directory, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: options.home ?? process.env.HOME },
    input: options.input,
  });
  if (result.error !== undefined) fail(result.error.message);
  if (result.status !== (options.status ?? 0)) {
    fail(
      `${executable} ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

async function verifyArtifact(root, host) {
  const manifest = JSON.parse(
    await readFile(join(root, "runtime/manifest.json"), "utf8"),
  );
  if (manifest.host?.name !== host) fail(`${host} manifest identity is wrong`);
  const core = await readFile(join(root, manifest.runtime.core));
  if (
    createHash("sha256").update(core).digest("hex") !==
    manifest.runtime.coreSha256
  ) {
    fail(`${host} core digest is wrong`);
  }
  if (
    (await digestTree(join(root, manifest.runtime.sourceRoot))) !==
    manifest.runtime.sourceTreeSha256
  ) {
    fail(`${host} source tree digest is wrong`);
  }
  const artifactFiles = await files(root);
  const relativeFiles = artifactFiles.map((file) =>
    relative(root, file).split(sep).join("/"),
  );
  const forbidden = relativeFiles.filter(
    (file) =>
      file.includes("node_modules/") ||
      file.endsWith(".ts") ||
      file.endsWith(".map"),
  );
  if (forbidden.length > 0) fail(`${host} contains ${forbidden.join(", ")}`);
  if (host === "claude-code") {
    const missingAgents = PHASE_AGENT_IDS.map((id) => `agents/${id}.md`).filter(
      (file) => !relativeFiles.includes(file),
    );
    if (missingAgents.length > 0) {
      fail(`claude-code phase agents are absent: ${missingAgents.join(", ")}`);
    }
  }
  const hostFiles = artifactFiles.filter(
    (file) => !relative(root, file).startsWith(`runtime${sep}`),
  );
  if ((await digestTree(root, hostFiles)) !== manifest.host.assetsSha256) {
    fail(`${host} host assets digest is wrong`);
  }

  // Every host requires its own manifest at the location its documentation
  // names: `.codex-plugin/plugin.json` for Codex, `.claude-plugin/plugin.json`
  // for Claude Code, and `plugin.json` at the plugin root for Antigravity.
  // Without it the host does not recognize the directory as a plugin at all.
  const hostManifestPath =
    host === "codex"
      ? join(root, ".codex-plugin/plugin.json")
      : host === "claude-code"
        ? join(root, ".claude-plugin/plugin.json")
        : join(root, "plugin.json");
  const hostManifest = JSON.parse(await readFile(hostManifestPath, "utf8"));
  if (hostManifest.name !== "kratos") {
    fail(`${host} host manifest does not identify the Kratos plugin`);
  }
  // Antigravity's documented manifest carries `name`, `description`, and
  // `$schema` and no version field, so the installed version is read from
  // `runtime/manifest.json` there. Inventing a field the host does not
  // document would be a manifest this project made up.
  if (
    host !== "antigravity" &&
    hostManifest.version !== manifest.pluginVersion
  ) {
    fail(`${host} host manifest is not version coherent`);
  }
  if (host === "antigravity" && hostManifest.version !== undefined) {
    fail("Antigravity manifest declares an undocumented version field");
  }
  if (host === "codex" && hostManifest.skills !== "./skills/") {
    fail("Codex manifest does not expose the Kratos skill");
  }
  const skillBridge = join(root, "skills/kratos/scripts/kratos.mjs");
  const bridge = await readFile(skillBridge, "utf8");
  if (!bridge.includes('import "../../../runtime/kratos.mjs"')) {
    fail(`${host} skill bridge points at the wrong runtime`);
  }
  return verifyProjectProfileRelay(root, host);
}

async function verifyProjectProfileRelay(root, host) {
  const relay = await import(
    pathToFileURL(join(root, "skills/kratos/scripts/project-profile-relay.mjs"))
      .href
  ).catch(() => null);
  if (
    relay === null ||
    JSON.stringify(relay.projectProfileQuestions) !==
      JSON.stringify(PROJECT_PROFILE_QUESTIONS) ||
    typeof relay.relayProjectProfileAnswers !== "function"
  ) {
    fail(`${host} project-profile questions are invalid`);
  }
  let relayed;
  try {
    relayed = relay.relayProjectProfileAnswers(PROJECT_PROFILE_PROBE);
  } catch {
    fail(`${host} project-profile answer relay is invalid`);
  }
  if (JSON.stringify(relayed) !== JSON.stringify(PROJECT_PROFILE_EXPECTED)) {
    fail(`${host} project-profile answer relay is invalid`);
  }
  return relayed;
}

async function verifyMarketplaces(root) {
  const codex = JSON.parse(
    await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"),
  );
  const claude = JSON.parse(
    await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8"),
  );
  if (
    codex.name !== "kratos-open-source" ||
    codex.plugins?.[0]?.name !== "kratos" ||
    codex.plugins[0].source?.path !== "./codex"
  ) {
    fail("Codex local marketplace is invalid");
  }
  if (
    claude.name !== "kratos-open-source" ||
    claude.plugins?.[0]?.name !== "kratos" ||
    claude.plugins[0].source !== "./claude-code"
  ) {
    fail("Claude Code local marketplace is invalid");
  }
}

async function verifyProjectFlow(runtime, host, workRoot, projectProfile) {
  const project = join(workRoot, `${host}-project`);
  run("git", ["init", "-q", project]);
  run("git", ["-C", project, "config", "user.email", "kratos@example.invalid"]);
  run("git", ["-C", project, "config", "user.name", "Kratos"]);
  const initHost = host === "claude-code" ? "claude" : host;
  const fixture = JSON.parse(
    await readFile(
      join(repositoryRoot, "fixtures/contracts/v1.3/init-answers.json"),
      "utf8",
    ),
  );
  const hostRoles = fixture.modelRoles?.[initHost];
  if (hostRoles === undefined) {
    fail(`current init fixture lacks ${initHost} model routing`);
  }
  const answers = `${JSON.stringify({
    ...fixture,
    hosts: [initHost],
    modelRoles: { [initHost]: hostRoles },
    projectProfile,
  })}\n`;
  run(runtime, ["init", "--host", initHost, "--root", project], {
    input: answers,
  });
  const configuration = JSON.parse(
    await readFile(join(project, ".brain/config.json"), "utf8"),
  );
  if (
    JSON.stringify(configuration.projectProfile) !==
    JSON.stringify(PROJECT_PROFILE_EXPECTED)
  ) {
    fail(`${host} initialized project-profile values are wrong`);
  }
  const stackProfile = await readFile(
    join(project, ".brain/01-architecture/stack-profile.md"),
    "utf8",
  );
  const missingProfileFragments = PROJECT_PROFILE_RENDERED_FRAGMENTS.filter(
    (fragment) => !stackProfile.includes(fragment),
  );
  if (missingProfileFragments.length > 0) {
    fail(`${host} initialized stack-profile rendering is wrong`);
  }
  const projectFiles = (await files(project))
    .map((file) => relative(project, file).split(sep).join("/"))
    .filter((file) => !file.startsWith(".git/"));
  const leaked = projectFiles.filter(
    (file) =>
      file.includes("node_modules/") ||
      file.includes("/runtime/") ||
      file.startsWith("runtime/") ||
      file.startsWith("packages/") ||
      file.includes("/skills/") ||
      file.startsWith("skills/") ||
      file.endsWith("/SKILL.md") ||
      file === "SKILL.md" ||
      file.endsWith(".ts") ||
      file.endsWith(".map"),
  );
  if (leaked.length > 0)
    fail(`project received engine files: ${leaked.join(", ")}`);
  if (host === "codex" && !projectFiles.includes("AGENTS.md")) {
    fail("Codex project instructions are absent");
  }
  if (host === "codex") {
    for (const id of PHASE_AGENT_IDS) {
      const path = `.codex/agents/${id}.toml`;
      if (!projectFiles.includes(path)) fail(`Codex project lacks ${path}`);
      const definition = await readFile(join(project, path), "utf8");
      if (!definition.includes("developer_instructions = ")) {
        fail(`Codex project agent ${id} has no instructions`);
      }
    }
  }
  if (host === "claude-code" && !projectFiles.includes("CLAUDE.md")) {
    fail("Claude Code project instructions are absent");
  }
  if (host === "antigravity" && !projectFiles.includes("GEMINI.md")) {
    fail("Antigravity project instructions are absent");
  }
  run("git", ["-C", project, "add", "."]);
  run("git", ["-C", project, "commit", "-qm", "Initialize Kratos"]);
  run(runtime, [
    "objective",
    `Prove the ${host} Kratos workflow`,
    "--root",
    project,
  ]);
  run("git", ["-C", project, "add", "."]);
  run("git", ["-C", project, "commit", "-qm", "Record objective"]);
  run(runtime, [
    "start",
    "--run-id",
    `${host}-smoke-run`,
    "--host",
    host,
    "--correlation-id",
    `${host}-start`,
    "--root",
    project,
  ]);
  const status = JSON.parse(
    run(runtime, ["status", "--json", "--root", project]),
  );
  if (status.status !== "success" || !status.summary.includes("revision 1")) {
    fail(`${host} project workflow did not start`);
  }
}

const source = resolve(
  option("--source") ??
    process.env.KRATOS_BUILD_OUTPUT ??
    join(tmpdir(), "kratos-plugin-build"),
);
const cleanRoom = await mkdtemp(join(tmpdir(), "kratos-package-verify-"));
try {
  await verifyMarketplaces(source);
  for (const host of ["codex", "claude-code", "antigravity"]) {
    const projectProfile = await verifyArtifact(join(source, host), host);
    const target = join(cleanRoom, "installed", host);
    const installOutput = run(process.execPath, [
      join(repositoryRoot, "scripts/install-plugin.mjs"),
      "install",
      "--source",
      source,
      "--host",
      host,
      "--target",
      target,
    ]);
    const installation = JSON.parse(installOutput);
    if (!installation.installed || installation.host !== host) {
      fail(`${host} installer did not activate the package`);
    }
    run(process.execPath, [
      join(repositoryRoot, "scripts/install-plugin.mjs"),
      "install",
      "--source",
      source,
      "--host",
      host,
      "--target",
      target,
    ]);
    const runtime = join(target, "runtime/kratos.mjs");
    const version = run(runtime, ["version"]);
    const manifest = JSON.parse(
      await readFile(join(target, "runtime/manifest.json"), "utf8"),
    );
    if (version !== `${manifest.pluginVersion}\n`) {
      fail(`${host} installed runtime reports the wrong version`);
    }
    const handshake = JSON.parse(run(runtime, ["handshake", "--json"]));
    if (handshake.operation !== "handshake") {
      fail(`${host} installed runtime handshake failed`);
    }
    await verifyProjectFlow(runtime, host, cleanRoom, projectProfile);
  }
  process.stdout.write(
    "Kratos package verification passed for Codex, Claude Code, and Antigravity.\n",
  );
} finally {
  await rm(cleanRoom, { force: true, recursive: true });
}
