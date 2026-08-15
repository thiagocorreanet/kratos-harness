import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pluginDirectory = join(repositoryRoot, "dist/plugin");
const artifact = join(pluginDirectory, "runtime/yoda.mjs");
const core = join(pluginDirectory, "runtime/yoda.core.mjs");
// The exact set of files a plugin install contains. Anything else fails.
const expectedInventory = [
  "runtime/THIRD-PARTY-NOTICES.txt",
  "runtime/manifest.json",
  "runtime/yoda.core.mjs",
  "runtime/yoda.mjs",
];
const expectedDirectories = new Set(["runtime"]);
// Patterns a project the plugin operated on must never contain.
const projectDenylist = [
  /(^|\/)node_modules(\/|$)/u,
  /(^|\/)packages(\/|$)/u,
  /(^|\/)runtime(\/|$)/u,
  /\.(ts|map)$/u,
];
const expectedHelpFirstLine =
  "Usage: yoda [--expect <version>] [--json] <command>";
const expectedVersion = "0.0.0-development\n";
const allowedBuiltins = new Set(
  builtinModules.map((moduleName) =>
    moduleName.startsWith("node:") ? moduleName : `node:${moduleName}`,
  ),
);

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
}

/** Entries a project must never contain, normalized to POSIX separators. */
function deniedEntries(entries) {
  return entries
    .map((entry) => entry.split(sep).join("/"))
    .filter((entry) => projectDenylist.some((pattern) => pattern.test(entry)));
}

async function inventory(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(entry.parentPath, entry.name);
    const details = await lstat(absolutePath);

    if (details.isSymbolicLink()) {
      fail(
        `symbolic links are not allowed: ${relative(directory, absolutePath)}`,
      );
    }

    if (details.isFile()) {
      files.push(relative(directory, absolutePath).split(sep).join("/"));
    } else if (details.isDirectory()) {
      const stagedDirectory = relative(directory, absolutePath)
        .split(sep)
        .join("/");
      if (!expectedDirectories.has(stagedDirectory)) {
        fail(`unexpected staged directory: ${stagedDirectory}`);
      }
    } else {
      fail(`unsupported staged entry: ${relative(directory, absolutePath)}`);
    }
  }

  return files.sort();
}

function executeIsolated(
  executable,
  argument,
  acceptsOutput,
  workingDirectory,
) {
  const command = process.platform === "win32" ? process.execPath : executable;
  const args =
    process.platform === "win32" ? [executable, argument] : [argument];

  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: {
      HOME: workingDirectory,
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: dirname(process.execPath),
      TMPDIR: tmpdir(),
    },
  });

  if (result.error !== undefined) {
    fail(`${argument} could not execute: ${result.error.message}`);
  }

  if (result.status !== 0 || result.stderr !== "") {
    fail(
      `${argument} exited ${String(result.status)} with stderr: ${result.stderr}`,
    );
  }

  if (!acceptsOutput(result.stdout)) {
    fail(
      `${argument} produced unexpected stdout: ${JSON.stringify(result.stdout)}`,
    );
  }

  return result.stdout;
}

/**
 * Every third-party package directory the build metadata says was bundled.
 *
 * Directories rather than names: a nested copy is a different version than a
 * hoisted one, and a notice naming the wrong version attributes nothing.
 */
function bundledPackageDirectories(metadata) {
  const output = metadata.outputs["dist/plugin/runtime/yoda.core.mjs"];
  if (output === undefined) {
    fail("build metadata records no bundle output");
  }
  const marker = "node_modules/";
  const directories = new Set();
  for (const input of Object.keys(output.inputs)) {
    const at = input.lastIndexOf(marker);
    if (at === -1) continue;
    const segments = input.slice(at + marker.length).split("/");
    const depth = segments[0].startsWith("@") ? 2 : 1;
    directories.add(
      input.slice(0, at + marker.length) + segments.slice(0, depth).join("/"),
    );
  }
  return [...directories].sort();
}

/**
 * Each heading the notices file carries, mapped to the text under it.
 *
 * Sections are found by their rule lines rather than by scanning for anything
 * heading-shaped, so a line inside a license cannot be read as the start of
 * another package's notice.
 */
function attributions(notices) {
  const heading = /^\S+ \S+ \([^)]+\)$/u;
  const rule = "=".repeat(78);
  const lines = notices.split("\n");
  const found = new Map();
  for (let index = 0; index + 2 < lines.length; index += 1) {
    if (lines[index] !== rule || lines[index + 2] !== rule) continue;
    if (!heading.test(lines[index + 1])) continue;
    let end = index + 3;
    while (end < lines.length && lines[end] !== rule) end += 1;
    found.set(
      lines[index + 1],
      lines
        .slice(index + 3, end)
        .join("\n")
        .trim(),
    );
    index = end - 1;
  }
  return found;
}

function acceptsHelp(output) {
  return (
    output.split("\n")[0] === expectedHelpFirstLine &&
    ["handshake", "help", "version"].every((command) =>
      output.includes(`  ${command}`),
    )
  );
}

function exactly(expected) {
  return (output) => output === expected;
}

const stagedFiles = await inventory(pluginDirectory);
if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedInventory)) {
  fail(
    `expected ${expectedInventory.join(", ")}; found ${stagedFiles.join(", ")}`,
  );
}

const artifactDetails = await lstat(artifact);
if (process.platform !== "win32" && (artifactDetails.mode & 0o111) === 0) {
  fail("runtime/yoda.mjs is not executable");
}

const entrySource = await readFile(artifact, "utf8");
if (!entrySource.startsWith("#!/usr/bin/env node\n")) {
  fail("runtime/yoda.mjs does not begin with the Node shebang");
}
if (/__[A-Z_]+__/u.test(entrySource)) {
  fail("runtime/yoda.mjs retains an unsubstituted placeholder");
}

