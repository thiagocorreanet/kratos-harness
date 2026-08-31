export type CanonicalPathReason =
  "guard.path_escape" | "guard.target_uninspectable";

export type CanonicalPathResult =
  | {
      readonly kind: "canonical";
      readonly path: string;
    }
  | {
      readonly kind: "refused";
      readonly reasonCode: CanonicalPathReason;
      readonly resolvedPath: string;
    };

export interface CanonicalizeOptions {
  /** The project root directory when resolving absolute paths. */
  readonly root?: string;
}

const driveLetterPattern = /^[A-Za-z]:/u;
const urlSchemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Pure lexical path canonicalization.
 *
 * Reduces a candidate path to a project-relative, slash-separated canonical
 * form without touching the filesystem or consulting `process.cwd()`.
 */
export function canonicalizeProjectPath(
  target: string,
  options?: CanonicalizeOptions,
): CanonicalPathResult {
  if (target.length === 0) {
    return {
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      resolvedPath: "",
    };
  }

  if (target.includes("\\") || hasControlCharacter(target)) {
    return {
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      resolvedPath: target,
    };
  }

  if (driveLetterPattern.test(target) || urlSchemePattern.test(target)) {
    return {
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: target,
    };
  }

  if (target.startsWith("/")) {
    if (options?.root === undefined) {
      return {
        kind: "refused",
        reasonCode: "guard.path_escape",
        resolvedPath: target,
      };
    }

    const normalizedRoot = normalizeAbsoluteSegments(options.root);
    const normalizedTarget = normalizeAbsoluteSegments(target);

    if (normalizedTarget === normalizedRoot) {
      return { kind: "canonical", path: "" };
    }

    const rootPrefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
    if (!normalizedTarget.startsWith(rootPrefix)) {
      return {
        kind: "refused",
        reasonCode: "guard.path_escape",
        resolvedPath: normalizedTarget,
      };
    }

    const relativePart = normalizedTarget.slice(rootPrefix.length);
    return { kind: "canonical", path: relativePart };
  }

  const segments = target.split("/");
  const stack: string[] = [];
  let escapedParents = 0;

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        escapedParents += 1;
      } else {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }

  if (escapedParents > 0) {
    const parentPrefix = Array.from(
      { length: escapedParents },
      () => "..",
    ).join("/");
    const resolvedPath =
      stack.length > 0 ? `${parentPrefix}/${stack.join("/")}` : parentPrefix;
    return {
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath,
    };
  }

  return {
    kind: "canonical",
    path: stack.join("/"),
  };
}

function normalizeAbsoluteSegments(path: string): string {
  const segments = path.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return "/" + stack.join("/");
}
