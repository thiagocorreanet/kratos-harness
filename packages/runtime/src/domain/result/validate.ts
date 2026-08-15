import { reasonPolicy } from "@kratos/contracts";

import type { Result } from "./result.js";

export class ResultContractError extends Error {
  constructor(detail: string) {
    super(`Result contract validation failed: ${detail}`);
    this.name = "ResultContractError";
  }
}

const RESULT_KEYS = [
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
function schemaFailure(): never {
  throw new ResultContractError("result does not satisfy its closed schema");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether text carries a code point a terminal may act on rather than print.
 *
 * C0 and DEL are the obvious ones. C1 is here because a terminal reading UTF-8
 * treats U+009B as a control sequence introducer exactly as it treats
 * `ESC [`, so refusing the seven-bit spelling while publishing the eight-bit
 * one would leave the same door open under a different name.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    // A character yielded by a string iterator is never empty, so index zero
    // always exists and the optional result would be an unreachable branch.
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
    throw new ResultContractError("unsafe text is not publishable");
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

/** Validate command-owned text before it reaches either public stream. */
export function validatePublicText(text: string): string {
  for (const line of text.split("\n")) {
    if (line.length !== 0) assertSafeLine(line);
  }
  return text;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ResultContractError(`${label} must be unique`);
  }
}

function assertEvidence(evidence: readonly unknown[]): void {
  for (const item of evidence) {
    if (!isRecord(item)) schemaFailure();
    const expected =
      item.sha256 === undefined ? ["kind", "ref"] : ["kind", "ref", "sha256"];
    if (JSON.stringify(Object.keys(item)) !== JSON.stringify(expected)) {
      throw new ResultContractError(
        "evidence properties are not in canonical order",
      );
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

/** Prove a result may be published before a renderer writes any bytes. */
export function validateResult(result: Result): Result {
  const input: unknown = result;
  if (!isRecord(input)) schemaFailure();
  if (JSON.stringify(Object.keys(input)) !== JSON.stringify(RESULT_KEYS)) {
    throw new ResultContractError(
      "result properties are not in canonical order",
    );
  }
  if (
    input.contractVersion !== "1.0.0" ||
    typeof input.status !== "string" ||
    !["success", "failure", "blocked"].includes(input.status) ||
    typeof input.exitCode !== "number" ||
    !Number.isInteger(input.exitCode) ||
    input.exitCode < 0 ||
    input.exitCode > 5 ||
    typeof input.reasonCode !== "string" ||
    !reasonCodePattern.test(input.reasonCode) ||
    !Array.isArray(input.why) ||
    !Array.isArray(input.evidence) ||
    typeof input.stateChanged !== "boolean" ||
    typeof input.retryable !== "boolean" ||
    (input.recovery !== null && typeof input.recovery !== "string")
  ) {
    schemaFailure();
  }
  assertSafeLine(result.summary);
  for (const why of result.why) assertSafeLine(why);
  if (result.recovery !== null) assertSafeLine(result.recovery);
  const policy = reasonPolicy(result.reasonCode);
  if (policy === null) {
    throw new ResultContractError("result uses an unknown reason code");
  }
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
    throw new ResultContractError(
      "internal failures require fixed catalog-owned public prose",
    );
  }
  for (const property of [
    "status",
    "exitCode",
    "retryable",
    "recovery",
  ] as const) {
    if (result[property] !== policy[property]) {
      throw new ResultContractError(
        `result ${property} conflicts with its reason`,
      );
    }
  }
  if (result.stateChanged && !policy.stateChanged) {
    throw new ResultContractError("result makes a false state mutation claim");
  }
  if (policy.evidence === "required" && result.evidence.length === 0) {
    throw new ResultContractError("required evidence is absent");
  }
  if (policy.evidence === "forbidden" && result.evidence.length !== 0) {
    throw new ResultContractError("forbidden evidence is present");
  }
  if (result.status !== "success" && result.why.length === 0) {
    throw new ResultContractError(
      "a failure or blocked result requires at least one cause",
    );
  }
  assertUnique(result.why, "why entries");
  return result;
}
