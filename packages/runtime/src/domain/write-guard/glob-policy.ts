/** Match the ordered, project-relative glob dialect used by feature scope. */
export function matchesOrderedGlobs(
  patterns: readonly string[],
  target: string,
): boolean {
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const expression = negated ? pattern.slice(1) : pattern;
    if (globMatches(expression, target)) matched = !negated;
  }
  return matched;
}

/** Return whether a single non-negated project-relative glob matches a target. */
export function globMatches(pattern: string, target: string): boolean {
  const expression = compileGlob(pattern);
  return expression?.test(target) ?? false;
}

/** Validate the bounded glob dialect before persisting reviewer-authored rules. */
export function isPathGlob(pattern: string): boolean {
  const expression = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  return (
    expression.length > 0 &&
    !expression.startsWith("!") &&
    compileGlob(expression) !== null
  );
}

function compileGlob(pattern: string): RegExp | null {
  if (!isSafeProjectRelativePattern(pattern)) return null;

  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (isCompleteGlobstar(pattern, index)) {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing < 0) return null;
      const content = pattern.slice(index + 1, closing);
      const characterClass = compileCharacterClass(content);
      if (characterClass === null) return null;
      source += characterClass;
      index = closing;
      continue;
    }
    source += escapeRegex(character ?? "");
  }
  source += "$";
  try {
    return new RegExp(source, "u");
  } catch {
    return null;
  }
}

function isCompleteGlobstar(pattern: string, index: number): boolean {
  return (
    pattern[index + 1] === "*" &&
    (index === 0 || pattern[index - 1] === "/") &&
    (index + 2 === pattern.length || pattern[index + 2] === "/")
  );
}

function compileCharacterClass(content: string): string | null {
  const negated = content.startsWith("!");
  const body = negated ? content.slice(1) : content;
  if (
    body.length === 0 ||
    body.includes("/") ||
    body.includes("[") ||
    body.includes("\\")
  ) {
    return null;
  }

  let source = negated ? "[^/" : "[";
  for (let index = 0; index < body.length; index += 1) {
    const first = body[index];
    const rangeEnd = body[index + 2];
    if (first === undefined) return null;
    if (body[index + 1] === "-" && rangeEnd !== undefined) {
      if (!safeCharacterRange(first, rangeEnd)) return null;
      source += `${escapeCharacterClass(first)}-${escapeCharacterClass(rangeEnd)}`;
      index += 2;
      continue;
    }
    source += escapeCharacterClass(first);
  }
  return `${source}]`;
}

function safeCharacterRange(first: string, last: string): boolean {
  const start = first.charCodeAt(0);
  const end = last.charCodeAt(0);
  const slash = "/".charCodeAt(0);
  return start <= end && !(start <= slash && slash <= end);
}

function escapeCharacterClass(value: string): string {
  return value === "\\" || value === "]" || value === "^" || value === "-"
    ? `\\${value}`
    : value;
}

function isSafeProjectRelativePattern(pattern: string): boolean {
  return (
    pattern.length > 0 &&
    pattern.length <= 1024 &&
    !pattern.startsWith("/") &&
    !/^[A-Za-z]:\//u.test(pattern) &&
    !pattern.includes("\\") &&
    !pattern.includes("`") &&
    !pattern.includes("//") &&
    !pattern.endsWith("/") &&
    !/(?:^|\/)[.][.]?($|\/)/u.test(pattern) &&
    !hasControlCharacter(pattern)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function escapeRegex(value: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(value) ? `\\${value}` : value;
}
