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

function absolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    (value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(value))
  );
}

function optionalReplaceAll(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function editPayload(value: unknown): boolean {
  const edit = record(value);
  return (
    edit !== null &&
    typeof edit.old_string === "string" &&
    typeof edit.new_string === "string" &&
    optionalReplaceAll(edit.replace_all)
  );
}

function completePayload(toolName: string, value: unknown): string | null {
  const input = record(value);
  if (input === null || !absolutePath(input.file_path)) return null;
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.file_path : null;
  }
  if (toolName === "Edit") {
    return editPayload(input) ? input.file_path : null;
  }
  if (toolName === "MultiEdit") {
    return Array.isArray(input.edits) &&
      input.edits.length > 0 &&
      input.edits.every((edit) => editPayload(edit))
      ? input.file_path
      : null;
  }
  return null;
}

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
  const path = completePayload(toolName, native?.tool_input);
  if (path === null) {
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
