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
  /**
   * Project-relative file paths from a bounded scan below the root.
   *
   * Absent when the caller observed the root alone, which is the same input
   * the classifier has always accepted. Present, it is what lets a manifest in
   * `src/Api/` or `apps/web/` be seen at all.
   */
  readonly files?: readonly string[];
  /** True when the scan stopped at its budget and the listing is partial. */
  readonly truncated?: boolean;
}

/**
 * How far a scan may go, and what it never enters.
 *
 * The budget lives here rather than in the walker because it is part of what
 * the verdict means: a profile is only as complete as the listing behind it,
 * and both sides have to agree on the same bound to say so.
 */
export const SCAN_MAX_DEPTH = 4;
export const SCAN_MAX_ENTRIES = 4000;

/**
 * Directories whose contents are somebody else's code or this tool's own
 * state. Counting them would report the languages of a dependency tree rather
 * than of the project that vendored it.
 */
export const SCAN_EXCLUDED_DIRECTORIES: readonly string[] = [
  ".brain",
  ".git",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".pytest_cache",
  ".svn",
  ".terraform",
  ".tox",
  ".venv",
  "Pods",
  "__pycache__",
  "bin",
  "build",
  "coverage",
  "deps",
  "dist",
  "node_modules",
  "obj",
  "out",
  "target",
  "vendor",
  "venv",
];

/** The toolchains the marker table can name. */
export type StackId =
  | "bun"
  | "clojure"
  | "cmake"
  | "dart"
  | "deno"
  | "dotnet"
  | "elixir"
  | "erlang"
  | "go"
  | "haskell"
  | "java"
  | "julia"
  | "lua"
  | "node"
  | "perl"
  | "php"
  | "python"
  | "r"
  | "ruby"
  | "rust"
  | "scala"
  | "swift"
  | "zig";

export interface DetectedStack {
  readonly id: StackId;
  /** The entry that decided it, so a reader can check the verdict. */
  readonly evidence: string;
}

export interface DetectedLanguage {
  readonly id: LanguageId;
  /** How many scanned files carry an extension mapped to this language. */
  readonly files: number;
  /** One of those files, so a reader can check the verdict. */
  readonly evidence: string;
}

export interface ObservedExtension {
  /** The extension, lowercased, including its leading dot. */
  readonly extension: string;
  readonly files: number;
}

/**
 * What the scan saw and could not name.
 *
 * Reported so an unrecognized project is described rather than passed over in
 * silence: an extension nobody mapped and the entries at the root are enough
 * for a host to ask its next question.
 */
export interface ObservedEvidence {
  readonly extensions: readonly ObservedExtension[];
  readonly rootEntries: readonly string[];
}

export interface StackProfile {
  /** Every toolchain detected, ordered by identifier so output is stable. */
  readonly stacks: readonly DetectedStack[];
  /** Every language detected, most files first, ties broken by identifier. */
  readonly languages: readonly DetectedLanguage[];
  /** True when neither layer matched, which is a valid project, not a failure. */
  readonly unrecognized: boolean;
  /** True when the scan hit its budget, so the profile describes part of a tree. */
  readonly partial: boolean;
  /** The evidence itself, for the case where nothing above could name it. */
  readonly observed: ObservedEvidence;
}

/**
 * Extension to language.
 *
 * A census, not a parse: an extension says what a file is written in without
 * anyone opening it. The table is data, and the classifier below never asks
 * what is in it, so a language is added by adding a row.
 */
const LANGUAGE_EXTENSIONS = [
  [".asm", "assembly"],
  [".bash", "shell"],
  [".c", "c"],
  [".cc", "cpp"],
  [".cjs", "javascript"],
  [".cl", "lisp"],
  [".clj", "clojure"],
  [".cljc", "clojure"],
  [".cljs", "clojure"],
  [".coffee", "coffeescript"],
  [".cpp", "cpp"],
  [".cr", "crystal"],
  [".cs", "csharp"],
  [".css", "css"],
  [".cts", "typescript"],
  [".cxx", "cpp"],
  [".d", "d"],
  [".dart", "dart"],
  [".elm", "elm"],
  [".erl", "erlang"],
  [".ex", "elixir"],
  [".exs", "elixir"],
  [".f90", "fortran"],
  [".f95", "fortran"],
  [".fs", "fsharp"],
  [".fsi", "fsharp"],
  [".fsx", "fsharp"],
  [".gd", "gdscript"],
  [".go", "go"],
  [".groovy", "groovy"],
  [".h", "c"],
  [".hh", "cpp"],
  [".hpp", "cpp"],
  [".hrl", "erlang"],
  [".hs", "haskell"],
  [".htm", "html"],
  [".html", "html"],
  [".java", "java"],
  [".jl", "julia"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".less", "less"],
  [".lisp", "lisp"],
  [".lua", "lua"],
  [".m", "objective-c"],
  [".mjs", "javascript"],
  [".ml", "ocaml"],
  [".mli", "ocaml"],
  [".mm", "objective-c"],
  [".mts", "typescript"],
  [".nim", "nim"],
  [".pas", "pascal"],
  [".php", "php"],
  [".pl", "perl"],
  [".pm", "perl"],
  [".proto", "protobuf"],
  [".ps1", "powershell"],
  [".py", "python"],
  [".pyi", "python"],
  [".r", "r"],
  [".rb", "ruby"],
  [".rkt", "racket"],
  [".rs", "rust"],
  [".sass", "sass"],
  [".sc", "scala"],
  [".scala", "scala"],
  [".scm", "scheme"],
  [".scss", "sass"],
  [".sh", "shell"],
  [".sol", "solidity"],
  [".sql", "sql"],
  [".svelte", "svelte"],
  [".swift", "swift"],
  [".tf", "terraform"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".vb", "visualbasic"],
  [".vue", "vue"],
  [".zig", "zig"],
  [".zsh", "shell"],
] as const;

