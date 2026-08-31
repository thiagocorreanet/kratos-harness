import { canonicalizeProjectPath } from "../paths/index.js";

/**
 * The directories a plan may write inside.
 *
 * `.brain` is managed state. `.claude` and `.codex` are the host surfaces the
 * frozen `init` inventory generates. A root itself is not a destination: a plan
 * targets what is inside it.
 */
const MANAGED_DIRECTORY_ROOTS: readonly string[] = [
  ".brain",
  ".claude",
  ".codex",
  ".gemini",
];

/**
 * The files at the project root a plan may write, by exact spelling.
 *
 * A pattern over the root -- any `*.md`, say -- would accept files this runtime
 * has no business writing. The inventory names exactly these two.
 */
const MANAGED_ROOT_FILES: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
];

/** The transaction manager's own namespace, matched without regard to case. */
const RESERVED_STATE_NAMESPACE = "transactions";

/**
 * Whether a path is one canonical spelling inside the managed surface.
 *
 * This is the question the Node adapter asks, and it is deliberately wider
 * than the destination rule in two ways: the transaction manager writes
 * `.brain/transactions/**` through this same adapter, and it creates and
 * inspects the managed roots themselves. Neither is something a caller's plan
 * may target.
 */
export function isManagedPathShape(path: string): boolean {
  const canonical = canonicalizeProjectPath(path);
  if (
    canonical.kind === "refused" ||
    canonical.path !== path ||
    canonical.path === ""
  ) {
    return false;
  }

  const separator = path.indexOf("/");
  if (separator < 0) {
    return MANAGED_ROOT_FILES.includes(path) || isManagedRoot(path);
  }
  return isManagedRoot(path.slice(0, separator));
}

function isManagedRoot(segment: string): boolean {
  return MANAGED_DIRECTORY_ROOTS.includes(segment);
}

/**
 * Whether a plan may create this directory.
 *
 * Everything a plan may write to, plus the host roots themselves. A host root
 * has no bootstrap: the plan that writes inside `.claude` is the reason
 * `.claude` exists. `.brain` is deliberately not here -- the transaction
 * manager creates it before any plan runs, and a plan proposing to create it
 * too would be two owners for one directory.
 */
export function isManagedDirectoryDestination(path: string): boolean {
  if (isManagedDestination(path)) return true;
  return isManagedRoot(path) && path !== ".brain";
}

/**
 * Whether a plan may target a path.
 *
 * The managed surface minus the namespace the transaction manager owns. One
 * rule, asked by the domain normalizer and the transaction manager alike:
 * restating it was an opportunity for the layer that plans and the layer that
 * writes to disagree, and that disagreement is the shape of a hole in the
 * allowlist.
 */
export function isManagedDestination(path: string): boolean {
  if (!isManagedPathShape(path)) return false;
  const separator = path.indexOf("/");
  // A root is a place, not a destination: a plan targets what is inside it.
  if (separator < 0) return MANAGED_ROOT_FILES.includes(path);
  return !(
    path.slice(0, separator) === ".brain" &&
    reservedNamespace(path.slice(separator + 1))
  );
}

/** Whether what follows the managed root is the reserved namespace. */
function reservedNamespace(rest: string): boolean {
  const separator = rest.indexOf("/");
  const segment = separator < 0 ? rest : rest.slice(0, separator);
  return segment.toLowerCase() === RESERVED_STATE_NAMESPACE;
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
