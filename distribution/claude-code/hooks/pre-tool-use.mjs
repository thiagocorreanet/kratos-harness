#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const runtimeEntry = fileURLToPath(
  new URL("../runtime/kratos.mjs", import.meta.url),
);
try {
  const [
    { runPreToolUseProcess },
    { relayClaudeCodePreToolUse, normalizeClaudeCodeHook },
  ] = await Promise.all([
    import("./pre-tool-use-runner.mjs"),
    import("../runtime/source/packages/adapters/src/index.js"),
  ]);
  runPreToolUseProcess(
    relayClaudeCodePreToolUse,
    runtimeEntry,
    "claude-code",
    normalizeClaudeCodeHook,
  );
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
