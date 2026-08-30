import type { HookObservationV1, PhaseLifecycleV1 } from "@kratos/contracts";

import { normalizeClaudeCodePreToolUse } from "./claude-code/pre-tool-use.js";
import { normalizeCodexPreToolUse } from "./codex/pre-tool-use.js";
import type { NormalizedPreToolUse } from "./pre-tool-use.js";

export type HookKind = HookObservationV1["kind"] | PhaseLifecycleV1["kind"];
type NormalizedHook = HookObservationV1 | PhaseLifecycleV1;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  ...names: readonly string[]
): string {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return "unknown";
}

function requiredStringField(
  value: Readonly<Record<string, unknown>>,
  ...names: readonly string[]
): string | null {
  const candidate = stringField(value, ...names);
  return candidate === "unknown" ? null : candidate;
}

function usage(
  value: unknown,
): { readonly cumulativeGrossTokens: number } | null {
  const candidate = record(value);
  if (candidate === null) return null;
  const cumulative = candidate.cumulative_gross_tokens;
  if (Number.isSafeInteger(cumulative) && (cumulative as number) >= 0) {
    return { cumulativeGrossTokens: cumulative as number };
  }
  const input = candidate.input_tokens;
  const output = candidate.output_tokens;
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < 0 ||
    !Number.isSafeInteger(output) ||
    (output as number) < 0
  ) {
    return null;
  }
  return { cumulativeGrossTokens: (input as number) + (output as number) };
}

function toolFamily(
  name: string,
): "file" | "shell" | "mcp" | "search" | "other" {
  const normalized = name.toLowerCase();
  if (/write|edit|patch|file/u.test(normalized)) return "file";
  if (/bash|shell|exec|command/u.test(normalized)) return "shell";
  if (normalized.includes("mcp")) return "mcp";
  if (/search|find|glob|grep/u.test(normalized)) return "search";
  return "other";
}

function normalize(kind: HookKind, input: unknown): NormalizedHook | null {
  const native = record(input);
  if (native === null) return null;
  if (kind === "phase.start") {
    const sessionId = requiredStringField(native, "session_id", "sessionId");
    const correlationId = requiredStringField(
      native,
      "correlation_id",
      "correlationId",
    );
    const occurredAt = requiredStringField(
      native,
      "occurred_at",
      "occurredAt",
      "timestamp",
    );
    const assignmentDigest = requiredStringField(
      native,
      "assignment_digest",
      "assignmentDigest",
    );
    if (
      sessionId === null ||
      correlationId === null ||
      occurredAt === null ||
      assignmentDigest === null
    ) {
      return null;
    }
    return {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind,
      sessionId,
      correlationId,
      occurredAt,
      assignmentDigest,
    };
  }
  const sessionId = stringField(native, "session_id", "sessionId");
  const occurredAt = stringField(
    native,
    "occurred_at",
    "occurredAt",
    "timestamp",
  );
  const common = {
    contractVersion: "1.0.0" as const,
    hostContract: "1.0.0" as const,
    sessionId,
    occurredAt,
  };
  if (kind === "session.sample" || kind === "session.end") {
    return { ...common, kind, usage: usage(native.usage) };
  }
  if (kind === "tool.failed") {
    const exitCode = native.exit_code;
    return {
      ...common,
      kind,
      toolUseId: stringField(native, "tool_use_id", "toolUseId"),
      toolFamily: toolFamily(stringField(native, "tool_name", "toolName")),
      failureClass:
        Number.isSafeInteger(exitCode) && (exitCode as number) !== 0
          ? "nonzero_exit"
          : "tool_error",
      exitCode:
        Number.isSafeInteger(exitCode) &&
        (exitCode as number) >= 0 &&
        (exitCode as number) <= 255
          ? (exitCode as number)
          : null,
      diagnostic: stringField(native, "error", "diagnostic"),
      usage: usage(native.usage),
    };
  }
  return null;
}

function before(
  input: unknown,
  normalized: NormalizedPreToolUse,
): HookObservationV1 | null {
  if (normalized.kind !== "guard") return null;
  const request = record(normalized.request);
  if (!Array.isArray(request?.mutations) || request.mutations.length === 0) {
    return null;
  }
  const native = record(input);
  if (native === null) return null;
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    kind: "tool.before",
    sessionId: stringField(native, "session_id", "sessionId"),
    occurredAt: stringField(native, "occurred_at", "occurredAt", "timestamp"),
    toolUseId: stringField(native, "tool_use_id", "toolUseId"),
    mutations: request.mutations as Extract<
      HookObservationV1,
      { readonly kind: "tool.before" }
    >["mutations"],
  };
}

export function normalizeClaudeCodeHook(
  kind: HookKind,
  input: unknown,
): NormalizedHook | null {
  return kind === "tool.before"
    ? before(input, normalizeClaudeCodePreToolUse(input))
    : normalize(kind, input);
}

export function normalizeCodexHook(
  kind: HookKind,
  input: unknown,
): NormalizedHook | null {
  return kind === "tool.before"
    ? before(input, normalizeCodexPreToolUse(input))
    : normalize(kind, input);
}
