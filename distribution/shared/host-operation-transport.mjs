import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export const MAX_HOST_INPUT_BYTES = 1024 * 1024;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function contained(root, path) {
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Stage one digest-pinned artifact without allowing session path traversal. */
export function stageHostObservation({ root, host, kind, observation }) {
  const project = realpathSync(root);
  const brain = lstatSync(join(project, ".brain"));
  if (!brain.isDirectory() || brain.isSymbolicLink()) {
    throw new Error("The project state root is unavailable");
  }
  if (
    typeof observation.sessionId !== "string" ||
    observation.sessionId.length === 0
  ) {
    throw new Error("The host session identity is unavailable");
  }
  const content = `${JSON.stringify(observation, null, 2)}\n`;
  const digest = sha256(content);
  const session = observation.sessionId.replace(/[^a-zA-Z0-9._:-]/gu, "-");
  const requestedCache = join(project, ".brain/03-memory/.cache/hooks");
  mkdirSync(requestedCache, { recursive: true, mode: 0o700 });
  const cache = realpathSync(requestedCache);
  if (!contained(project, cache)) {
    throw new Error("The hooks cache escapes the project");
  }
  const requestedDirectory = join(cache, session);
  mkdirSync(requestedDirectory, { recursive: true, mode: 0o700 });
  const directory = realpathSync(requestedDirectory);
  if (!contained(cache, directory)) {
    throw new Error("The host artifact directory escapes the hooks cache");
  }
  const artifactPath = join(directory, `${kind}-${digest.slice(0, 16)}.json`);
  try {
    writeFileSync(artifactPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (
      error?.code !== "EEXIST" ||
      readFileSync(artifactPath, "utf8") !== content
    ) {
      throw error;
    }
  }
  const id = digest.slice(0, 24);
  const correlationId =
    kind === "phase.start"
      ? observation.correlationId
      : `session-${sha256(observation.sessionId).slice(0, 24)}`;
  return {
    content,
    message: {
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
          ref: relative(project, artifactPath).replaceAll("\\", "/"),
          sha256: digest,
        },
      },
    },
  };
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
      input: JSON.stringify(staged.message),
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
