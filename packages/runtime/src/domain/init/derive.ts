import type {
  DetectedStack,
  RepositoryEvidence,
  StackProfile,
} from "./stack.js";
import {
  STACK_COMMANDS,
  languageOfPath,
  observedPaths,
  profileStack,
} from "./stack.js";
import type { PartialProjectProfile, ProjectProfileLeaf } from "./profile.js";

/**
 * The manifests whose contents are read rather than whose names are matched.
 *
 * Only formats something below actually parses. Recognizing which toolchain a
 * repository uses is the marker table's job in `stack.ts`; this is for the
 * declarations a manifest makes about the project itself, which no file name
 * can carry.
 */
export interface ManifestContents {
  readonly packageJson?: string;
  readonly makefile?: string;
  readonly pyprojectToml?: string;
}

const SOURCE_PATH_CANDIDATES = ["src", "lib", "app", "packages"] as const;
const TESTS_PATH_CANDIDATES = ["tests", "test", "spec", "__tests__"] as const;
const CONFIG_PATH_CANDIDATES = ["config", ".config", "etc"] as const;

/**
 * How many directories one path answer may name.
 *
 * A monorepo has more than one source root and saying so is the answer, but a
 * list long enough to stop being readable is no longer an answer the operator
 * can confirm at a glance.
 */
const PATH_VALUE_LIMIT = 4;

/**
 * How far below the strongest candidate a directory may fall and still be
 * offered, as a divisor of its file count.
 *
 * This is what separates a second service from a directory of operational
 * scripts. Two services each hold a real share of the project's files; a
 * handful of shell scripts under `app/` in a repository with two hundred C#
 * files does not, and offering it as source code would be a wrong answer
 * rather than an incomplete one.
 */
const CENSUS_SHARE_DIVISOR = 10;

interface DirectoryCandidate {
  /** The project-relative directory path. */
  readonly path: string;
  /** Where the matched name sits in the candidate list, for the census-free case. */
  readonly rank: number;
  /** True when the whole path is an entry at the repository root. */
  readonly root: boolean;
  readonly depth: number;
  /** Files below it the census could name, however deep. */
  readonly files: number;
}

interface ObservedLayout {
  /** Every directory the scan passed through, project-relative. */
  readonly directories: ReadonlySet<string>;
  /** Per directory, the number of files below it the census could name. */
  readonly census: ReadonlyMap<string, number>;
}

/**
 * The directories the scan walked and how much source each of them holds.
 *
 * One pass over the listing, crediting every ancestor of a counted file, so
 * `apps/backend/src` and `apps` are both described and the deeper answer can
 * be preferred to the shallower one on evidence rather than by position.
 */
function observeLayout(paths: readonly string[]): ObservedLayout {
  const directories = new Set<string>();
  const census = new Map<string, number>();

  for (const path of paths) {
    // The last segment is the file itself, never a directory.
    const segments = path.split("/").slice(0, -1);
    const counted = languageOfPath(path) !== null;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      directories.add(prefix);
      if (counted) census.set(prefix, (census.get(prefix) ?? 0) + 1);
    }
  }

  return { directories, census };
}

/**
 * Every directory that carries a candidate name, wherever it sits.
 *
 * A root entry equal to the name qualifies as it always has, including the
 * empty directory no file can attest to. Below the root the name is matched as
 * a path suffix, which is what lets `apps/backend/src` answer the `src`
 * candidate at all -- the layouts that put a component directory above the
 * source directory are the reason nothing was derived before.
 */
function candidateDirectories(
  evidence: RepositoryEvidence,
  layout: ObservedLayout,
  candidates: readonly string[],
): readonly DirectoryCandidate[] {
  const found = new Map<string, DirectoryCandidate>();

  const consider = (path: string, root: boolean): void => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const rank = candidates.indexOf(name);
    if (rank === -1 || found.has(path)) return;
    found.set(path, {
      path,
      rank,
      root,
      depth: depthOf(path),
      files: layout.census.get(path) ?? 0,
    });
  };

  for (const entry of evidence.rootEntries) {
    if (candidates.includes(entry)) consider(entry, true);
  }
  for (const directory of layout.directories) {
    consider(directory, !directory.includes("/"));
  }

  return [...found.values()];
}

