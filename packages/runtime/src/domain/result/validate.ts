import { reasonPolicy } from "@mestre-yoda/contracts";

import type { EvidenceRef, Result } from "./result.js";

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

function assertSafe(text: string): void {
  let hasControlCharacter = false;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 31 || code === 127)) {
      hasControlCharacter = true;
      break;
    }
  }
  if (hasControlCharacter || unsafe.some((pattern) => pattern.test(text))) {
    throw new ResultContractError("unsafe text is not publishable");
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ResultContractError(`${label} must be unique`);
  }
}

function assertEvidence(evidence: readonly EvidenceRef[]): void {
  for (const item of evidence) {
    const expected =
      item.sha256 === undefined ? ["kind", "ref"] : ["kind", "ref", "sha256"];
    if (JSON.stringify(Object.keys(item)) !== JSON.stringify(expected)) {
      throw new ResultContractError(
        "evidence properties are not in canonical order",
      );
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
  if (JSON.stringify(Object.keys(result)) !== JSON.stringify(RESULT_KEYS)) {
    throw new ResultContractError(
      "result properties are not in canonical order",
    );
  }
  const policy = reasonPolicy(result.reasonCode);
  if (policy === null) {
    throw new ResultContractError("result uses an unknown reason code");
  }
  assertSafe(result.summary);
  for (const why of result.why) assertSafe(why);
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
  if (!policy.stateChanged && result.stateChanged) {
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
