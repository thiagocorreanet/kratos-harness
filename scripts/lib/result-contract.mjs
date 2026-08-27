import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const CONTRACT_VERSION = "1.0.0";
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
const REASON_KEYS = [
  "code",
  "description",
  "status",
  "exitCode",
  "evidence",
  "stateChanged",
  "retryable",
  "recovery",
];
const EVIDENCE_KEYS = ["kind", "ref", "sha256"];
const RUNTIME_CODES = [
  "runtime.internal_failure",
  "runtime.lease_conflict",
  "runtime.recovery_required",
  "runtime.revision_conflict",
  "runtime.state_corrupt",
];
const INTERNAL_FAILURE_SUMMARY =
  "The operation stopped after an unexpected internal failure.";
const INTERNAL_FAILURE_WHY = [
  "A sanitized runtime boundary caught an unexpected condition.",
];
const repositoryRoot = dirname(
  fileURLToPath(new URL("../../package.json", import.meta.url)),
);

function validationFailure(detail) {
  return new Error(`Result contract validation failed: ${detail}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadResultContract(paths) {
  const names = (await readdir(paths.examplesPath))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const [resultSchema, catalogSchema, catalog, discovery, examples] =
    await Promise.all([
      readJson(paths.resultSchemaPath),
      readJson(paths.catalogSchemaPath),
      readJson(paths.catalogPath),
      readJson(paths.discoveryPath),
      Promise.all(
        names.map((name) => readJson(join(paths.examplesPath, name))),
      ),
    ]);
  return { resultSchema, catalogSchema, catalog, discovery, examples };
}

function sameKeys(value, expected) {
  return JSON.stringify(Object.keys(value)) === JSON.stringify(expected);
}

function assertSafeStrings(value) {
  if (typeof value === "string") {
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
    const hasControlCharacter = [...value].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 31 || code === 127);
    });
    if (hasControlCharacter || unsafe.some((pattern) => pattern.test(value))) {
      throw validationFailure("unsafe text is not publishable");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeStrings(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertSafeStrings(item);
  }
}

function assertSchema(validator, value, label) {
  if (!validator(value)) {
    throw validationFailure(`${label} does not satisfy its closed schema`);
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw validationFailure(`${label} must be unique`);
  }
}

function expectedCodes(discovery) {
  const legacy = discovery?.namespaces?.reason_codes;
  if (!Array.isArray(legacy)) {
    throw validationFailure("legacy reason discovery is unavailable");
  }
  return [...legacy.map(({ name }) => name), ...RUNTIME_CODES].sort();
}

function validateCatalog(catalog, discovery) {
  if (catalog.contractVersion !== CONTRACT_VERSION) {
    throw validationFailure("catalog version is unsupported");
  }
  const codes = catalog.reasons.map(({ code }) => code);
  const expected = expectedCodes(discovery);
  if (JSON.stringify(codes) !== JSON.stringify(expected)) {
    throw validationFailure("reason codes differ from the frozen inventory");
  }
  assertUnique(codes, "reason codes");
  assertUnique(
    catalog.reasons.map(({ description }) => description),
    "reason descriptions",
  );
  assertUnique(
    catalog.reasons
      .map(({ recovery }) => recovery)
      .filter((recovery) => recovery !== null),
    "reason recoveries",
  );
  for (const reason of catalog.reasons) {
    if (!sameKeys(reason, REASON_KEYS)) {
      throw validationFailure("reason properties are not in canonical order");
    }
  }
}

function validateExamples(examples, catalog, validateResult) {
  if (examples.length !== 6) {
    throw validationFailure("exactly six exit examples are required");
  }
  const exits = examples.map(({ exitCode }) => exitCode).sort((a, b) => a - b);
  if (JSON.stringify(exits) !== JSON.stringify([0, 1, 2, 3, 4, 5])) {
    throw validationFailure("examples must cover exits 0 through 5 exactly");
  }
  const reasons = new Map(
    catalog.reasons.map((reason) => [reason.code, reason]),
  );
  for (const example of examples) {
    validateResultAgainstReason(
      example,
      reasons.get(example.reasonCode),
      validateResult,
    );
  }
}

function validateResultAgainstReason(result, reason, validateResult) {
  assertSchema(validateResult, result, "result");
  assertSafeStrings(result);
  if (!sameKeys(result, RESULT_KEYS)) {
    throw validationFailure("result properties are not in canonical order");
  }
  for (const evidence of result.evidence) {
    const expectedKeys =
      evidence.sha256 === undefined ? EVIDENCE_KEYS.slice(0, 2) : EVIDENCE_KEYS;
    if (!sameKeys(evidence, expectedKeys)) {
      throw validationFailure("evidence properties are not in canonical order");
    }
  }
  if (reason === undefined) {
    throw validationFailure("result uses an unknown reason code");
  }
  if (
    reason.code === "runtime.internal_failure" &&
    (result.summary !== INTERNAL_FAILURE_SUMMARY ||
      JSON.stringify(result.why) !== JSON.stringify(INTERNAL_FAILURE_WHY))
  ) {
    throw validationFailure(
      "internal failures require fixed catalog-owned public prose",
    );
  }
  for (const property of ["status", "exitCode", "retryable", "recovery"]) {
    if (result[property] !== reason[property]) {
      throw validationFailure(`result ${property} conflicts with its reason`);
    }
  }
  if (result.stateChanged && !reason.stateChanged) {
    throw validationFailure("result makes a false state mutation claim");
  }
  if (reason.evidence === "required" && result.evidence.length === 0) {
    throw validationFailure("required evidence is absent");
  }
  if (reason.evidence === "forbidden" && result.evidence.length !== 0) {
    throw validationFailure("forbidden evidence is present");
  }
  assertUnique(result.why, "why entries");
  assertUnique(
    result.evidence.map((item) => JSON.stringify(item)),
    "evidence entries",
  );
  return result;
}

export function validateResultContract(input) {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateResult = ajv.compile(input.resultSchema);
    const validateCatalogSchema = ajv.compile(input.catalogSchema);
    if (input.resultSchema.$id !== "https://kratos.dev/schemas/result/v1") {
      throw validationFailure("result schema identity changed");
    }
    if (
      input.catalogSchema.$id !== "https://kratos.dev/schemas/reason-catalog/v1"
    ) {
      throw validationFailure("catalog schema identity changed");
    }
    assertSchema(validateCatalogSchema, input.catalog, "reason catalog");
    assertSafeStrings(input.catalog);
    validateCatalog(input.catalog, input.discovery);
    validateExamples(input.examples, input.catalog, validateResult);
    return input;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Result contract validation failed:")
    ) {
      throw error;
    }
    throw validationFailure("contract artifacts could not be verified");
  }
}

let canonicalRendererContract;

function rendererContract() {
  if (canonicalRendererContract !== undefined) return canonicalRendererContract;
  try {
    const resultSchema = JSON.parse(
      readFileSync(
        join(repositoryRoot, "schemas/result.v1.schema.json"),
        "utf8",
      ),
    );
    const catalog = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          "packages/contracts/catalogs/reason-codes.v1.6.json",
        ),
        "utf8",
      ),
    );
    const validateResult = new Ajv2020({
      allErrors: true,
      strict: true,
    }).compile(resultSchema);
    canonicalRendererContract = {
      validateResult,
      reasons: new Map(catalog.reasons.map((reason) => [reason.code, reason])),
    };
    return canonicalRendererContract;
  } catch {
    throw validationFailure("canonical renderer contract is unavailable");
  }
}

function validateRenderableResult(result) {
  try {
    const contract = rendererContract();
    return validateResultAgainstReason(
      result,
      contract.reasons.get(result?.reasonCode),
      contract.validateResult,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Result contract validation failed:")
    ) {
      throw error;
    }
    throw validationFailure("result could not be rendered safely");
  }
}

export function canonicalResultJson(result) {
  return `${JSON.stringify(validateRenderableResult(result))}\n`;
}

export function renderHumanResult(result) {
  const validated = validateRenderableResult(result);
  if (validated.exitCode === 0) {
    return {
      stdout: `${validated.summary}\n`,
      stderr: "",
      exitCode: validated.exitCode,
    };
  }
  const lines = [
    `Summary: ${validated.summary}`,
    ...validated.why.map((why) => `Why: ${why}`),
    `Reason: ${validated.reasonCode}`,
    ...validated.evidence.map(
      (evidence) =>
        `Evidence: ${evidence.kind} ${evidence.ref}${
          evidence.sha256 === undefined ? "" : ` sha256=${evidence.sha256}`
        }`,
    ),
    `State changed: ${String(validated.stateChanged)}`,
    `Retryable: ${String(validated.retryable)}`,
    `Recovery: ${validated.recovery}`,
  ];
  return {
    stdout: "",
    stderr: `${lines.join("\n")}\n`,
    exitCode: validated.exitCode,
  };
}

export { CONTRACT_VERSION, RESULT_KEYS };
