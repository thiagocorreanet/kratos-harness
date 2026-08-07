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
  "runtime/manifest.json",
  "runtime/yoda.core.mjs",
  "runtime/yoda.mjs",
];
const expectedDirectories = new Set(["runtime"]);
const expectedHelp =
  "Usage: yoda [--expect <version>] [--help | --version | handshake]\n";
const expectedVersion = "0.0.0-development\n";
const allowedBuiltins = new Set(
  builtinModules.map((moduleName) =>
    moduleName.startsWith("node:") ? moduleName : `node:${moduleName}`,
  ),
);

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
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
  expectedOutput,
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

  if (result.stdout !== expectedOutput) {
    fail(
      `${argument} produced unexpected stdout: ${JSON.stringify(result.stdout)}`,
    );
  }

  return result.stdout;
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

const forbiddenReferences = [
  "node_modules",
  "/packages/",
  "\\packages\\",
  repositoryRoot,
];
for (const reference of forbiddenReferences) {
  if (bundle.includes(reference)) {
    fail(`runtime/yoda.core.mjs contains forbidden reference: ${reference}`);
  }
  if (entrySource.includes(reference)) {
    fail(`runtime/yoda.mjs contains forbidden reference: ${reference}`);
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

  const help = executeIsolated(
    isolatedArtifact,
    "--help",
    expectedHelp,
    cleanRoom,
  );
  const version = executeIsolated(
    isolatedArtifact,
    "--version",
    expectedVersion,
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
