import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { posix } from "node:path";

export type Layer =
  | "domain"
  | "ports"
  | "infra"
  | "composition"
  | "entry"
  | "contracts"
  | "adapters";

export interface SourceModule {
  readonly path: string;
  readonly imports: readonly string[];
}

export interface Violation {
  readonly path: string;
  readonly specifier: string;
  readonly reason: string;
}

type Target = Layer | "node" | "ajv" | "schemas";

/**
 * Remove comments before scanning, so a specifier mentioned in a comment is not
 * mistaken for a dependency. Only whole-line `//` comments are stripped, so a
 * URL inside a string survives intact.
 */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, " ")
    .replaceAll(/^[ \t]*\/\/.*$/gmu, " ");
}

// Static and side-effect imports are anchored to the start of a line, which is
// where a real declaration must appear. That is what keeps a specifier quoted
// inside an expression -- `const text = "import ... from \\"x\\""` -- from being
// picked up. Dynamic `import()` is an expression, so it is matched anywhere.
const patterns = [
  // The clause between `import` and `from` may span lines — that is Prettier's
  // own output for an import with several names — so the body must cross
  // newlines. It stops at a semicolon or a quote, because only identifiers,
  // braces, commas, `as`, and `type` can legally appear there. Without that
  // bound a lazy match could run past one declaration into the next.
  /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gmu,
  /^[ \t]*import\s*(['"])([^'"]+)\1/gmu,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu,
  // `require` is the standard escape hatch. It has no place in this ESM
  // package, which is exactly why it must not be an unwatched way out.
  /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu,
];

/** Every module specifier a file depends on, in source order. */
export async function collectImports(file: string): Promise<readonly string[]> {
  const source = await readFile(file, "utf8");
  const code = stripComments(source);
  const found = new Map<number, string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const specifier = match[2];
      if (specifier !== undefined && !specifier.includes("\u0000")) {
        found.set(match.index, specifier);
      }
    }
  }
  return [...found.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, specifier]) => specifier);
}

export function classifyLayer(path: string): Layer {
  if (path.startsWith("packages/contracts/")) return "contracts";
  if (path.startsWith("packages/adapters/")) return "adapters";
  if (path.includes("/src/domain/")) return "domain";
  if (path.includes("/src/ports/")) return "ports";
  if (path.includes("/src/infra/")) return "infra";
  if (path.includes("/src/composition/")) return "composition";
  return "entry";
}

// A builtin can be imported bare — `import { readFileSync } from "fs"` is legal
// Node and resolves fine — so matching only the `node:` prefix would let four
// dropped characters walk straight through the rule.
const builtins = new Set(builtinModules);

function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return builtins.has(specifier.split("/")[0] ?? specifier);
}

/** The layer a specifier resolves to, or null when it is not layered source. */
function targetLayer(specifier: string): Target | null {
  if (isBuiltin(specifier)) return "node";
  if (specifier === "ajv" || specifier.startsWith("ajv/")) return "ajv";
  if (
    specifier.includes("schemas/") ||
    specifier.includes("/infra/schema/") ||
    specifier.endsWith("/infra/schema")
  ) {
    return "schemas";
  }
  if (specifier.startsWith("@kratos/contracts")) return "contracts";
  if (specifier.startsWith("@kratos/adapters")) return "adapters";
  if (specifier.includes("/domain/") || specifier.endsWith("/domain")) {
    return "domain";
  }
  if (specifier.includes("/ports/") || specifier.endsWith("/ports")) {
    return "ports";
  }
  if (specifier.includes("/infra/") || specifier.endsWith("/infra")) {
    return "infra";
  }
  if (
    specifier.includes("/composition/") ||
    specifier.endsWith("/composition")
  ) {
    return "composition";
  }
  return null;
}

/**
 * Classify a specifier, resolving a relative one against the importing module.
 *
 * Guessing from the specifier alone leaves `entry` unreachable, which makes the
 * entry rules dead code and lets a layer reach a builtin indirectly through an
 * entry module. Resolving the real path is what closes that.
 */
function resolveTarget(fromPath: string, specifier: string): Target | null {
  const direct = targetLayer(specifier);
  if (direct !== null) return direct;
  if (!specifier.startsWith(".")) return null;
  const resolved = posix.normalize(
    posix.join(posix.dirname(fromPath), specifier),
  );
  return classifyLayer(resolved);
}

/**
 * Dependency direction, as data. Each rule names the layer it constrains, what
 * that layer may not reach, and the message a violation reports.
 */
const rules: {
  readonly from: Layer;
  readonly forbidden: readonly Target[];
  readonly reason: (target: Target) => string;
}[] = [
  {
    from: "domain",
    forbidden: [
      "node",
      "infra",
      "composition",
      "entry",
      "ajv",
      "schemas",
      "adapters",
    ],
    reason: (target) =>
      target === "node"
        ? "domain must not import Node.js builtins"
        : target === "ajv" || target === "schemas"
          ? "domain must not import schema infrastructure"
          : target === "composition"
            ? "only an entry point may import composition"
            : `domain must not import ${target}`,
  },
  {
    from: "ports",
    forbidden: [
      "node",
      "infra",
      "composition",
      "entry",
      "ajv",
      "schemas",
      "adapters",
    ],
    reason: (target) =>
      target === "node"
        ? "ports must not import Node.js builtins"
        : target === "ajv" || target === "schemas"
          ? "ports must not import schema infrastructure"
          : target === "composition"
            ? "only an entry point may import composition"
            : `ports must not import ${target}`,
  },
  {
    from: "infra",
    forbidden: ["composition"],
    reason: () => "only an entry point may import composition",
  },
  {
    from: "contracts",
    forbidden: ["domain", "ports", "infra", "composition", "entry", "adapters"],
    reason: (target) => `contracts must not import ${target}`,
  },
  {
    // An adapter translates and relays. Denying it the runtime's own layers is
    // what makes "adapters never own transition policy" structural rather than
    // a rule each adapter is trusted to have followed.
    from: "adapters",
    forbidden: [
      "node",
      "domain",
      "ports",
      "infra",
      "composition",
      "entry",
      "ajv",
      "schemas",
    ],
    reason: (target) =>
      target === "node"
        ? "adapters must not import Node.js builtins"
        : target === "ajv" || target === "schemas"
          ? "adapters must not import schema infrastructure"
          : `adapters must not import ${target}`,
  },
];

export function violations(
  modules: readonly SourceModule[],
): readonly Violation[] {
  const found: Violation[] = [];
  for (const module of modules) {
    const from = classifyLayer(module.path);
    const rule = rules.find((candidate) => candidate.from === from);
    if (rule === undefined) continue;
    for (const specifier of module.imports) {
      const target = resolveTarget(module.path, specifier);
      if (target === null || !rule.forbidden.includes(target)) continue;
      found.push({
        path: module.path,
        specifier,
        reason: rule.reason(target),
      });
    }
  }
  return found;
}
