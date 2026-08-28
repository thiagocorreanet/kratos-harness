import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const MAX_INPUT_BYTES = 1024 * 1024;

function projectRoot(start) {
  let cursor = realpathSync(start);
  for (;;) {
    try {
      const marker = lstatSync(join(cursor, ".brain"));
      if (marker.isDirectory() && !marker.isSymbolicLink()) return cursor;
    } catch {
      // Absence is the ordinary no-state case while walking ancestors.
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function relayWorkflowObservation({
  host,
  kind,
  normalize,
  runtimeEntry,
  nativeInput,
}) {
  const root = projectRoot(process.cwd());
  if (root === null) return false;
  const observation = normalize(kind, nativeInput);
  if (observation === null) return false;
  const content = `${JSON.stringify(observation, null, 2)}\n`;
  const digest = sha256(content);
  const session = observation.sessionId.replace(/[^a-zA-Z0-9._:-]/gu, "-");
  const directory = join(root, ".brain/03-memory/.cache/hooks", session);
  mkdirSync(directory, { recursive: true });
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
    )
      return false;
  }
  const id = digest.slice(0, 24);
  const message = {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: `hook-${id}`,
    correlationId: `session-${sha256(observation.sessionId).slice(0, 24)}`,
    operationId: `hook-${id}`,
    sequence: 0,
    occurredAt: observation.occurredAt,
    kind: "hook",
    payload: {
      host,
      hook: kind,
      phase: kind === "tool.before" ? "before" : "after",
      artifact: {
        ref: relative(root, artifactPath).replaceAll("\\", "/"),
        sha256: digest,
      },
    },
  };
  spawnSync(
    process.execPath,
    [runtimeEntry, "--json", "hook", "--host", host, "--root", root],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(message),
      killSignal: "SIGKILL",
      maxBuffer: MAX_INPUT_BYTES,
      timeout: 20_000,
    },
  );
  return true;
}

export function runWorkflowHookProcess(options) {
  try {
    if (projectRoot(process.cwd()) === null) return;
    const raw = readFileSync(0);
    if (raw.byteLength > MAX_INPUT_BYTES) return;
    relayWorkflowObservation({
      ...options,
      nativeInput: JSON.parse(raw.toString("utf8")),
    });
  } catch {
    // Observational hooks are fail-open by contract.
  }
}