const coreBytes = await readFile(core);
const bundle = coreBytes.toString("utf8");
if (bundle.startsWith("#!")) {
  fail("runtime/yoda.core.mjs must not carry a shebang");
}

const distributionManifest = JSON.parse(
  await readFile(join(pluginDirectory, "runtime/manifest.json"), "utf8"),
);
const recordedDigest = createHash("sha256").update(coreBytes).digest("hex");
if (distributionManifest.runtime.coreSha256 !== recordedDigest) {
  fail("runtime/manifest.json does not record the built core digest");
}

const noticesSource = await readFile(
  join(pluginDirectory, "runtime/THIRD-PARTY-NOTICES.txt"),
  "utf8",
);

const forbiddenReferences = [
  "node_modules",
  "/packages/",
  "\\packages\\",
  repositoryRoot,
];
// The notices are read from paths under `node_modules` on the machine that
// built them, so they are held to the same rule as the two files they ship
// beside rather than trusted for being only license text.
for (const reference of forbiddenReferences) {
  for (const [name, staged] of [
    ["runtime/yoda.core.mjs", bundle],
    ["runtime/yoda.mjs", entrySource],
    ["runtime/THIRD-PARTY-NOTICES.txt", noticesSource],
  ]) {
    if (staged.includes(reference)) {
      fail(`${name} contains forbidden reference: ${reference}`);
    }
  }
}

const metadata = JSON.parse(
  await readFile(join(repositoryRoot, "dist/build-meta.json"), "utf8"),
);
for (const output of Object.values(metadata.outputs)) {
  for (const imported of output.imports) {
    if (imported.external === true && !allowedBuiltins.has(imported.path)) {
      fail(`bundle has invalid external import: ${imported.path}`);
    }
  }
}

// Re-derived here rather than taken from the builder. A notices file the build
// wrote from its own idea of what it bundled would prove only that the build
// agrees with itself; this reads the same metadata independently and checks
// the staged file against it.
const attributed = attributions(noticesSource);
const expectedHeadings = [];
for (const packageDirectory of bundledPackageDirectories(metadata)) {
  const declared = JSON.parse(
    await readFile(
      join(repositoryRoot, packageDirectory, "package.json"),
      "utf8",
    ),
  );
  const heading = `${declared.name} ${declared.version} (${declared.license})`;
  expectedHeadings.push(heading);
  const notice = attributed.get(heading);
  if (notice === undefined) {
    fail(`runtime/THIRD-PARTY-NOTICES.txt does not attribute ${heading}`);
  }
  // A heading with nothing under it attributes nothing. The shortest license
  // in the bundled set is over 400 characters.
  if (notice.length < 200) {
    fail(
      `runtime/THIRD-PARTY-NOTICES.txt carries no license text for ${heading}`,
    );
  }
}
for (const heading of attributed.keys()) {
  if (!expectedHeadings.includes(heading)) {
    fail(`runtime/THIRD-PARTY-NOTICES.txt attributes unbundled ${heading}`);
  }
}

const cleanRoom = await mkdtemp(join(tmpdir(), "mestre-yoda-package-"));
try {
  // Copy the whole runtime directory, so the isolated run exercises the real
  // two-file boot rather than an entry point with nothing to import.
  const isolatedRuntime = join(cleanRoom, "runtime");
  await mkdir(isolatedRuntime, { recursive: true });
  for (const staged of expectedInventory) {
    await copyFile(join(pluginDirectory, staged), join(cleanRoom, staged));
  }
  const isolatedArtifact = join(isolatedRuntime, "yoda.mjs");
  if (process.platform !== "win32") {
    await chmod(isolatedArtifact, 0o755);
  }

  // A project the runtime operated on receives state surfaces only. It must
  // never receive the runtime, its sources, or a dependency tree.
  const projectRoot = join(cleanRoom, "project");
  await mkdir(projectRoot, { recursive: true });
  executeIsolated(isolatedArtifact, "--help", acceptsHelp, projectRoot);
  const denied = deniedEntries(await readdir(projectRoot, { recursive: true }));
  if (denied.length > 0) {
    fail(`project install contains denied entries: ${denied.join(", ")}`);
  }

  // Prove the denylist actually rejects something. The runtime writes nothing
  // today, so without this the check above would pass just as happily if every
  // pattern were wrong, and the "deny" half would be a guard nobody tested.
  const probe = deniedEntries([
    "node_modules/left-pad/index.js",
    "packages/runtime/src/cli.ts",
    "runtime/yoda.mjs",
    "src/thing.ts",
    "dist/thing.map",
  ]);
  if (probe.length !== 5) {
    fail(
      `project denylist does not reject its own probe: matched ${String(probe.length)} of 5`,
    );
  }

  const help = executeIsolated(
    isolatedArtifact,
    "--help",
    acceptsHelp,
    cleanRoom,
  );
  const version = executeIsolated(
    isolatedArtifact,
    "--version",
    exactly(expectedVersion),
    cleanRoom,
  );
  console.log(`inventory: ${stagedFiles.join(", ")}`);
  console.log(
    `entry: runtime/yoda.mjs (${String(artifactDetails.size)} bytes)`,
  );
  console.log(
    `core: runtime/yoda.core.mjs (${String(coreBytes.byteLength)} bytes, sha256 ${recordedDigest})`,
  );
  console.log(`minimum node: ${distributionManifest.runtime.minimumNode}`);
  console.log(`help: ${help.trimEnd()}`);
  console.log(`version: ${version.trimEnd()}`);
} finally {
  await rm(cleanRoom, { force: true, recursive: true });
}
