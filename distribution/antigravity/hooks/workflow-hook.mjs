#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
try {
  const [{ runWorkflowHookProcess }, { normalizeAntigravityHook }] =
    await Promise.all([
      import("./workflow-hook-runner.mjs"),
      import("../runtime/source/packages/adapters/src/index.js"),
    ]);
  runWorkflowHookProcess({
    host: "antigravity",
    kind: process.argv[2],
    normalize: normalizeAntigravityHook,
    runtimeEntry,
  });
} catch {
  // Observational hooks never block the host session.
}
process.exitCode = 0;
