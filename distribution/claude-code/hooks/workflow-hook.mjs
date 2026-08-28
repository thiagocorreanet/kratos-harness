#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
try {
  const [{ runWorkflowHookProcess }, { normalizeClaudeCodeHook }] =
    await Promise.all([
      import("./workflow-hook-runner.mjs"),
      import("../runtime/source/packages/adapters/src/index.js"),
    ]);
  runWorkflowHookProcess({
    host: "claude-code",
    kind: process.argv[2],
    normalize: normalizeClaudeCodeHook,
    runtimeEntry,
  });
} catch {
  // Observational hooks never block the host session.
}
process.exitCode = 0;
