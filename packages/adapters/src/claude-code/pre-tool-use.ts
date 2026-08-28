import type { PreToolUseV1 } from "@kratos/contracts";

import {
  preToolRequest,
  record,
  relayPreToolUse,
  uninspectablePreToolRequest,
  type GuardExecutor,
  type NormalizedPreToolUse,
  type PreToolRelayResult,
} from "../pre-tool-use.js";

const mutationTools = new Set(["Write", "Edit", "MultiEdit"]);

export function normalizeClaudeCodePreToolUse(
  input: unknown,
): NormalizedPreToolUse {
  const native = record(input);
  const toolName = native?.tool_name;
  if (typeof toolName === "string" && !mutationTools.has(toolName)) {
    return { kind: "pass" };
  }
  if (typeof toolName !== "string" || !mutationTools.has(toolName)) {
    return { kind: "guard", request: uninspectablePreToolRequest() };
  }
  const path = record(native?.tool_input)?.file_path;
  if (typeof path !== "string" || path.length === 0) {
    return { kind: "guard", request: uninspectablePreToolRequest() };
  }
  const mutation: PreToolUseV1["mutations"][number] = {
    kind: toolName === "Write" ? "create" : "update",
    path,
  };
  return { kind: "guard", request: preToolRequest([mutation]) };
}

export function relayClaudeCodePreToolUse(
  input: unknown,
  execute: GuardExecutor,
): PreToolRelayResult {
  return relayPreToolUse(input, normalizeClaudeCodePreToolUse(input), execute);
}