/**
 * Drop a candidate that already contains another one.
 *
 * A repository whose `packages/` holds a `src/` per package has one source
 * root, not five: the enclosing directory says the same thing once. So the
 * enclosing candidate survives and the ones below it drop, which also keeps a
 * stray `lib/` deep inside `src/` from displacing the directory that holds it.
 */
function withoutEnclosed(
  candidates: readonly DirectoryCandidate[],
): readonly DirectoryCandidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate && candidate.path.startsWith(`${other.path}/`),
      ),
  );
}

/**
 * Order the qualifying directories and cut the list where it stops answering.
 *
 * The census ranks them, not the order of the candidate list: a directory
 * holding the files the census counted is a better answer than the first name
 * that happens to match, and it is the only signal that tells a source root
 * from a directory of scripts that shares its name.
 *
 * When the scan saw no files the census could name -- a root-only listing, a
 * repository of formats no table maps -- there is nothing to rank with, so the
 * candidate list decides and a single directory is offered, exactly as before.
 */
function rankCandidates(
  candidates: readonly DirectoryCandidate[],
): readonly DirectoryCandidate[] {
  const best = candidates.reduce((most, one) => Math.max(most, one.files), 0);

  if (best === 0) {
    const ordered = [...candidates].sort(
      (left, right) =>
        left.rank - right.rank ||
        left.depth - right.depth ||
        compareText(left.path, right.path),
    );
    return ordered.slice(0, 1);
  }

  const floor = Math.max(1, Math.floor(best / CENSUS_SHARE_DIVISOR));
  return candidates
    .filter((candidate) => candidate.files >= floor)
    .sort(
      (left, right) =>
        right.files - left.files ||
        left.depth - right.depth ||
        compareText(left.path, right.path),
    )
    .slice(0, PATH_VALUE_LIMIT);
}

/**
 * Name each directory and say why it qualified.
 *
 * A root match reads as it always has, so a repository with a root `src/` is
 * still described by `directory:src`. A suffix match says so, because that is
 * the derivation that could have picked the wrong directory and a reader has
 * to be able to see which one it was.
 *
 * The evidence a profile can store is bounded, so a directory whose name would
 * not fit is left out of the answer rather than named in a string nothing can
 * write.
 */
function selectPaths(
  ranked: readonly DirectoryCandidate[],
):
  { readonly value: readonly string[]; readonly evidence: string } | undefined {
  const value: string[] = [];
  const tokens: string[] = [];

  for (const candidate of ranked) {
    const token = candidate.root
      ? candidate.path
      : `${candidate.path} (nested)`;
    const evidence = `directory:${[...tokens, token].join(", ")}`;
    if (evidence.length > EVIDENCE_MAX_LENGTH) break;
    value.push(candidate.path);
    tokens.push(token);
  }

  if (value.length === 0) return undefined;
  return { value, evidence: `directory:${tokens.join(", ")}` };
}

interface DerivedPathSlot {
  readonly leaf: ProjectProfileLeaf<readonly string[]>;
  /** The directories the answer names, kept so the layout can be described. */
  readonly directories: readonly DirectoryCandidate[];
}

function derivePathSlot(
  evidence: RepositoryEvidence,
  layout: ObservedLayout,
  candidates: readonly string[],
): DerivedPathSlot | undefined {
  const found = candidateDirectories(evidence, layout, candidates);
  if (found.length === 0) return undefined;
  const ranked = rankCandidates(withoutEnclosed(found));
  const selected = selectPaths(ranked);
  if (selected === undefined) return undefined;
  const named = new Set(selected.value);
  return {
    leaf: {
      status: "derived",
      value: Object.freeze(selected.value),
      evidence: selected.evidence,
    },
    directories: ranked.filter((candidate) => named.has(candidate.path)),
  };
}

