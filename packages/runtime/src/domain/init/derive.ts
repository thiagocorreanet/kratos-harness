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

function derivePathSlot(
  evidence: RepositoryEvidence,
  layout: ObservedLayout,
  candidates: readonly string[],
): ProjectProfileLeaf<readonly string[]> | undefined {
  const found = candidateDirectories(evidence, layout, candidates);
  if (found.length === 0) return undefined;
  const selected = selectPaths(rankCandidates(withoutEnclosed(found)));
  if (selected === undefined) return undefined;
  return {
    status: "derived",
    value: Object.freeze(selected.value),
    evidence: selected.evidence,
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
): PartialProjectProfile["paths"] | undefined {
  const layout = observeLayout(observedPaths(evidence));
  const paths: {
    source?: ProjectProfileLeaf<readonly string[]>;
    tests?: ProjectProfileLeaf<readonly string[]>;
    configuration?: ProjectProfileLeaf<readonly string[]>;
  } = {};

  const source = derivePathSlot(evidence, layout, SOURCE_PATH_CANDIDATES);
  if (source !== undefined) paths.source = source;

  const tests = derivePathSlot(evidence, layout, TESTS_PATH_CANDIDATES);
  if (tests !== undefined) paths.tests = tests;

  const configuration = derivePathSlot(
    evidence,
    layout,
    CONFIG_PATH_CANDIDATES,
  );
  if (configuration !== undefined) paths.configuration = configuration;

  return Object.keys(paths).length > 0 ? paths : undefined;
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

function deriveConventions(
  stack: StackProfile,
): PartialProjectProfile["conventions"] | undefined {
  const activeLanguages = stack.languages.filter((lang) => lang.files > 0);

  if (activeLanguages.length === 0) {
    return undefined;
  }

  const languageIds = activeLanguages.map((lang) => lang.id);
  return {
    implementationLanguages: {
      status: "derived",
      value: Object.freeze(languageIds),
      evidence: `census:${languageIds.join(",")}`,
    },
  };
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
  const commands = deriveCommands(stack, manifests);
  const paths = derivePaths(evidence);
  const conventions = deriveConventions(stack);

  const profile: PartialProjectProfile = {
    ...(commands !== undefined ? { commands } : {}),
    ...(paths !== undefined ? { paths } : {}),
    ...(conventions !== undefined ? { conventions } : {}),
  };

  return Object.freeze(profile);
}
