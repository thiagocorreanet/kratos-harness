import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MAX_HOST_INPUT_BYTES = 1024 * 1024;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const HOST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function missing(error) {
  return error?.code === "ENOENT";
}

function optionalLstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function sameDirectory(left, right) {
  return (
    left.isDirectory() &&
    !left.isSymbolicLink() &&
    right.isDirectory() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function captureProject(root) {
  const before = lstatSync(root);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("The project root is not a real directory");
  }
  const path = realpathSync(root);
  const resolved = lstatSync(path);
  const after = lstatSync(root);
  if (!sameDirectory(before, resolved) || !sameDirectory(before, after)) {
    throw new Error("The project root changed during host staging");
  }
  return { path, device: before.dev, inode: before.ino };
}

function validateProject(project) {
  const details = lstatSync(project.path);
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    details.dev !== project.device ||
    details.ino !== project.inode ||
    realpathSync(project.path) !== project.path
  ) {
    throw new Error("The project root changed during host staging");
  }
}

/** Inspect every existing segment twice so no symlink is followed to mutate. */
function scanDirectories(project, segments) {
  validateProject(project);
  let absolute = project.path;
  const observed = [];
  let missingAt = null;
  for (const [index, segment] of segments.entries()) {
    absolute = join(absolute, segment);
    const details = optionalLstat(absolute);
    if (details === null) {
      missingAt = index;
      break;
    }
    if (details.isSymbolicLink()) {
      throw new Error("The host artifact path contains a symlink");
    }
    if (!details.isDirectory()) {
      throw new Error("The host artifact path ancestor is not a directory");
    }
    observed.push({ path: absolute, details });
  }
  for (const entry of observed) {
    const current = lstatSync(entry.path);
    if (!sameDirectory(entry.details, current)) {
      throw new Error("The host artifact path changed during staging");
    }
  }
  validateProject(project);
  return { absolute, missingAt };
}

function ensureDirectories(project, segments) {
  // The complete read-only scan is deliberately before the first mkdir.
  const initial = scanDirectories(project, segments);
  if (initial.missingAt === 0) {
    throw new Error("The project state root is unavailable");
  }
  for (const [index] of segments.entries()) {
    const prefix = segments.slice(0, index + 1);
    const scanned = scanDirectories(project, prefix);
    if (scanned.missingAt === null) continue;
    if (scanned.missingAt !== index) {
      throw new Error("The host artifact path has no inspected parent");
    }
    mkdirSync(scanned.absolute, { mode: 0o700 });
    const created = scanDirectories(project, prefix);
    if (created.missingAt !== null) {
      throw new Error("The host artifact directory was not created");
    }
  }
  const complete = scanDirectories(project, segments);
  if (complete.missingAt !== null) {
    throw new Error("The host artifact directory is unavailable");
  }
  return complete.absolute;
}

function readExistingArtifact(path, details) {
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error("The host artifact path is not a regular file");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== details.dev ||
      opened.ino !== details.ino
    ) {
      throw new Error("The host artifact changed during staging");
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function writeArtifactExclusive(path, content) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Stage one digest-pinned artifact without allowing session path traversal. */
export function stageHostObservation({ root, host, kind, observation }) {
  if (
    typeof observation.sessionId !== "string" ||
    !HOST_ID.test(observation.sessionId)
  ) {
    throw new Error("The host session identity is unavailable");
  }
  const content = `${JSON.stringify(observation, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_HOST_INPUT_BYTES) {
    throw new Error("The host artifact exceeds the input limit");
  }
  const digest = sha256(content);
  const directorySegments = [
    ".brain",
    "03-memory",
    ".cache",
    "hooks",
    observation.sessionId,
  ];
  const artifactName = `${kind}-${digest.slice(0, 16)}.json`;
  const artifactRef = [...directorySegments, artifactName].join("/");
  const id = digest.slice(0, 24);
  const correlationId =
    kind === "phase.start"
      ? observation.correlationId
      : `session-${sha256(observation.sessionId).slice(0, 24)}`;
  const message = {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: `hook-${id}`,
    correlationId,
    operationId: `hook-${id}`,
    sequence: 0,
    occurredAt: observation.occurredAt,
    kind: "hook",
    payload: {
      host,
      hook: kind,
      phase:
        kind === "tool.before" || kind === "phase.start" ? "before" : "after",
      artifact: {
        ref: artifactRef,
        sha256: digest,
      },
    },
  };
  const input = JSON.stringify(message);
  if (Buffer.byteLength(input, "utf8") > MAX_HOST_INPUT_BYTES) {
    throw new Error("The host operation message exceeds the input limit");
  }

  const project = captureProject(root);
  const directory = ensureDirectories(project, directorySegments);
  const artifactPath = join(directory, artifactName);
  const existing = optionalLstat(artifactPath);
  if (existing === null) {
    writeArtifactExclusive(artifactPath, content);
  } else if (readExistingArtifact(artifactPath, existing) !== content) {
    throw new Error("The existing host artifact has different bytes");
  }
  scanDirectories(project, directorySegments);
  return { content, input, message };
}

/** Stage and send one valid host.operation-message through hook ingress. */
export function executeHostObservation({
  root,
  host,
  kind,
  observation,
  runtimeEntry,
  spawnRuntime,
}) {
  const staged = stageHostObservation({ root, host, kind, observation });
  const result = spawnRuntime(
    process.execPath,
    [runtimeEntry, "--json", "hook", "--host", host, "--root", root],
    {
      cwd: root,
      encoding: "utf8",
      input: staged.input,
      killSignal: "SIGKILL",
      maxBuffer: MAX_HOST_INPUT_BYTES,
      timeout: 20_000,
    },
  );
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}
