import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

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
  const hostFiles = artifactFiles.filter(
    (file) => !relative(root, file).startsWith(`runtime${sep}`),
  );
  if ((await digestTree(root, hostFiles)) !== manifest.host.assetsSha256) {
    fail(`${host} host assets digest is wrong`);
  }

  const hostManifestPath =
    host === "codex"
      ? join(root, ".codex-plugin/plugin.json")
      : join(root, ".claude-plugin/plugin.json");
  const hostManifest = JSON.parse(await readFile(hostManifestPath, "utf8"));
  if (
    hostManifest.name !== "kratos" ||
    hostManifest.version !== manifest.pluginVersion
  ) {
    fail(`${host} host manifest is not version coherent`);
  }
  if (host === "codex" && hostManifest.skills !== "./skills/") {
    fail("Codex manifest does not expose the Kratos skill");
  }
  const skillBridge = join(root, "skills/kratos/scripts/kratos.mjs");
  const bridge = await readFile(skillBridge, "utf8");
  if (!bridge.includes('import "../../../runtime/kratos.mjs"')) {
    fail(`${host} skill bridge points at the wrong runtime`);
  }
  return manifest;
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

async function verifyProjectFlow(runtime, host, workRoot) {
  const project = join(workRoot, `${host}-project`);
  run("git", ["init", "-q", project]);
  run("git", ["-C", project, "config", "user.email", "kratos@example.invalid"]);
  run("git", ["-C", project, "config", "user.name", "Kratos"]);
  const answers = await readFile(
    join(repositoryRoot, "fixtures/contracts/v1/init-answers.json"),
    "utf8",
  );
  const initHost = host === "codex" ? "codex" : "claude";
  run(runtime, ["init", "--host", initHost, "--root", project], {
    input: answers,
  });
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
  if (host === "claude-code" && !projectFiles.includes("CLAUDE.md")) {
    fail("Claude Code project instructions are absent");
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
  for (const host of ["codex", "claude-code"]) {
    await verifyArtifact(join(source, host), host);
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
    await verifyProjectFlow(runtime, host, cleanRoom);
  }
  process.stdout.write(
    "Kratos package verification passed for Codex and Claude Code.\n",
  );
} finally {
  await rm(cleanRoom, { force: true, recursive: true });
}
