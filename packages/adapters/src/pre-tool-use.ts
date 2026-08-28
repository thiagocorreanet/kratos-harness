import type { PreToolUseV1 } from "@kratos/contracts";

export interface GuardOperationResult {
  readonly contractVersion: "1.0.0";
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly reasonCode: string;
  readonly summary: string;
  readonly why: readonly string[];
  readonly evidence: readonly {
    readonly kind: string;
    readonly ref: string;
    readonly sha256?: string;
  }[];
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

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

function strings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function evidence(value: unknown): value is GuardOperationResult["evidence"] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      const item = record(entry);
      return (
        item !== null &&
        typeof item.kind === "string" &&
        typeof item.ref === "string" &&
        (item.sha256 === undefined || typeof item.sha256 === "string")
      );
    })
  );
}

function operationResult(value: unknown): GuardOperationResult | null {
  const candidate = record(value);
  if (candidate === null) return null;
  if (
    candidate.contractVersion !== "1.0.0" ||
    (candidate.status !== "success" &&
      candidate.status !== "failure" &&
      candidate.status !== "blocked") ||
    typeof candidate.exitCode !== "number" ||
    !Number.isInteger(candidate.exitCode) ||
    typeof candidate.reasonCode !== "string" ||
    typeof candidate.summary !== "string" ||
    !strings(candidate.why) ||
    !evidence(candidate.evidence) ||
    typeof candidate.stateChanged !== "boolean" ||
    typeof candidate.retryable !== "boolean" ||
    (candidate.recovery !== null && typeof candidate.recovery !== "string")
  ) {
    return null;
  }
  return candidate as unknown as GuardOperationResult;
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

function projectRoot(input: unknown): string {
  const cwd = record(input)?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : ".";
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

  const execution = execute(normalized.request, projectRoot(input));
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
