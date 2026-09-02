import type { RepositoryEvidence } from "./stack.js";
import { profileStack } from "./stack.js";
import type { PartialProjectProfile, ProjectProfileLeaf } from "./profile.js";

export interface ManifestContents {
  readonly packageJson?: string;
  readonly makefile?: string;
  readonly pyprojectToml?: string;
  readonly cargoToml?: string;
  readonly goMod?: string;
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

function deriveCargoTomlCommands(
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  if (!("test" in commands)) {
    commands.test = {
      status: "derived",
      value: "cargo test",
      evidence: "Cargo.toml",
    };
  }
  if (!("lint" in commands)) {
    commands.lint = {
      status: "derived",
      value: "cargo clippy",
      evidence: "Cargo.toml",
    };
  }
  if (!("build" in commands)) {
    commands.build = {
      status: "derived",
      value: "cargo build",
      evidence: "Cargo.toml",
    };
  }
  if (!("run" in commands)) {
    commands.run = {
      status: "derived",
      value: "cargo run",
      evidence: "Cargo.toml",
    };
  }
}

function deriveGoModCommands(
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  if (!("test" in commands)) {
    commands.test = {
      status: "derived",
      value: "go test ./...",
      evidence: "go.mod",
    };
  }
  if (!("lint" in commands)) {
    commands.lint = {
      status: "derived",
      value: "go vet ./...",
      evidence: "go.mod",
    };
  }
  if (!("build" in commands)) {
    commands.build = {
      status: "derived",
      value: "go build ./...",
      evidence: "go.mod",
    };
  }
  if (!("run" in commands)) {
    commands.run = {
      status: "derived",
      value: "go run .",
      evidence: "go.mod",
    };
  }
}

function deriveCommands(
  evidence: RepositoryEvidence,
  manifests: ManifestContents,
): PartialProjectProfile["commands"] | undefined {
  const commands: Record<string, ProjectProfileLeaf<string>> = {};

  if (manifests.packageJson !== undefined) {
    derivePackageJsonCommands(manifests.packageJson, commands);
  }

  if (manifests.pyprojectToml !== undefined) {
    derivePyprojectTomlCommands(manifests.pyprojectToml, commands);
  }

  if (
    manifests.cargoToml !== undefined ||
    evidence.rootEntries.includes("Cargo.toml")
  ) {
    deriveCargoTomlCommands(commands);
  }

  if (
    manifests.goMod !== undefined ||
    evidence.rootEntries.includes("go.mod")
  ) {
    deriveGoModCommands(commands);
  }

  if (manifests.makefile !== undefined) {
    deriveMakefileCommands(manifests.makefile, commands);
  }

  return Object.keys(commands).length > 0 ? commands : undefined;
}

function deriveConventions(
  evidence: RepositoryEvidence,
): PartialProjectProfile["conventions"] | undefined {
  const profile = profileStack(evidence);
  const activeLanguages = profile.languages.filter((lang) => lang.files > 0);

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
  const commands = deriveCommands(evidence, manifests);
  const paths = derivePaths(evidence);
  const conventions = deriveConventions(evidence);

  const profile: PartialProjectProfile = {
    ...(commands !== undefined ? { commands } : {}),
    ...(paths !== undefined ? { paths } : {}),
    ...(conventions !== undefined ? { conventions } : {}),
  };

  return Object.freeze(profile);
}
