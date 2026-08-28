import {
  validateOperationResult,
  type OperationResultV1,
  type PreToolUseV1,
} from "@kratos/contracts";

export type GuardOperationResult = OperationResultV1;

export interface GuardExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
}

export type GuardExecutor = (
  request: unknown,
  projectRoot: string,
) => GuardExecution;

export type PreToolRelayResult =
  | {
      readonly kind: "pass";
      readonly guardRequest: null;
      readonly operationResult: null;
      readonly stdout: "";
      readonly hostExitCode: 0;
    }
  | {
      readonly kind: "allow";
      readonly guardRequest: unknown;
      readonly operationResult: GuardOperationResult;
      readonly stdout: "";
      readonly hostExitCode: 0;
    }
  | {
      readonly kind: "deny";
      readonly guardRequest: unknown;
      readonly operationResult: GuardOperationResult | null;
      readonly stdout: string;
      readonly hostExitCode: 0;
    };

export type NormalizedPreToolUse =
  | { readonly kind: "pass" }
  | { readonly kind: "guard"; readonly request: unknown };

const invalidRequest = Object.freeze({
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  mutations: Object.freeze([]),
});

export function preToolRequest(
  mutations: PreToolUseV1["mutations"],
): PreToolUseV1 {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    mutations,
  };
}

export function uninspectablePreToolRequest(): unknown {
  return invalidRequest;
}

export function record(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function operationResult(value: unknown): GuardOperationResult | null {
  try {
    return validateOperationResult(value);
  } catch {
    return null;
  }
}

function denial(reason: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })}\n`;
}

function absoluteNativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(value)
  );
}

function projectRoot(input: unknown): string | null {
  const cwd = record(input)?.cwd;
  return absoluteNativePath(cwd) ? cwd : null;
}

export function relayPreToolUse(
  input: unknown,
  normalized: NormalizedPreToolUse,
  execute: GuardExecutor,
): PreToolRelayResult {
  if (normalized.kind === "pass") {
    return {
      kind: "pass",
      guardRequest: null,
      operationResult: null,
      stdout: "",
      hostExitCode: 0,
    };
  }

  const root = projectRoot(input);
  if (root === null) {
    return {
      kind: "deny",
      guardRequest: normalized.request,
      operationResult: null,
      stdout: denial(
        "Kratos write guard did not return a valid operation result.",
      ),
      hostExitCode: 0,
    };
  }

  let execution: GuardExecution;
  try {
    execution = execute(normalized.request, root);
  } catch {
    return {
      kind: "deny",
      guardRequest: normalized.request,
      operationResult: null,
      stdout: denial(
        "Kratos write guard did not return a valid operation result.",
      ),
      hostExitCode: 0,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(execution.stdout) as unknown;
  } catch {
    parsed = null;
  }
  const result = operationResult(parsed);
  if (execution.exitCode !== result?.exitCode) {
    return {
      kind: "deny",
      guardRequest: normalized.request,
      operationResult: null,
      stdout: denial(
        "Kratos write guard did not return a valid operation result.",
      ),
      hostExitCode: 0,
    };
  }
  if (result.status === "success" && result.exitCode === 0) {
    return {
      kind: "allow",
      guardRequest: normalized.request,
      operationResult: result,
      stdout: "",
      hostExitCode: 0,
    };
  }
  return {
    kind: "deny",
    guardRequest: normalized.request,
    operationResult: result,
    stdout: denial(JSON.stringify(result)),
    hostExitCode: 0,
  };
}
