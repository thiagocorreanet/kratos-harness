import {
  deriveProjectProfile,
  resolveProjectProfile,
  unresolvedProjectProfile,
  unresolvedProjectProfileKeys,
  type ManifestContents,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

describe("pure project profile derivation", () => {
  it("derives commands from package.json scripts with exact evidence provenance", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          build: "tsc && esbuild",
          start: "node dist/index.js",
        },
      }),
    };
    const evidence = { rootEntries: ["package.json"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "npm test",
      evidence: "package.json#scripts.test",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "npm run lint",
      evidence: "package.json#scripts.lint",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "npm run build",
      evidence: "package.json#scripts.build",
    });
    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "npm start",
      evidence: "package.json#scripts.start",
    });
  });

  it("derives npm run run when scripts.run exists without scripts.start", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        scripts: {
          run: "node main.js",
        },
      }),
    };
    const evidence = { rootEntries: ["package.json"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "npm run run",
      evidence: "package.json#scripts.run",
    });
  });

  it("derives commands from Makefile targets", () => {
    const manifests: ManifestContents = {
      makefile: [
        ".PHONY: all test lint build run",
        "",
        "test:",
        "\tgo test ./...",
        "",
        "lint:",
        "\tgolangci-lint run",
        "",
        "build:",
        "\tgo build -o bin/app .",
        "",
        "run:",
        "\t./bin/app",
      ].join("\n"),
    };
    const evidence = { rootEntries: ["Makefile"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "make test",
      evidence: "Makefile:test",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "make lint",
      evidence: "Makefile:lint",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "make build",
      evidence: "Makefile:build",
    });
    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "make run",
      evidence: "Makefile:run",
    });
  });

  it("derives commands from pyproject.toml tool configurations", () => {
    const manifests: ManifestContents = {
      pyprojectToml: [
        "[tool.pytest.ini_options]",
        "testpaths = ['tests']",
        "",
        "[tool.ruff]",
        "line-length = 88",
      ].join("\n"),
    };
    const evidence = { rootEntries: ["pyproject.toml"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "pytest",
      evidence: "pyproject.toml#tool.pytest.ini_options",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "ruff check",
      evidence: "pyproject.toml#tool.ruff",
    });
  });

  it("derives canonical commands from the Rust toolchain marker", () => {
    const evidence = { rootEntries: ["Cargo.toml", "src"] };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "cargo test",
      evidence: "stack:rust via Cargo.toml",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "cargo clippy",
      evidence: "stack:rust via Cargo.toml",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "cargo build",
      evidence: "stack:rust via Cargo.toml",
    });
    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "cargo run",
      evidence: "stack:rust via Cargo.toml",
    });
  });

  it("derives canonical commands from the Go toolchain marker", () => {
    const evidence = { rootEntries: ["go.mod", "main.go"] };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "go test ./...",
      evidence: "stack:go via go.mod",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "go vet ./...",
      evidence: "stack:go via go.mod",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "go build ./...",
      evidence: "stack:go via go.mod",
    });
    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "go run .",
      evidence: "stack:go via go.mod",
    });
  });

  it("derives the four commands for a .NET solution the census names", () => {
    const evidence = {
      rootEntries: ["Sample.sln", "src"],
      files: ["Sample.sln", "src/Api/Api.csproj", "src/Api/Program.cs"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "dotnet test",
      evidence: "stack:dotnet via Sample.sln",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "dotnet format",
      evidence: "stack:dotnet via Sample.sln",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "dotnet build",
      evidence: "stack:dotnet via Sample.sln",
    });
    expect(derived.commands?.run).toEqual({
      status: "derived",
      value: "dotnet run",
      evidence: "stack:dotnet via Sample.sln",
    });
  });

  it("names the nested marker that identified the toolchain", () => {
    const evidence = {
      rootEntries: ["src", "README.md"],
      files: ["src/Api/Api.csproj", "src/Api/Program.cs"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "dotnet build",
      evidence: "stack:dotnet via src/Api/Api.csproj",
    });
  });

  it("names the stack alone when the marker path would not fit the evidence", () => {
    // A profile whose evidence exceeds what the schema stores would refuse to
    // be written, and refusing to initialize is worse than a shorter answer.
    const buried = `${"nested".repeat(45)}/Api.csproj`;
    const evidence = { rootEntries: ["src"], files: [buried] };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "dotnet test",
      evidence: "stack:dotnet",
    });
  });

  it("keeps a declared manifest command ahead of the toolchain default", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({ scripts: { test: "vitest run" } }),
    };
    const evidence = { rootEntries: ["package.json", "Cargo.toml"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "npm test",
      evidence: "package.json#scripts.test",
    });
    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "cargo build",
      evidence: "stack:rust via Cargo.toml",
    });
  });

  it("keeps a Makefile target ahead of the toolchain default", () => {
    const manifests: ManifestContents = {
      makefile: ["test:", "\tcargo nextest run"].join("\n"),
    };
    const evidence = { rootEntries: ["Makefile", "Cargo.toml"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "make test",
      evidence: "Makefile:test",
    });
  });

  it("derives no command when the census cannot name the toolchain", () => {
    const evidence = {
      rootEntries: ["README.md", "src"],
      files: ["src/tool.awk"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands).toBeUndefined();
  });

  it("derives no command for an ecosystem whose toolchain the id cannot pin", () => {
    const evidence = { rootEntries: ["pom.xml", "src"] };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.commands).toBeUndefined();
  });

  it("derives canonical source, tests, and configuration paths from directory layout", () => {
    const evidence = {
      rootEntries: ["src", "tests", "config", "README.md"],
      files: ["src/index.ts", "tests/index.test.ts", "config/default.json"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["src"],
      evidence: "directory:src",
    });
    expect(derived.paths?.tests).toEqual({
      status: "derived",
      value: ["tests"],
      evidence: "directory:tests",
    });
    expect(derived.paths?.configuration).toEqual({
      status: "derived",
      value: ["config"],
      evidence: "directory:config",
    });
  });

  it("derives fallback candidate paths when alternative names exist", () => {
    const evidence = {
      rootEntries: ["lib", "spec", ".config"],
      files: ["lib/app.rb", "spec/app_spec.rb", ".config/settings.yml"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["lib"],
      evidence: "directory:lib",
    });
    expect(derived.paths?.tests).toEqual({
      status: "derived",
      value: ["spec"],
      evidence: "directory:spec",
    });
    expect(derived.paths?.configuration).toEqual({
      status: "derived",
      value: [".config"],
      evidence: "directory:.config",
    });
  });

  it("derives implementation languages from repository census scan", () => {
    const evidence = {
      rootEntries: ["src", "package.json"],
      files: ["src/index.ts", "src/util.ts", "src/legacy.js"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.implementationLanguages).toEqual({
      status: "derived",
      value: ["typescript", "javascript"],
      evidence: "census:typescript,javascript",
    });
    expect(derived.conventions?.directoryLayout).toBeUndefined();
    expect(derived.conventions?.naming).toBeUndefined();
  });

  it("produces deterministic output for arbitrary manifest and entry orders", () => {
    const evidence1 = {
      rootEntries: ["package.json", "src", "tests"],
      files: ["tests/a.test.ts", "src/a.ts"],
    };
    const evidence2 = {
      rootEntries: ["tests", "src", "package.json"],
      files: ["src/a.ts", "tests/a.test.ts"],
    };
    const manifests = {
      packageJson: JSON.stringify({ scripts: { test: "vitest" } }),
    };

    const res1 = deriveProjectProfile(evidence1, manifests);
    const res2 = deriveProjectProfile(evidence2, manifests);

    expect(res1).toEqual(res2);
  });
});