/** Every language the census can name, derived from the table it reads. */
export type LanguageId = (typeof LANGUAGE_EXTENSIONS)[number][1];

/**
 * One marker per toolchain.
 *
 * A suffix rule covers the ecosystems that name their manifest after the
 * project rather than after the toolchain.
 */
const EXACT_MARKERS: readonly (readonly [string, StackId])[] = [
  ["Cargo.toml", "rust"],
  ["CMakeLists.txt", "cmake"],
  ["Gemfile", "ruby"],
  ["Makefile.PL", "perl"],
  ["Package.swift", "swift"],
  ["Pipfile", "python"],
  ["Project.toml", "julia"],
  ["Rakefile", "ruby"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["build.sbt", "scala"],
  ["build.zig", "zig"],
  ["build.zig.zon", "zig"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["bunfig.toml", "bun"],
  ["composer.json", "php"],
  ["cpanfile", "perl"],
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["deno.lock", "deno"],
  ["deps.edn", "clojure"],
  ["go.mod", "go"],
  ["go.work", "go"],
  ["mix.exs", "elixir"],
  ["package.json", "node"],
  ["pom.xml", "java"],
  ["project.clj", "clojure"],
  ["pubspec.yaml", "dart"],
  ["pyproject.toml", "python"],
  ["rebar.config", "erlang"],
  ["renv.lock", "r"],
  ["requirements.txt", "python"],
  ["settings.gradle", "java"],
  ["settings.gradle.kts", "java"],
  ["setup.py", "python"],
  ["stack.yaml", "haskell"],
];

const SUFFIX_MARKERS: readonly (readonly [string, StackId])[] = [
  [".Rproj", "r"],
  [".cabal", "haskell"],
  [".csproj", "dotnet"],
  [".fsproj", "dotnet"],
  [".gemspec", "ruby"],
  [".rockspec", "lua"],
  [".sln", "dotnet"],
  [".vbproj", "dotnet"],
];

/** Every toolchain this build knows, so a caller can enumerate them. */
export const STACK_IDS: readonly StackId[] = Object.freeze(
  [
    ...new Set<StackId>([
      ...EXACT_MARKERS.map(([, id]) => id),
      ...SUFFIX_MARKERS.map(([, id]) => id),
    ]),
  ].sort(compareText),
);

/** How much of an unnamed tree the profile is willing to describe. */
const OBSERVED_EXTENSION_LIMIT = 8;
const OBSERVED_ROOT_ENTRY_LIMIT = 16;

interface Candidate {
  readonly path: string;
  readonly depth: number;
}

/**
 * Classify a project from the names of the files it holds.
 *
 * Two layers answering two different questions. The census says what the
 * project is written in, which works for a directory of loose scripts with no
 * build system at all. The markers say how it is built, which is what a rules
 * file and a toolchain permission are derived from. A repository can have
 * either without the other, so the profile reports them apart.
 *
 * Total by construction: every input yields a profile. A project the tool does
 * not recognize is still a project it has to initialize, so "unrecognized" is
 * an answer rather than an error — and the profile then says what it saw
 * instead of guessing at the most popular stack.
 */
export function profileStack(evidence: RepositoryEvidence): StackProfile {
  const paths = scannedPaths(evidence);
  const markers = new Map<StackId, Candidate>();
  const census = new Map<LanguageId, { files: number; best: Candidate }>();
  const unmapped = new Map<string, number>();

  for (const path of paths) {
    const candidate = { path, depth: depthOf(path) };
    const name = basenameOf(path);
    const id = markerFor(name);
    if (id !== null && preferable(candidate, markers.get(id))) {
      markers.set(id, candidate);
    }
    const extension = extensionOf(name);
    if (extension === null) continue;
    const language = LANGUAGE_BY_EXTENSION.get(extension);
    if (language === undefined) {
      unmapped.set(extension, (unmapped.get(extension) ?? 0) + 1);
      continue;
    }
    const seen = census.get(language);
    if (seen === undefined) {
      census.set(language, { files: 1, best: candidate });
      continue;
    }
    census.set(language, {
      files: seen.files + 1,
      best: preferable(candidate, seen.best) ? candidate : seen.best,
    });
  }

  const stacks = [...markers.entries()]
    .map(([id, candidate]) => Object.freeze({ id, evidence: candidate.path }))
    .sort((left, right) => compareText(left.id, right.id));
  const languages = [...census.entries()]
    .map(([id, counted]) =>
      Object.freeze({ id, files: counted.files, evidence: counted.best.path }),
    )
    .sort(
      (left, right) =>
        right.files - left.files || compareText(left.id, right.id),
    );

  return Object.freeze({
    stacks: Object.freeze(stacks),
    languages: Object.freeze(languages),
    unrecognized: stacks.length === 0 && languages.length === 0,
    partial: evidence.truncated === true,
    observed: observedEvidence(unmapped, evidence.rootEntries),
  });
}

/**
 * Every path the classifier is allowed to count, deduplicated and ordered.
 *
 * Root entries stay in the set even when a scan supplied its files, because a
 * caller that observed only the root is still a caller with evidence. Excluded
 * directories are filtered here as well as by the walker: a listing that
 * arrived from somewhere else must not be able to smuggle a dependency tree
 * into the census.
 */
function scannedPaths(evidence: RepositoryEvidence): readonly string[] {
  const paths = new Set<string>();
  for (const entry of [...evidence.rootEntries, ...(evidence.files ?? [])]) {
    const normalized = normalize(entry);
    if (normalized !== null) paths.add(normalized);
  }
  return [...paths].sort(compareText);
}

function normalize(entry: string): string | null {
  const trimmed = entry.startsWith("./") ? entry.slice(2) : entry;
  if (trimmed.length === 0 || trimmed.startsWith("/")) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment.length === 0)) return null;
  // The last segment is the file itself: a file named `build` is a file, and
  // only a directory called `build` on the way to it is somebody's output.
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => isExcluded(segment))) return null;
  if (segments.length === 1 && isExcluded(trimmed)) return null;
  return trimmed;
}

