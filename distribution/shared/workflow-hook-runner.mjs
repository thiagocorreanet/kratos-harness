import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  executeHostObservation,
  MAX_HOST_INPUT_BYTES,
} from "./host-operation-transport.mjs";

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
  executeHostObservation({
    root,
    host,
    kind,
    observation,
    runtimeEntry,
    spawnRuntime: spawnSync,
  });
  return true;
}

export function runWorkflowHookProcess(options) {
  try {
    if (projectRoot(process.cwd()) === null) return;
    const raw = readFileSync(0);
    if (raw.byteLength > MAX_HOST_INPUT_BYTES) return;
    relayWorkflowObservation({
      ...options,
      nativeInput: JSON.parse(raw.toString("utf8")),
    });
  } catch {
    // Observational hooks are fail-open by contract.
  }
}