function depthOf(path: string): number {
  let depth = 0;
  for (const character of path) if (character === "/") depth += 1;
  return depth;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface DerivedPaths {
  /** The three path answers, absent when the layout attested to none of them. */
  readonly leaves: PartialProjectProfile["paths"] | undefined;
  /** The directories each answer names, for the convention derivation below. */
  readonly source: readonly DirectoryCandidate[];
  readonly tests: readonly DirectoryCandidate[];
}

/**
 * Derive the source, test, and configuration directories from the layout.
 *
 * Nothing here reaches a disk: the listing is whatever the bounded scan
 * observed, and a listing that stopped early describes part of a tree, so a
 * repository the scan could not cover simply has less to derive from and the
 * operator is asked. Every answer is offered for confirmation.
 */
function derivePaths(
  evidence: RepositoryEvidence,
  layout: ObservedLayout,
): DerivedPaths {
  const paths: {
    source?: ProjectProfileLeaf<readonly string[]>;
    tests?: ProjectProfileLeaf<readonly string[]>;
    configuration?: ProjectProfileLeaf<readonly string[]>;
  } = {};

  const source = derivePathSlot(evidence, layout, SOURCE_PATH_CANDIDATES);
  if (source !== undefined) paths.source = source.leaf;

  const tests = derivePathSlot(evidence, layout, TESTS_PATH_CANDIDATES);
  if (tests !== undefined) paths.tests = tests.leaf;

  const configuration = derivePathSlot(
    evidence,
    layout,
    CONFIG_PATH_CANDIDATES,
  );
  if (configuration !== undefined) paths.configuration = configuration.leaf;

  return {
    leaves: Object.keys(paths).length > 0 ? paths : undefined,
    source: source?.directories ?? [],
    tests: tests?.directories ?? [],
  };
}

function derivePackageJsonCommands(
  content: string,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("scripts" in parsed) ||
      typeof parsed.scripts !== "object" ||
      parsed.scripts === null
    ) {
      return;
    }
    const scripts = parsed.scripts as Record<string, unknown>;

    if (
      typeof scripts.test === "string" &&
      scripts.test.trim().length > 0 &&
      !("test" in commands)
    ) {
      commands.test = {
        status: "derived",
        value: "npm test",
        evidence: "package.json#scripts.test",
      };
    }

    if (
      typeof scripts.lint === "string" &&
      scripts.lint.trim().length > 0 &&
      !("lint" in commands)
    ) {
      commands.lint = {
        status: "derived",
        value: "npm run lint",
        evidence: "package.json#scripts.lint",
      };
    }

    if (
      typeof scripts.build === "string" &&
      scripts.build.trim().length > 0 &&
      !("build" in commands)
    ) {
      commands.build = {
        status: "derived",
        value: "npm run build",
        evidence: "package.json#scripts.build",
      };
    }

    if (!("run" in commands)) {
      if (
        typeof scripts.start === "string" &&
        scripts.start.trim().length > 0
      ) {
        commands.run = {
          status: "derived",
          value: "npm start",
          evidence: "package.json#scripts.start",
        };
      } else if (
        typeof scripts.run === "string" &&
        scripts.run.trim().length > 0
      ) {
        commands.run = {
          status: "derived",
          value: "npm run run",
          evidence: "package.json#scripts.run",
        };
      }
    }
  } catch {
    // Declarative derivation ignores unparseable manifests safely
  }
}

function deriveMakefileCommands(
  content: string,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  const lines = content.split("\n");
  const targets = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("\t") || line.startsWith(" ")) continue;
    const match = /^([a-zA-Z0-9_.-]+)\s*:/u.exec(line);
    if (match?.[1] !== undefined) {
      targets.add(match[1]);
    }
  }

  if (targets.has("test") && !("test" in commands)) {
    commands.test = {
      status: "derived",
      value: "make test",
      evidence: "Makefile:test",
    };
  }

  if (targets.has("lint") && !("lint" in commands)) {
    commands.lint = {
      status: "derived",
      value: "make lint",
      evidence: "Makefile:lint",
    };
  }

  if (targets.has("build") && !("build" in commands)) {
    commands.build = {
      status: "derived",
      value: "make build",
      evidence: "Makefile:build",
    };
  }

  if (targets.has("run") && !("run" in commands)) {
    commands.run = {
      status: "derived",
      value: "make run",
      evidence: "Makefile:run",
    };
  }
}