function isExcluded(segment: string): boolean {
  return SCAN_EXCLUDED_DIRECTORIES.includes(segment);
}

function observedEvidence(
  unmapped: ReadonlyMap<string, number>,
  rootEntries: readonly string[],
): ObservedEvidence {
  const extensions = [...unmapped.entries()]
    .map(([extension, files]) => Object.freeze({ extension, files }))
    .sort(
      (left, right) =>
        right.files - left.files ||
        compareText(left.extension, right.extension),
    )
    .slice(0, OBSERVED_EXTENSION_LIMIT);
  const entries = [...new Set(rootEntries)]
    .filter((entry) => normalize(entry) !== null)
    .sort(compareText)
    .slice(0, OBSERVED_ROOT_ENTRY_LIMIT);
  return Object.freeze({
    extensions: Object.freeze(extensions),
    rootEntries: Object.freeze(entries),
  });
}

/** A root marker beats a nested one, and ties break on the path itself. */
function preferable(
  candidate: Candidate,
  incumbent: Candidate | undefined,
): boolean {
  if (incumbent === undefined) return true;
  if (candidate.depth !== incumbent.depth) {
    return candidate.depth < incumbent.depth;
  }
  return compareText(candidate.path, incumbent.path) < 0;
}

/** A locale-neutral total order whose result cannot depend on input order. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function depthOf(path: string): number {
  let depth = 0;
  for (const character of path) if (character === "/") depth += 1;
  return depth;
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * The extension of a name, lowercased, or nothing.
 *
 * A leading dot is a hidden file rather than an extension, which is why
 * `.gitignore` contributes to no language.
 */
function extensionOf(name: string): string | null {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index).toLowerCase();
}

const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, LanguageId> = new Map(
  LANGUAGE_EXTENSIONS.map(([extension, id]) => [extension, id]),
);

function markerFor(name: string): StackId | null {
  for (const [marker, id] of EXACT_MARKERS) if (name === marker) return id;
  for (const [suffix, id] of SUFFIX_MARKERS)
    if (name.length > suffix.length && name.endsWith(suffix)) return id;
  return null;
}
