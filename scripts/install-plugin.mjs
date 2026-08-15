import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

function fail(message) {
  throw new Error(`Kratos installer refused: ${message}`);
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function hostOption() {
  const host = option("--host");
  if (host !== "codex" && host !== "claude-code") {
    fail("--host must be codex or claude-code");
  }
  return host;
}

function safeAbsolute(value, name) {
  if (value === null || !isAbsolute(value)) fail(`${name} must be absolute`);
  const target = resolve(value);
  const root = parse(target).root;
  if (target === root || dirname(target) === root || basename(target) === "") {
    fail(`${name} is too broad`);
  }
  return target;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function files(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const result = [];
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink()) fail("plugin packages cannot contain symlinks");
    if (details.isFile()) result.push(path);
  }
  return result.sort();
}

async function digestTree(directory, selectedFiles = null) {
  const hash = createHash("sha256");
  for (const file of selectedFiles ?? (await files(directory))) {
    hash.update(relative(directory, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function verifySource(source, expectedHost) {
  const runtime = join(source, "runtime");
  const manifest = JSON.parse(
    await readFile(join(runtime, "manifest.json"), "utf8"),
  );
  if (manifest.host?.name !== expectedHost) {
    fail(`source is not the ${expectedHost} package`);
  }
  const core = await readFile(join(source, manifest.runtime.core));
  if (
    createHash("sha256").update(core).digest("hex") !==
    manifest.runtime.coreSha256
  ) {
    fail("source core digest does not match its manifest");
  }
  const sourceRoot = join(source, manifest.runtime.sourceRoot);
  if ((await digestTree(sourceRoot)) !== manifest.runtime.sourceTreeSha256) {
    fail("source runtime tree does not match its manifest");
  }
  for (const required of [
    manifest.runtime.entry,
    manifest.runtime.core,
    "runtime/THIRD-PARTY-NOTICES.txt",
  ]) {
    if (!(await exists(join(source, required)))) fail(`source is missing ${required}`);
  }
  const packageFiles = await files(source);
  const forbidden = packageFiles
    .map((file) => relative(source, file).split(sep).join("/"))
    .filter(
      (file) =>
        file.includes("node_modules/") ||
        file.endsWith(".ts") ||
        file.endsWith(".map"),
    );
  if (forbidden.length > 0) fail(`source contains forbidden files: ${forbidden.join(", ")}`);
  const hostFiles = packageFiles.filter(
    (file) => !relative(source, file).startsWith(`runtime${sep}`),
  );
  if ((await digestTree(source, hostFiles)) !== manifest.host.assetsSha256) {
    fail("source host assets do not match their manifest");
  }
  return manifest;
}

function releaseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(value ?? "");
  return match === null
    ? null
    : match.slice(1, 4).map((part) => Number(part));
}

function older(candidate, current) {
  const left = releaseVersion(candidate);
  const right = releaseVersion(current);
  if (left === null || right === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

async function install(sourceRootValue, host, target) {
  const sourceRoot = safeAbsolute(sourceRootValue, "--source");
  const source = join(sourceRoot, host);
  const sourceManifest = await verifySource(source, host);
  const parent = dirname(target);
  const staging = join(parent, `.${basename(target)}.staging-${String(process.pid)}`);
  const backup = `${target}.rollback`;
  if (await exists(staging)) fail("a staging directory already exists");
  if (await exists(backup)) {
    fail("a rollback backup exists; commit or roll it back first");
  }
  if (await exists(target)) {
    const currentManifest = await verifySource(target, host);
    if (older(sourceManifest.pluginVersion, currentManifest.pluginVersion)) {
      fail("downgrades require rollback to the retained verified version");
    }
    if (
      sourceManifest.runtime.sourceTreeSha256 ===
        currentManifest.runtime.sourceTreeSha256 &&
      sourceManifest.host.assetsSha256 === currentManifest.host.assetsSha256
    ) {
      return sourceManifest;
    }
  }
  await mkdir(parent, { recursive: true });
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true });
    await verifySource(staging, host);
    if (await exists(target)) await rename(target, backup);
    try {
      await rename(staging, target);
    } catch (error) {
      if (await exists(backup)) await rename(backup, target);
      throw error;
    }
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
  return sourceManifest;
}

async function rollback(target, host) {
  const backup = `${target}.rollback`;
  if (!(await exists(backup))) fail("no rollback backup exists");
  await verifySource(backup, host);
  const failed = `${target}.failed`;
  if (await exists(failed)) fail("a failed-version quarantine exists");
  if (await exists(target)) await rename(target, failed);
  try {
    await rename(backup, target);
  } catch (error) {
    if (await exists(failed)) await rename(failed, target);
    throw error;
  }
}

async function commit(target) {
  const backup = `${target}.rollback`;
  if (!(await exists(backup))) fail("no rollback backup exists");
  await rm(backup, { recursive: true });
}

async function uninstall(target) {
  if (!(await exists(target))) fail("the installed target does not exist");
  const removed = `${target}.uninstalled`;
  if (await exists(removed)) fail("an uninstall quarantine already exists");
  await rename(target, removed);
}

const command = process.argv[2];
const host = hostOption();
const target = safeAbsolute(option("--target"), "--target");
let manifest = null;
switch (command) {
  case "install":
  case "update":
    manifest = await install(option("--source"), host, target);
    break;
  case "rollback":
    await rollback(target, host);
    break;
  case "commit":
    await commit(target);
    break;
  case "uninstall":
    await uninstall(target);
    break;
  default:
    fail("expected install, update, rollback, commit, or uninstall");
}
const details = await lstat(target).catch(() => null);
process.stdout.write(
  `${JSON.stringify({
    command,
    host,
    target,
    version: manifest?.pluginVersion ?? null,
    installed: details?.isDirectory() === true,
  })}\n`,
);
