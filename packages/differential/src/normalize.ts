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

function isProtected(pointer: string): boolean {
  return (
    pointer === "/process/exitCode" ||
    pointer === "/process/outcome" ||
    pointer === "/filesystem" ||
    pointer.startsWith("/filesystem/") ||
    pointer === "/git" ||
    pointer.startsWith("/git/") ||
    /^\/structured\/\d+\/value\/(?:status|exitCode|reasonCode)(?:\/|$)/u.test(
      pointer,
    )
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
    const { parent, key } = locateParent(normalized, rule.pointer);
    const value = readValue(parent, key);
    switch (rule.operation) {
      case "line_endings": {
        if (typeof value !== "string") {
          throw new Error("Differential normalization requires a string");
        }
        writeValue(parent, key, value.replaceAll("\r\n", "\n"));
        break;
      }
      case "workspace_path": {
        if (typeof value !== "string" || workspace.length === 0) {
          throw new Error(
            "Differential normalization requires a workspace string",
          );
        }
        writeValue(parent, key, value.replaceAll(workspace, "<WORKSPACE>"));
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
