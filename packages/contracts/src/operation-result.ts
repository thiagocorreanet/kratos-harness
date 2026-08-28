import { reasonPolicy } from "./reasons.js";

export interface OperationResultEvidenceV1 {
  readonly kind: "artifact" | "event" | "approval" | "test" | "observation";
  readonly ref: string;
  readonly sha256?: string;
}

/** The universal operation-result envelope in its canonical field order. */
export interface OperationResultV1 {
  readonly contractVersion: "1.0.0";
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly reasonCode: string;
  readonly summary: string;
  readonly why: readonly string[];
  readonly evidence: readonly OperationResultEvidenceV1[];
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

export class OperationResultContractError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "OperationResultContractError";
  }
}

const resultKeys = [
  "contractVersion",
  "status",
  "exitCode",
  "reasonCode",
  "summary",
  "why",
  "evidence",
  "stateChanged",
  "retryable",
  "recovery",
];

const unsafe = [
  /(?:^|\s)[A-Za-z]*Error:/u,
  /(?:^|\s)at\s+\S+\s*\([^)]*:\d+:\d+\)/u,
  /[a-z][a-z0-9+.-]*:\/\//iu,
  /(?:github_pat_|gh[pousr]_)/iu,
  /(?:token|secret|password)["']?\s*[:=]/iu,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]/iu,
  /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_[A-Z0-9_]+)\b["']?\s*[:=]/u,
  /\b(?:Basic|Bearer)\s+(?:[A-Za-z]{20,}|(?=\S*(?:\d|[-._~+/=]))\S+)/u,
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/u,
  /\bTraceback \(most recent call last\):/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /(?:^|[^A-Za-z0-9_.-])\/(?!\/)(?:[^\s/'")\]}]+\/)*[^\s/'")\]}]+/u,
  /(?:^|[^A-Za-z0-9_.-])[A-Za-z]:[\\/]/u,
  /\\/u,
];
const evidenceKinds = new Set([
  "artifact",
  "event",
  "approval",
  "test",
  "observation",
]);
const reasonCodePattern = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/u;

function failure(detail: string): never {
  throw new OperationResultContractError(detail);
}

function schemaFailure(): never {
  failure("result does not satisfy its closed schema");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    // A string iterator cannot yield an empty character.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const code = character.codePointAt(0)!;
    if (code <= 31 || code === 127 || (code >= 128 && code <= 159)) return true;
  }
  return false;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isSafeReference(value: string): boolean {
  return (
    codePointLength(value) >= 1 &&
    codePointLength(value) <= 1_024 &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) &&
    !/(?:github_pat_|gh[pousr]_)/iu.test(value) &&
    !hasControlCharacter(value)
  );
}

function assertSafe(text: string): void {
  if (
    hasControlCharacter(text) ||
    unsafe.some((pattern) => pattern.test(text))
  ) {
    failure("unsafe text is not publishable");
  }
}

function assertSafeLine(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    codePointLength(value) < 1 ||
    codePointLength(value) > 4_096
  ) {
    schemaFailure();
  }
  assertSafe(value);
}

export function validateOperationPublicText(text: string): string {
  for (const line of text.split("\n")) {
    if (line.length !== 0) assertSafeLine(line);
  }
  return text;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    failure(`${label} must be unique`);
  }
}

function assertEvidence(evidence: readonly unknown[]): void {
  for (const item of evidence) {
    if (!isRecord(item)) schemaFailure();
    const expected =
      item.sha256 === undefined ? ["kind", "ref"] : ["kind", "ref", "sha256"];
    if (JSON.stringify(Object.keys(item)) !== JSON.stringify(expected)) {
      failure("evidence properties are not in canonical order");
    }
    if (
      typeof item.kind !== "string" ||
      !evidenceKinds.has(item.kind) ||
      typeof item.ref !== "string" ||
      !isSafeReference(item.ref) ||
      (item.sha256 !== undefined &&
        (typeof item.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/u.test(item.sha256)))
    ) {
      schemaFailure();
    }
    assertSafe(item.ref);
  }
  assertUnique(
    evidence.map((item) => JSON.stringify(item)),
    "evidence entries",
  );
}

/** Validate the complete schema and canonical reason-policy relationships. */
export function validateOperationResult(value: unknown): OperationResultV1 {
  if (!isRecord(value)) schemaFailure();
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(resultKeys)) {
    failure("result properties are not in canonical order");
  }
  if (
    value.contractVersion !== "1.0.0" ||
    typeof value.status !== "string" ||
    !["success", "failure", "blocked"].includes(value.status) ||
    typeof value.exitCode !== "number" ||
    !Number.isInteger(value.exitCode) ||
    value.exitCode < 0 ||
    value.exitCode > 5 ||
    typeof value.reasonCode !== "string" ||
    !reasonCodePattern.test(value.reasonCode) ||
    !Array.isArray(value.why) ||
    !Array.isArray(value.evidence) ||
    typeof value.stateChanged !== "boolean" ||
    typeof value.retryable !== "boolean" ||
    (value.recovery !== null && typeof value.recovery !== "string")
  ) {
    schemaFailure();
  }

  const result = value as unknown as OperationResultV1;
  assertSafeLine(result.summary);
  for (const why of result.why) assertSafeLine(why);
  if (result.recovery !== null) assertSafeLine(result.recovery);
  const policy = reasonPolicy(result.reasonCode);
  if (policy === null) failure("result uses an unknown reason code");
  assertEvidence(result.evidence);
  if (
    result.reasonCode === "runtime.internal_failure" &&
    (result.summary !==
      "The operation stopped after an unexpected internal failure." ||
      JSON.stringify(result.why) !==
        JSON.stringify([
          "A sanitized runtime boundary caught an unexpected condition.",
        ]))
  ) {
    failure("internal failures require fixed catalog-owned public prose");
  }
  for (const property of [
    "status",
    "exitCode",
    "retryable",
    "recovery",
  ] as const) {
    if (result[property] !== policy[property]) {
      failure(`result ${property} conflicts with its reason`);
    }
  }
  if (result.stateChanged && !policy.stateChanged) {
    failure("result makes a false state mutation claim");
  }
  if (policy.evidence === "required" && result.evidence.length === 0) {
    failure("required evidence is absent");
  }
  if (policy.evidence === "forbidden" && result.evidence.length !== 0) {
    failure("forbidden evidence is present");
  }
  if (result.status !== "success" && result.why.length === 0) {
    failure("a failure or blocked result requires at least one cause");
  }
  assertUnique(result.why, "why entries");
  return result;
}
