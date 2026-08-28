import {
  relayClaudeCodePreToolUse,
  relayCodexPreToolUse,
} from "@kratos/adapters";
import { rm } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, runtimeEntry } from "./support/built-plugin.js";
import {
  createPreToolRelayProject,
  nativePreToolRelayInput,
  PRE_TOOL_RELAY_CASES,
} from "./support/pre-tool-relay-cases.js";
import { createRuntimeGuardExecutor } from "./support/runtime-guard-executor.js";

beforeAll(() => {
  buildPlugin();
}, 60_000);

describe("host pre-tool operation-result parity", () => {
  for (const testCase of PRE_TOOL_RELAY_CASES) {
    const claudeCall = testCase.claudeCode;
    const codexCall = testCase.codex;
    if (claudeCall === null || codexCall === null) continue;

    it(`publishes identical complete semantics for ${testCase.name}`, async () => {
      const root = await createPreToolRelayProject(testCase);
      try {
        const claude = relayClaudeCodePreToolUse(
          nativePreToolRelayInput("claude-code", root, claudeCall),
          createRuntimeGuardExecutor(runtimeEntry("claude-code")),
        );
        const codex = relayCodexPreToolUse(
          nativePreToolRelayInput("codex", root, codexCall),
          createRuntimeGuardExecutor(runtimeEntry("codex")),
        );

        expect(claude.kind).toBe(testCase.expectedKind);
        expect(codex.kind).toBe(testCase.expectedKind);
        expect(claude.operationResult).toEqual(codex.operationResult);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });
  }
});
