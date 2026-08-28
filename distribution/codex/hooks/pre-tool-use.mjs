#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { relayCodexPreToolUse } from "../runtime/source/packages/adapters/src/codex/pre-tool-use.js";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
const execute = (request, root) => {
  const execution = spawnSync(
    process.execPath,
    [runtimeEntry, "--json", "guard", "write", "--root", root],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(request),
      maxBuffer: 1024 * 1024,
    },
  );
  return { exitCode: execution.status, stdout: execution.stdout };
};
const input = (() => {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
})();
const result = relayCodexPreToolUse(input, execute);
if (result.stdout.length > 0) process.stdout.write(result.stdout);
process.exitCode = result.hostExitCode;