function derivePyprojectTomlCommands(
  content: string,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      (trimmed === "[tool.pytest.ini_options]" ||
        trimmed === "[tool.pytest]") &&
      !("test" in commands)
    ) {
      const section = trimmed.slice(1, -1);
      commands.test = {
        status: "derived",
        value: "pytest",
        evidence: `pyproject.toml#${section}`,
      };
    }
    if (trimmed === "[tool.ruff]" && !("lint" in commands)) {
      commands.lint = {
        status: "derived",
        value: "ruff check",
        evidence: "pyproject.toml#tool.ruff",
      };
    }
  }
}

const COMMAND_SLOTS = ["test", "lint", "build", "run"] as const;

/**
 * The longest evidence the profile schema stores. A marker buried under long
 * directory names must not be why initialization refuses to write a profile,
 * so the stack alone is named when its path would not fit.
 */
const EVIDENCE_MAX_LENGTH = 256;

/** The longest convention string the profile schema stores. */
const CONVENTION_MAX_LENGTH = 1024;

function stackEvidence(detected: DetectedStack): string {
  const full = `stack:${detected.id} via ${detected.evidence}`;
  return full.length <= EVIDENCE_MAX_LENGTH ? full : `stack:${detected.id}`;
}

/**
 * Fill the slots the manifests did not state with the toolchain's own verbs.
 *
 * Runs after content derivation and never overwrites it: a declared
 * `scripts.test` is a fact about this repository, while a canonical command is
 * a convention about its ecosystem, and the fact wins. Stacks arrive ordered
 * by identifier, so a polyglot repository resolves the same way every time.
 *
 * The evidence carries the marker that named the toolchain, so a canonical
 * command still says where it came from and stays checkable.
 */
function deriveStackCommands(
  stack: StackProfile,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  for (const detected of stack.stacks) {
    const canonical = STACK_COMMANDS[detected.id];
    for (const slot of COMMAND_SLOTS) {
      const value = canonical[slot];
      if (value === undefined || slot in commands) continue;
      commands[slot] = {
        status: "derived",
        value,
        evidence: stackEvidence(detected),
      };
    }
  }
}

/**
 * Derive the four commands from what the repository declares, then from what
 * its toolchain conventionally calls them.
 *
 * There is no file-name list here. The toolchain is whatever `profileStack`
 * already named from the marker table, which is why an ecosystem that table
 * recognizes cannot reach the interview with nothing derived.
 */
function deriveCommands(
  stack: StackProfile,
  manifests: ManifestContents,
): PartialProjectProfile["commands"] | undefined {
  const commands: Record<string, ProjectProfileLeaf<string>> = {};

  if (manifests.packageJson !== undefined) {
    derivePackageJsonCommands(manifests.packageJson, commands);
  }

  if (manifests.pyprojectToml !== undefined) {
    derivePyprojectTomlCommands(manifests.pyprojectToml, commands);
  }

  if (manifests.makefile !== undefined) {
    deriveMakefileCommands(manifests.makefile, commands);
  }

  deriveStackCommands(stack, commands);

  return Object.keys(commands).length > 0 ? commands : undefined;
}

/**
 * How many file names of one language the casing census needs before it will
 * state a convention.
 *
 * A convention is a regularity, and three files are not one. Below this the
 * leaf is left for the operator, because a naming rule derived from a handful
 * of names is applied silently to every file a phase agent writes afterwards.
 */
const NAMING_MIN_SAMPLE = 5;

/**
 * The share of counted names the winning form must hold.
 *
 * A repository split between two casings has no naming convention to preserve,
 * and saying it does would be a wrong answer rather than a missing one.
 */
const NAMING_DOMINANCE = 0.8;

type NamingForm =
  "PascalCase" | "camelCase" | "kebab-case" | "snake_case" | "lowercase";

