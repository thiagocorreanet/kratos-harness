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

const mutationTools = new Set(["write_to_file", "replace_file_content"]);

function absolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    (value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(value))
  );
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function writePayload(input: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof input.CodeContent === "string" &&
    typeof input.Description === "string" &&
    optionalBoolean(input.Overwrite)
  );
}

function replacePayload(input: Readonly<Record<string, unknown>>): boolean {
  const startLine = input.StartLine;
  const endLine = input.EndLine;
  return (
    typeof input.TargetContent === "string" &&
    typeof input.ReplacementContent === "string" &&
    typeof input.Instruction === "string" &&
    typeof input.Description === "string" &&
    Number.isSafeInteger(startLine) &&
    (startLine as number) >= 1 &&
    Number.isSafeInteger(endLine) &&
    (endLine as number) >= (startLine as number) &&
    optionalBoolean(input.AllowMultiple)
  );
}

function parseMutation(
  toolName: string,
  value: unknown,
): PreToolUseV1["mutations"][number] | null {
  const input = record(value);
  if (input === null || !absolutePath(input.TargetFile)) return null;
  const path = input.TargetFile;

  if (toolName === "write_to_file") {
    if (!writePayload(input)) return null;
    return {
      kind: input.Overwrite === true ? "update" : "create",
      path,
    };
  }

  if (toolName === "replace_file_content") {
    if (!replacePayload(input)) return null;
    return {
      kind: "update",
      path,
    };
  }

  return null;
}

export function normalizeAntigravityPreToolUse(
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
  const mutation = parseMutation(toolName, native?.tool_input);
  if (mutation === null) {
    return { kind: "guard", request: uninspectablePreToolRequest() };
  }
  return { kind: "guard", request: preToolRequest([mutation]) };
}

export function relayAntigravityPreToolUse(
  input: unknown,
  execute: GuardExecutor,
): PreToolRelayResult {
  return relayPreToolUse(input, normalizeAntigravityPreToolUse(input), execute);
}
