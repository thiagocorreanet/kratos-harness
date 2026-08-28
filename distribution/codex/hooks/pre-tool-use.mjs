#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
try {
  const [{ runPreToolUseProcess }, { relayCodexPreToolUse }] =
    await Promise.all([
      import("./pre-tool-use-runner.mjs"),
      import("../runtime/source/packages/adapters/src/codex/pre-tool-use.js"),
    ]);
  runPreToolUseProcess(relayCodexPreToolUse, runtimeEntry);
} catch {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Kratos write guard could not start its packaged relay.",
      },
    })}\n`,
  );
  process.exitCode = 0;
}