const NAMING_FORMS: readonly NamingForm[] = [
  "PascalCase",
  "camelCase",
  "kebab-case",
  "snake_case",
  "lowercase",
];

/**
 * The identifying part of a file name, or nothing when it carries no casing.
 *
 * Everything from the first dot onwards is extension, not name: `Order.Tests.cs`
 * and `order.test.ts` are both named by their first segment, which is the part
 * a phase agent chooses when it creates the file. A leading dot is a hidden
 * file rather than a name, and a name with no letters cannot attest to a
 * casing.
 */
function nameStem(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  const stem = dot <= 0 ? (dot === 0 ? "" : base) : base.slice(0, dot);
  if (stem.length === 0 || !/[A-Za-z]/u.test(stem)) return null;
  return stem;
}

/**
 * The casing a single name attests to, or nothing when it attests to none.
 *
 * A name mixing separators, or carrying characters no convention describes,
 * is left out of the count rather than pushed into the nearest bucket: the
 * census reports what it could read, and a name it could not read is not
 * evidence for anything.
 */
function namingFormOf(stem: string): NamingForm | null {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(stem)) return "kebab-case";
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/u.test(stem)) return "snake_case";
  if (/^[A-Z][A-Za-z0-9]*$/u.test(stem) && /[a-z]/u.test(stem)) {
    return "PascalCase";
  }
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/u.test(stem)) return "camelCase";
  if (/^[a-z][a-z0-9]*$/u.test(stem)) return "lowercase";
  return null;
}

interface NamingCensus {
  readonly counts: ReadonlyMap<NamingForm, number>;
  readonly total: number;
}

/** Count the casings observed among one language's file names. */
function censusNames(paths: readonly string[]): NamingCensus {
  const counts = new Map<NamingForm, number>();
  let total = 0;
  for (const path of paths) {
    const stem = nameStem(path);
    if (stem === null) continue;
    const form = namingFormOf(stem);
    if (form === null) continue;
    counts.set(form, (counts.get(form) ?? 0) + 1);
    total += 1;
  }
  return { counts, total };
}

/**
 * The one casing a census supports, with the names that support it.
 *
 * A single-word lowercase name is compatible with both separator forms, so it
 * is counted for the separator form when exactly one of them is present and no
 * capitalized form is: `parse-order.ts` beside `parser.ts` is one convention,
 * not two. Everywhere else the forms compete on their own counts, and a tie
 * supports nothing.
 */
function dominantNaming(
  census: NamingCensus,
): { readonly form: NamingForm; readonly files: number } | null {
  const count = (form: NamingForm): number => census.counts.get(form) ?? 0;
  const kebab = count("kebab-case");
  const snake = count("snake_case");
  const lowercase = count("lowercase");
  const capitalized = count("PascalCase") + count("camelCase");

  if (capitalized === 0 && kebab > 0 && snake === 0) {
    return { form: "kebab-case", files: kebab + lowercase };
  }
  if (capitalized === 0 && snake > 0 && kebab === 0) {
    return { form: "snake_case", files: snake + lowercase };
  }

  let best: NamingForm | null = null;
  let bestFiles = 0;
  let tied = false;
  for (const form of NAMING_FORMS) {
    const files = count(form);
    if (files === 0) continue;
    if (files > bestFiles) {
      best = form;
      bestFiles = files;
      tied = false;
    } else if (files === bestFiles) {
      tied = true;
    }
  }
  if (best === null || tied) return null;
  return { form: best, files: bestFiles };
}

const NAMING_INSTRUCTION: Readonly<Record<NamingForm, string>> = Object.freeze({
  PascalCase: "Name new files in PascalCase",
  camelCase: "Name new files in camelCase",
  "kebab-case": "Name new files in kebab-case",
  snake_case: "Name new files in snake_case",
  lowercase: "Name new files in lowercase single words",
});

/**
 * State the naming convention the repository already follows, or nothing.
 *
 * Measured per language and reported on the one that carries the most readable
 * names, because casing is a property of a language's community rather than of
 * a repository: a C# project with a handful of shell scripts names its C#
 * files `PascalCase.cs` and that is the convention a phase agent must keep.
 */
