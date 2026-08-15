import { createHash } from "node:crypto";

import type { DifferentialObservation, NormalizationRule } from "./types.ts";

function decodePointer(pointer: string): string[] {
  if (!pointer.startsWith("/") || pointer === "/") {
    throw new Error("Differential normalization pointer is invalid");
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fields of the universal result contract that decide an outcome. Rewriting one
 * at any depth of a captured artifact would normalize away the very difference
 * the harness exists to detect.
 */
const decisionFields = new Set([
  "status",
  "exitCode",
  "reasonCode",
  "stateChanged",
  "retryable",
]);

/**
 * Protection is prefix-symmetric: a rule is rejected both when it targets a
 * protected field and when it targets an ancestor of one, because removing the
 * ancestor removes the protected field with it.
 */
function isProtected(pointer: string): boolean {
  // The only normalizable parts of a stream are the disclosed content bodies.
  if (
    pointer === "/process/stdout/content" ||
    pointer === "/process/stderr/content"
  ) {
    return false;
  }
  for (const root of ["/process", "/filesystem", "/git"]) {
    if (
      pointer === root ||
      pointer.startsWith(`${root}/`) ||
      root.startsWith(`${pointer}/`)
    ) {
      return true;
    }
  }
  const structured = /^\/structured(?:\/(\d+)(?:\/(.*))?)?$/u.exec(pointer);
  if (structured === null) return false;
  const rest = structured[2];
  // `/structured`, `/structured/N`, and `/structured/N/value` are all ancestors
  // of a decision field.
  if (rest === undefined) return true;
  const segments = rest.split("/");
  if (segments[0] !== "value") return true;
  return (
    segments.length === 1 ||
    segments.slice(1).some((s) => decisionFields.has(s))
  );
}

function locateParent(
  root: unknown,
  pointer: string,
): { parent: Record<string, unknown> | unknown[]; key: string } {
  const segments = decodePointer(pointer);
  const key = segments.pop();
  if (key === undefined) {
    throw new Error("Differential normalization pointer is invalid");
  }
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (String(index) !== segment || current[index] === undefined) {
        throw new Error("Differential normalization pointer does not exist");
      }
      current = current[index];
    } else if (isRecord(current) && segment in current) {
      current = current[segment];
    } else {
      throw new Error("Differential normalization pointer does not exist");
    }
  }
  if (!Array.isArray(current) && !isRecord(current)) {
    throw new Error("Differential normalization pointer does not exist");
  }
  return { parent: current, key };
}

function readValue(
  parent: Record<string, unknown> | unknown[],
  key: string,
): unknown {
  if (Array.isArray(parent)) {
    const index = Number.parseInt(key, 10);
    if (String(index) !== key || parent[index] === undefined) {
      throw new Error("Differential normalization pointer does not exist");
    }
    return parent[index];
  }
  if (!(key in parent)) {
    throw new Error("Differential normalization pointer does not exist");
  }
  return parent[key];
}

function writeValue(
  parent: Record<string, unknown> | unknown[],
  key: string,
  value: unknown,
): void {
  if (Array.isArray(parent)) {
    const index = Number.parseInt(key, 10);
    parent[index] = value;
  } else {
    parent[key] = value;
  }
}

function identity(value: unknown, key: string): string {
  if (!isRecord(value) || !(key in value)) {
    throw new Error("Differential normalization sort identity is missing");
  }
  const candidate = value[key];
  if (typeof candidate !== "string" && typeof candidate !== "number") {
    throw new Error("Differential normalization sort identity is invalid");
  }
  return `${typeof candidate}:${String(candidate)}`;
}

/**
 * Keep a stream's `bytes` and `sha256` describing the content they accompany
 * after that content is normalized.
 */
function resynchronizeStream(
  parent: Record<string, unknown> | unknown[],
  key: string,
): void {
  if (key !== "content" || Array.isArray(parent)) return;
  const content = parent[key];
  if (typeof content !== "string") return;
  parent.bytes = Buffer.byteLength(content);
  parent.sha256 = createHash("sha256").update(content).digest("hex");
}

/**
 * A rule that reaches into an artifact a side never produced is skipped, so the
 * missing artifact is reported as the behavioral difference it is instead of
 * failing the whole run. A missing pointer inside a `valid` artifact remains an
 * error, so a mistyped rule is still caught.
 */
function targetsAbsentArtifact(
  observation: DifferentialObservation,
  pointer: string,
): boolean {
  const match = /^\/structured\/(\d+)\/value(?:\/|$)/u.exec(pointer);
  if (match?.[1] === undefined) return false;
  return observation.structured[Number(match[1])]?.state !== "valid";
}

export function normalizeObservation(
  observation: DifferentialObservation,
  rules: readonly NormalizationRule[],
  workspace: string,
): DifferentialObservation {
  const normalized = structuredClone(observation);
  for (const rule of rules) {
    if (isProtected(rule.pointer)) {
      throw new Error("Differential normalization targets a protected field");
    }
    if (targetsAbsentArtifact(normalized, rule.pointer)) continue;
    const { parent, key } = locateParent(normalized, rule.pointer);
    const value = readValue(parent, key);
    switch (rule.operation) {
      case "line_endings": {
        if (typeof value !== "string") {
          throw new Error("Differential normalization requires a string");
        }
        writeValue(parent, key, value.replaceAll("\r\n", "\n"));
        resynchronizeStream(parent, key);
        break;
      }
      case "workspace_path": {
        if (typeof value !== "string" || workspace.length === 0) {
          throw new Error(
            "Differential normalization requires a workspace string",
          );
        }
        writeValue(parent, key, value.replaceAll(workspace, "<WORKSPACE>"));
        resynchronizeStream(parent, key);
        break;
      }
      case "replace_json_value": {
        writeValue(parent, key, rule.token);
        break;
      }
      case "sort_json_array": {
        if (!Array.isArray(value)) {
          throw new Error("Differential normalization requires an array");
        }
        value.sort((left, right) =>
          identity(left, rule.identityKey).localeCompare(
            identity(right, rule.identityKey),
            "en-US",
          ),
        );
        break;
      }
      case "remove_field": {
        if (Array.isArray(parent)) {
          throw new Error(
            "Differential normalization cannot remove array items",
          );
        }
        Reflect.deleteProperty(parent, key);
        break;
      }
    }
  }
  return normalized;
}
