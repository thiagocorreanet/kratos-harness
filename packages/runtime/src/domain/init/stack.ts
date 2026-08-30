/**
 * What the classifier is allowed to look at.
 *
 * Names only. Reading file contents would make detection depend on parsing
 * every manifest format the world has, and a wrong parse is worse than an
 * unrecognized project: it names a stack confidently and gets it wrong.
 */
export interface RepositoryEvidence {
  /** Entry names directly under the project root, in any order. */
  readonly rootEntries: readonly string[];
}

export type StackId =
  "dotnet" | "go" | "java" | "node" | "php" | "python" | "ruby" | "rust";

export interface DetectedStack {
  readonly id: StackId;
  /** The entry that decided it, so a reader can check the verdict. */
  readonly evidence: string;
}

export interface StackProfile {
  /** Every stack detected, ordered by identifier so output is stable. */
  readonly stacks: readonly DetectedStack[];
  /** True when nothing matched, which is a valid project, not a failure. */
  readonly unrecognized: boolean;
}

/**
 * One marker per stack.
 *
 * A suffix rule covers the ecosystems that name their manifest after the
 * project rather than after the toolchain.
 */
const EXACT_MARKERS: readonly (readonly [string, StackId])[] = [
  ["Cargo.toml", "rust"],
  ["Gemfile", "ruby"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["composer.json", "php"],
  ["go.mod", "go"],
  ["package.json", "node"],
  ["pom.xml", "java"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
];

const SUFFIX_MARKERS: readonly (readonly [string, StackId])[] = [
  [".csproj", "dotnet"],
  [".fsproj", "dotnet"],
  [".sln", "dotnet"],
];

/**
 * Classify a project from what sits at its root.
 *
 * Total by construction: every input yields a profile. A project the tool does
 * not recognize is still a project it has to initialize, so "unrecognized" is
 * an answer rather than an error — and the profile says so plainly instead of
 * guessing at the most popular stack.
 */
export function profileStack(evidence: RepositoryEvidence): StackProfile {
  const found = new Map<StackId, string>();
  for (const entry of [...evidence.rootEntries].sort(compareText)) {
    const id = markerFor(entry);
    if (id !== null && !found.has(id)) found.set(id, entry);
  }
  const stacks = [...found.entries()]
    .map(([id, entry]) => Object.freeze({ id, evidence: entry }))
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"));
  return Object.freeze({
    stacks: Object.freeze(stacks),
    unrecognized: stacks.length === 0,
  });
}

/** A locale-neutral total order whose result cannot depend on input order. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function markerFor(entry: string): StackId | null {
  for (const [marker, id] of EXACT_MARKERS) if (entry === marker) return id;
  for (const [suffix, id] of SUFFIX_MARKERS)
    if (entry.length > suffix.length && entry.endsWith(suffix)) return id;
  return null;
}
