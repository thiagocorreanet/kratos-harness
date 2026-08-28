#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
try {
  const [{ runWorkflowHookProcess }, { normalizeCodexHook }] =
    await Promise.all([
      import("./workflow-hook-runner.mjs"),
      import("../runtime/source/packages/adapters/src/index.js"),
    ]);
  runWorkflowHookProcess({
    host: "codex",
    kind: process.argv[2],
    normalize: normalizeCodexHook,
    runtimeEntry,
  });
} catch {}
process.exitCode = 0;
