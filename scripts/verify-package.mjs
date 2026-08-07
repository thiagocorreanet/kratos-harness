import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pluginDirectory = join(repositoryRoot, "dist/plugin");
const artifact = join(pluginDirectory, "runtime/yoda.mjs");
const expectedInventory = ["runtime/yoda.mjs"];

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
    } else if (!details.isDirectory()) {
      fail(`unsupported staged entry: ${relative(directory, absolutePath)}`);
    }
  }

  return files.sort();
}

function executeIsolated(executable, argument, workingDirectory) {
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

const bundle = await readFile(artifact, "utf8");
if (!bundle.startsWith("#!/usr/bin/env node\n")) {
  fail("runtime/yoda.mjs does not begin with the Node shebang");
}

const forbiddenReferences = [
  "node_modules",
  "/packages/",
  "\\packages\\",
  repositoryRoot,
];
for (const reference of forbiddenReferences) {
  if (bundle.includes(reference)) {
    fail(`runtime/yoda.mjs contains forbidden reference: ${reference}`);
  }
}

const metadata = JSON.parse(
  await readFile(join(repositoryRoot, "dist/build-meta.json"), "utf8"),
);
for (const output of Object.values(metadata.outputs)) {
  for (const imported of output.imports) {
    if (imported.external === true && !imported.path.startsWith("node:")) {
      fail(`bundle has external non-Node import: ${imported.path}`);
    }
  }
}

const cleanRoom = await mkdtemp(join(tmpdir(), "mestre-yoda-package-"));
try {
  const isolatedArtifact = join(cleanRoom, "yoda.mjs");
  await copyFile(artifact, isolatedArtifact);
  if (process.platform !== "win32") {
    await chmod(isolatedArtifact, 0o755);
  }

  const help = executeIsolated(isolatedArtifact, "--help", cleanRoom);
  const version = executeIsolated(isolatedArtifact, "--version", cleanRoom);
  const hash = createHash("sha256").update(bundle).digest("hex");

  console.log(`inventory: ${stagedFiles.join(", ")}`);
  console.log(`sha256: ${hash}`);
  console.log(`bytes: ${String(artifactDetails.size)}`);
  console.log(`help: ${help.trimEnd()}`);
  console.log(`version: ${version.trimEnd()}`);
} finally {
  await rm(cleanRoom, { force: true, recursive: true });
}