function deriveNaming(
  stack: StackProfile,
  paths: readonly string[],
): ProjectProfileLeaf<string> | undefined {
  const byLanguage = new Map<string, string[]>();
  for (const path of paths) {
    const language = languageOfPath(path);
    if (language === null) continue;
    const seen = byLanguage.get(language);
    if (seen === undefined) byLanguage.set(language, [path]);
    else seen.push(path);
  }

  let chosen:
    | {
        readonly language: string;
        readonly form: NamingForm;
        readonly files: number;
        readonly total: number;
      }
    | undefined;

  // Languages arrive most-counted first, ties broken by identifier, so the
  // language the project is mostly written in is the one measured. A language
  // too small to attest to anything is passed over -- two shell scripts in a
  // C# service say nothing about how its files are named -- but the first
  // language large enough to measure is the only one measured: falling through
  // to the next would answer a question about C# with a convention read off
  // the shell scripts.
  for (const language of stack.languages) {
    const observed = byLanguage.get(language.id);
    if (observed === undefined) continue;
    const census = censusNames(observed);
    if (census.total < NAMING_MIN_SAMPLE) continue;
    const dominant = dominantNaming(census);
    if (dominant === null) break;
    if (dominant.files / census.total < NAMING_DOMINANCE) break;
    chosen = {
      language: language.id,
      form: dominant.form,
      files: dominant.files,
      total: census.total,
    };
    break;
  }

  if (chosen === undefined) return undefined;

  return {
    status: "derived",
    value: `${NAMING_INSTRUCTION[chosen.form]}, as the ${chosen.language} files in this project already are.`,
    evidence: `naming:${chosen.form} on ${String(chosen.files)} of ${String(chosen.total)} ${chosen.language} files`,
  };
}

/** The directory a path sits in, or the empty string at the repository root. */
function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** True when every path shares the trailing name and the same grandparent. */
function repeatedShape(
  directories: readonly DirectoryCandidate[],
): { readonly parent: string; readonly name: string } | null {
  const first = directories[0];
  if (first === undefined || first.root) return null;
  const name = nameOf(first.path);
  const parent = parentOf(parentOf(first.path));
  for (const directory of directories) {
    if (directory.root) return null;
    if (nameOf(directory.path) !== name) return null;
    if (parentOf(parentOf(directory.path)) !== parent) return null;
  }
  return { parent, name };
}

/**
 * Whether the scan saw test files living inside the source tree.
 *
 * The alternative to a sibling test directory is a test beside the code it
 * covers, and that is a layout instruction of its own. A name is a test when
 * it says so -- `order.test.ts`, `test_order.py`, `OrderTests.cs` -- which is
 * the same kind of observation the casing census makes.
 */
function colocatedTests(
  paths: readonly string[],
  sources: readonly DirectoryCandidate[],
): number {
  let found = 0;
  for (const path of paths) {
    if (languageOfPath(path) === null) continue;
    if (!sources.some((source) => path.startsWith(`${source.path}/`))) continue;
    const base = nameOf(path);
    if (/(?:^|[._-])(?:tests?|specs?)(?:[._-]|$)/iu.test(base)) found += 1;
  }
  return found;
}

/** A counted noun, so evidence a person reads is evidence a person can read. */
function countOf(files: number, noun: string): string {
  return `${String(files)} ${noun}${files === 1 ? "" : "s"}`;
}

function filesUnder(directories: readonly DirectoryCandidate[]): number {
  return directories.reduce((total, one) => total + one.files, 0);
}

/**
 * State where this repository puts its code, or nothing.
 *
 * Only a shape the scan saw repeat, or a single unambiguous root: a tree whose
 * source directories sit at different depths, or under different parents, has
 * no one layout to preserve and the operator is asked instead. What is derived
 * is an instruction about placement, because that is what the leaf is for.
 */
