import type {
  DetectedStack,
  RepositoryEvidence,
  StackProfile,
} from "./stack.js";
import { STACK_COMMANDS, profileStack } from "./stack.js";
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

function hasDirectory(evidence: RepositoryEvidence, dirName: string): boolean {
  if (evidence.rootEntries.includes(dirName)) {
    return true;
  }
  if (evidence.files !== undefined) {
    const prefix = `${dirName}/`;
    return evidence.files.some((file) => file.startsWith(prefix));
  }
  return false;
}

function derivePaths(
  evidence: RepositoryEvidence,
): PartialProjectProfile["paths"] | undefined {
  const paths: {
    source?: ProjectProfileLeaf<readonly string[]>;
    tests?: ProjectProfileLeaf<readonly string[]>;
    configuration?: ProjectProfileLeaf<readonly string[]>;
  } = {};

  for (const candidate of SOURCE_PATH_CANDIDATES) {
    if (hasDirectory(evidence, candidate)) {
      paths.source = {
        status: "derived",
        value: [candidate],
        evidence: `directory:${candidate}`,
      };
      break;
    }
  }

  for (const candidate of TESTS_PATH_CANDIDATES) {
    if (hasDirectory(evidence, candidate)) {
      paths.tests = {
        status: "derived",
        value: [candidate],
        evidence: `directory:${candidate}`,
      };
      break;
    }
  }

  for (const candidate of CONFIG_PATH_CANDIDATES) {
    if (hasDirectory(evidence, candidate)) {
      paths.configuration = {
        status: "derived",
        value: [candidate],
        evidence: `directory:${candidate}`,
      };
      break;
    }
  }

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