describe("project profile precedence with derivation", () => {
  const persisted = {
    commands: {
      test: { status: "resolved" as const, value: "npm test" },
      lint: { status: "resolved" as const, value: "npm run lint" },
      build: { status: "resolved" as const, value: "npm run build" },
      run: { status: "resolved" as const, value: "npm start" },
    },
    paths: {
      source: { status: "resolved" as const, value: ["src"] },
      tests: { status: "resolved" as const, value: ["tests"] },
      configuration: {
        status: "not-applicable" as const,
        reason: "No configuration directory.",
      },
    },
    conventions: {
      directoryLayout: {
        status: "resolved" as const,
        value: "Feature folders.",
      },
      naming: { status: "resolved" as const, value: "camelCase" },
      implementationLanguages: {
        status: "resolved" as const,
        value: ["typescript"],
      },
    },
  };

  const derived = {
    commands: {
      test: {
        status: "derived" as const,
        value: "pytest",
        evidence: "pyproject.toml#tool.pytest",
      },
      lint: {
        status: "derived" as const,
        value: "ruff check",
        evidence: "pyproject.toml#tool.ruff",
      },
      build: {
        status: "derived" as const,
        value: "cargo build",
        evidence: "Cargo.toml",
      },
      run: {
        status: "derived" as const,
        value: "cargo run",
        evidence: "Cargo.toml",
      },
    },
    paths: {
      source: {
        status: "derived" as const,
        value: ["lib"],
        evidence: "directory:lib",
      },
      tests: {
        status: "derived" as const,
        value: ["spec"],
        evidence: "directory:spec",
      },
      configuration: {
        status: "derived" as const,
        value: ["config"],
        evidence: "directory:config",
      },
    },
    conventions: {
      implementationLanguages: {
        status: "derived" as const,
        value: ["rust"],
        evidence: "census:rust",
      },
    },
  };

  it("prioritizes explicit > persisted > derived > unresolved", () => {
    const explicit = {
      commands: {
        test: { status: "resolved" as const, value: "pnpm test" },
        lint: { status: "unresolved" as const },
      },
    };

    const resolved = resolveProjectProfile(explicit, persisted, derived);

    expect(resolved.commands.test).toEqual({
      status: "resolved",
      value: "pnpm test",
    });
    expect(resolved.commands.lint).toEqual({ status: "unresolved" });
    expect(resolved.commands.build).toEqual({
      status: "resolved",
      value: "npm run build",
    });
    expect(resolved.commands.run).toEqual({
      status: "resolved",
      value: "npm start",
    });
  });

  it("falls back to derived when persisted is absent", () => {
    const resolved = resolveProjectProfile(undefined, undefined, derived);

    expect(resolved.commands.test).toEqual(derived.commands.test);
    expect(resolved.commands.lint).toEqual(derived.commands.lint);
    expect(resolved.paths.source).toEqual(derived.paths.source);
    expect(resolved.conventions.implementationLanguages).toEqual(
      derived.conventions.implementationLanguages,
    );
    expect(resolved.conventions.directoryLayout).toEqual({
      status: "unresolved",
    });
  });

  it("falls back to unresolved when explicit, persisted, and derived are absent", () => {
    expect(resolveProjectProfile(undefined, undefined, undefined)).toEqual(
      unresolvedProjectProfile(),
    );
  });

  it("lists unresolved profile keys ignoring derived and resolved leaves", () => {
    const profile = resolveProjectProfile(undefined, undefined, derived);

    expect(unresolvedProjectProfileKeys(profile)).toEqual([
      "projectProfile.conventions.directoryLayout",
      "projectProfile.conventions.naming",
    ]);
  });
});