function deriveDirectoryLayout(
  paths: DerivedPaths,
  observed: readonly string[],
): ProjectProfileLeaf<string> | undefined {
  const sources = paths.source;
  const first = sources[0];
  if (first === undefined) return undefined;

  const sourceFiles = filesUnder(sources);
  const testFiles = filesUnder(paths.tests);
  const counts = (): string =>
    paths.tests.length > 0
      ? `${countOf(sourceFiles, "source file")}, ${countOf(testFiles, "test file")}`
      : countOf(sourceFiles, "source file");

  if (sources.length === 1 && first.root) {
    const sibling = paths.tests.find((directory) => directory.root);
    const colocated = colocatedTests(observed, sources);
    const tail =
      sibling !== undefined
        ? ` and its tests in the sibling \`${sibling.path}/\` directory`
        : colocated > 0
          ? " and its tests beside the code they cover"
          : "";
    return layoutLeaf(
      `Place new source under \`${first.path}/\` at the repository root${tail}.`,
      `layout:root ${first.path}; ${counts()}`,
    );
  }

  const shape = repeatedShape(sources);
  if (shape === null) return undefined;

  const placement =
    shape.parent === ""
      ? `Place new source in \`<component>/${shape.name}/\`, one directory per component at the repository root`
      : `Place new source in \`<component>/${shape.name}/\` below \`${shape.parent}/\``;
  const tests = repeatedShape(paths.tests);
  const tail =
    tests !== null && tests.parent === shape.parent
      ? `, and its tests in \`<component>/${tests.name}/\``
      : "";
  return layoutLeaf(
    `${placement}${tail}.`,
    `layout:${countOf(sources.length, "component")} under ${shape.parent === "" ? "the root" : shape.parent}; ${counts()}`,
  );
}

/**
 * A layout answer, dropped when its evidence would not fit what a profile can
 * store -- an answer nothing can write is worse than the question.
 */
function layoutLeaf(
  value: string,
  evidence: string,
): ProjectProfileLeaf<string> | undefined {
  if (evidence.length > EVIDENCE_MAX_LENGTH) return undefined;
  if (value.length > CONVENTION_MAX_LENGTH) return undefined;
  return { status: "derived", value, evidence };
}

/**
 * Derive the three conventions a phase agent has to preserve.
 *
 * Each is an observed regularity rather than a stated preference, which is why
 * they can be derived at all, and each is offered for confirmation like every
 * other derived leaf.
 */
function deriveConventions(
  stack: StackProfile,
  paths: DerivedPaths,
  observed: readonly string[],
): PartialProjectProfile["conventions"] | undefined {
  const conventions: {
    directoryLayout?: ProjectProfileLeaf<string>;
    naming?: ProjectProfileLeaf<string>;
    implementationLanguages?: ProjectProfileLeaf<readonly string[]>;
  } = {};

  const activeLanguages = stack.languages.filter((lang) => lang.files > 0);
  if (activeLanguages.length > 0) {
    const languageIds = activeLanguages.map((lang) => lang.id);
    conventions.implementationLanguages = {
      status: "derived",
      value: Object.freeze(languageIds),
      evidence: `census:${languageIds.join(",")}`,
    };
  }

  const directoryLayout = deriveDirectoryLayout(paths, observed);
  if (directoryLayout !== undefined) {
    conventions.directoryLayout = directoryLayout;
  }

  const naming = deriveNaming(stack, observed);
  if (naming !== undefined) conventions.naming = naming;

  return Object.keys(conventions).length > 0 ? conventions : undefined;
}

/**
 * Purely and deterministically derives a partial project profile from
 * repository manifests and directory layout without side effects.
 */
export function deriveProjectProfile(
  evidence: RepositoryEvidence,
  manifests: ManifestContents = {},
): PartialProjectProfile {
  const stack = profileStack(evidence);
  const observed = observedPaths(evidence);
  const commands = deriveCommands(stack, manifests);
  const paths = derivePaths(evidence, observeLayout(observed));
  const conventions = deriveConventions(stack, paths, observed);

  const profile: PartialProjectProfile = {
    ...(commands !== undefined ? { commands } : {}),
    ...(paths.leaves !== undefined ? { paths: paths.leaves } : {}),
    ...(conventions !== undefined ? { conventions } : {}),
  };

  return Object.freeze(profile);
}
