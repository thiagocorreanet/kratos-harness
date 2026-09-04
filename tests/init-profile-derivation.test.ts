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

  it("names the package manager the lockfile at the root attests to", () => {
    // `npm test` on a pnpm project is the wrong command, and a wrong command
    // that is recorded without being put to the operator is granted an
    // allowance nobody checked.
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          build: "next build",
          start: "next start",
        },
      }),
    };

    const pnpm = deriveProjectProfile(
      { rootEntries: ["package.json", "pnpm-lock.yaml"] },
      manifests,
    );
    expect(pnpm.commands).toEqual({
      test: {
        status: "derived",
        value: "pnpm test",
        evidence: "package.json#scripts.test via pnpm-lock.yaml",
      },
      lint: {
        status: "derived",
        value: "pnpm run lint",
        evidence: "package.json#scripts.lint via pnpm-lock.yaml",
      },
      build: {
        status: "derived",
        value: "pnpm run build",
        evidence: "package.json#scripts.build via pnpm-lock.yaml",
      },
      run: {
        status: "derived",
        value: "pnpm start",
        evidence: "package.json#scripts.start via pnpm-lock.yaml",
      },
    });

    const yarn = deriveProjectProfile(
      { rootEntries: ["package.json", "yarn.lock"] },
      manifests,
    );
    expect(yarn.commands?.test).toEqual({
      status: "derived",
      value: "yarn test",
      evidence: "package.json#scripts.test via yarn.lock",
    });
    expect(
      yarn.commands?.lint?.status === "derived" && yarn.commands.lint.value,
    ).toBe("yarn run lint");

    // `bun test` is Bun's own runner, not the declared script, so every slot
    // goes through `bun run`.
    const bun = deriveProjectProfile(
      { rootEntries: ["package.json", "bun.lockb"] },
      manifests,
    );
    expect(bun.commands).toEqual({
      test: {
        status: "derived",
        value: "bun run test",
        evidence: "package.json#scripts.test via bun.lockb",
      },
      lint: {
        status: "derived",
        value: "bun run lint",
        evidence: "package.json#scripts.lint via bun.lockb",
      },
      build: {
        status: "derived",
        value: "bun run build",
        evidence: "package.json#scripts.build via bun.lockb",
      },
      run: {
        status: "derived",
        value: "bun run start",
        evidence: "package.json#scripts.start via bun.lockb",
      },
    });

    const npm = deriveProjectProfile(
      { rootEntries: ["package.json", "package-lock.json"] },
      manifests,
    );
    expect(npm.commands?.test).toEqual({
      status: "derived",
      value: "npm test",
      evidence: "package.json#scripts.test via package-lock.json",
    });
  });

  it("lets the packageManager field outrank the lockfile", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        packageManager: "pnpm@9.12.0+sha512.abc",
        scripts: { test: "vitest run" },
      }),
    };

    const derived = deriveProjectProfile(
      { rootEntries: ["package.json", "package-lock.json"] },
      manifests,
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "pnpm test",
      evidence: "package.json#scripts.test via package.json#packageManager",
    });
  });

  it("derives no command from package.json when two lockfiles disagree", () => {
    // Two lockfiles admit two readings that produce different commands, and
    // that is the operator's call, not a coin the runtime flips.
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        scripts: { test: "vitest run", lint: "eslint ." },
      }),
    };

    const derived = deriveProjectProfile(
      { rootEntries: ["package.json", "pnpm-lock.yaml", "package-lock.json"] },
      manifests,
    );

    expect(derived.commands).toBeUndefined();
  });

  it("ignores a packageManager field naming a manager it does not know", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({
        packageManager: "volta@1.0.0",
        scripts: { test: "vitest run" },
      }),
    };

    const derived = deriveProjectProfile(
      { rootEntries: ["package.json", "yarn.lock"] },
      manifests,
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "yarn test",
      evidence: "package.json#scripts.test via yarn.lock",
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

  it("derives a source directory that sits below a component directory", () => {
    const evidence = {
      rootEntries: ["apps", "platform", "Api.sln"],
      files: [
        "apps/backend/src/Program.cs",
        "apps/backend/src/Startup.cs",
        "platform/ci/pipeline.yml",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["apps/backend/src"],
      evidence: "directory:apps/backend/src (nested)",
    });
  });

  it("derives every source root a monorepo has rather than only the first", () => {
    const evidence = {
      rootEntries: ["services", "package.json"],
      files: [
        "services/api/src/index.ts",
        "services/api/src/router.ts",
        "services/api/src/store.ts",
        "services/web/src/main.ts",
        "services/web/src/app.ts",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["services/api/src", "services/web/src"],
      evidence:
        "directory:services/api/src (nested), services/web/src (nested)",
    });
  });

  it("does not offer a directory of operational scripts as source code", () => {
    const sources = Array.from(
      { length: 30 },
      (_unused, index) => `services/api/src/Handler${String(index)}.cs`,
    );
    const evidence = {
      rootEntries: ["app", "services", "Api.sln"],
      files: [...sources, "app/deploy.sh", "app/rotate-secrets.sh"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["services/api/src"],
      evidence: "directory:services/api/src (nested)",
    });
  });

  it("prefers the enclosing candidate to the ones it already contains", () => {
    const evidence = {
      rootEntries: ["packages", "package.json"],
      files: ["packages/core/src/index.ts", "packages/cli/src/main.ts"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toEqual({
      status: "derived",
      value: ["packages"],
      evidence: "directory:packages",
    });
  });

  it("derives nested test directories alongside the source they cover", () => {
    const evidence = {
      rootEntries: ["apps"],
      files: [
        "apps/backend/src/Program.cs",
        "apps/backend/tests/ProgramTests.cs",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.tests).toEqual({
      status: "derived",
      value: ["apps/backend/tests"],
      evidence: "directory:apps/backend/tests (nested)",
    });
  });

  it("does not offer a directory below the tests as source code", () => {
    // `tests/unit/lib` carries a source candidate name, but a `lib` that sits
    // below `tests` mirrors the source tree rather than being one, and naming
    // it as a second source root also hid the layout of the real one.
    const evidence = {
      rootEntries: ["src", "tests", "package.json"],
      files: [
        "src/lib/parse-order.ts",
        "src/lib/user-store.ts",
        "src/lib/http-server.ts",
        "src/index.ts",
        "tests/unit/lib/parse-order.test.ts",
        "tests/unit/lib/user-store.test.ts",
      ],
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
    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value:
        "Place new source under `src/` at the repository root and its tests in the sibling `tests/` directory.",
      evidence: "layout:root src; 4 source files, 2 test files",
    });
  });

  it("asks about paths when a truncated scan saw no candidate directory", () => {
    const evidence = {
      rootEntries: ["README.md"],
      files: ["README.md"],
      truncated: true,
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths).toBeUndefined();
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
    // Three names, none of them discriminating, attest to no casing.
    expect(derived.conventions?.naming).toBeUndefined();
  });

  it("derives the layout of a monorepo from the shape its components repeat", () => {
    const evidence = {
      rootEntries: ["apps", "Api.sln"],
      files: [
        "apps/backend/src/Program.cs",
        "apps/backend/src/OrderService.cs",
        "apps/backend/tests/OrderServiceTests.cs",
        "apps/worker/src/Worker.cs",
        "apps/worker/src/QueueReader.cs",
        "apps/worker/tests/WorkerTests.cs",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value:
        "Place new source in `<component>/src/` below `apps/`, and its tests in `<component>/tests/`.",
      evidence: "layout:2 components under apps; 4 source files, 2 test files",
    });
    expect(derived.conventions?.naming).toEqual({
      status: "derived",
      value:
        "Name new files in PascalCase, as the csharp files in this project already are.",
      evidence: "naming:PascalCase on 6 of 6 csharp files",
    });
  });

  it("describes components that sit at the repository root", () => {
    const evidence = {
      rootEntries: ["backend", "worker"],
      files: [
        "backend/src/handler.ts",
        "backend/src/router.ts",
        "backend/tests/handler.test.ts",
        "worker/src/queue.ts",
        "worker/src/runner.ts",
        "worker/tests/queue.test.ts",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value:
        "Place new source in `<component>/src/`, one directory per component at the repository root, and its tests in `<component>/tests/`.",
      evidence:
        "layout:2 components under the root; 4 source files, 2 test files",
    });
  });

  it("derives a root layout and says where its tests sit", () => {
    const evidence = {
      rootEntries: ["src", "tests", "package.json"],
      files: [
        "src/parse-order.ts",
        "src/user-store.ts",
        "src/http-server.ts",
        "src/index.ts",
        "tests/parse-order.test.ts",
        "tests/user-store.test.ts",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value:
        "Place new source under `src/` at the repository root and its tests in the sibling `tests/` directory.",
      evidence: "layout:root src; 4 source files, 2 test files",
    });
    // A single-word lowercase name is compatible with kebab-case, so it
    // supports the convention the separated names attest to.
    expect(derived.conventions?.naming).toEqual({
      status: "derived",
      value:
        "Name new files in kebab-case, as the typescript files in this project already are.",
      evidence: "naming:kebab-case on 6 of 6 typescript files",
    });
  });

  it("says tests sit beside the code when no test directory holds them", () => {
    const evidence = {
      rootEntries: ["src", "pyproject.toml"],
      files: [
        "src/parse_order.py",
        "src/user_store.py",
        "src/http_server.py",
        "src/queue_reader.py",
        "src/test_parse_order.py",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value:
        "Place new source under `src/` at the repository root and its tests beside the code they cover.",
      evidence: "layout:root src; 5 source files",
    });
    expect(derived.conventions?.naming).toEqual({
      status: "derived",
      value:
        "Name new files in snake_case, as the python files in this project already are.",
      evidence: "naming:snake_case on 5 of 5 python files",
    });
  });

  it("asks about naming when the observed file names are split between casings", () => {
    const evidence = {
      rootEntries: ["src", "package.json"],
      files: [
        "src/parse-order.ts",
        "src/other-thing.ts",
        "src/UserStore.ts",
        "src/OrderThing.ts",
        "src/httpServer.ts",
        "src/api_client.ts",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.naming).toBeUndefined();
    expect(derived.conventions?.directoryLayout).toEqual({
      status: "derived",
      value: "Place new source under `src/` at the repository root.",
      evidence: "layout:root src; 6 source files",
    });
  });

  it("asks about naming when too few names were observed to call it a convention", () => {
    const evidence = {
      rootEntries: ["src", "package.json"],
      files: ["src/parse-order.ts", "src/user-store.ts", "src/http-server.ts"],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.naming).toBeUndefined();
  });

  it("measures naming on the language the census counted most", () => {
    const evidence = {
      rootEntries: ["src"],
      files: [
        "src/OrderService.cs",
        "src/UserRepository.cs",
        "src/Program.cs",
        "src/QueueReader.cs",
        "src/HttpClientFactory.cs",
        "src/deploy_release.sh",
        "src/rotate_secrets.sh",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.conventions?.naming).toEqual({
      status: "derived",
      value:
        "Name new files in PascalCase, as the csharp files in this project already are.",
      evidence: "naming:PascalCase on 5 of 5 csharp files",
    });
  });

  it("asks about naming rather than answering off a smaller language", () => {
    const evidence = {
      rootEntries: ["src"],
      files: [
        "src/order-service.ts",
        "src/UserStore.ts",
        "src/httpServer.ts",
        "src/queue_reader.ts",
        "src/OrderThing.ts",
        "src/other-thing.ts",
        "src/deploy_release.sh",
        "src/rotate_secrets.sh",
        "src/publish_bundle.sh",
        "src/tag_release.sh",
        "src/sign_artifact.sh",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    // The project is written in TypeScript and its TypeScript names disagree.
    // The shell scripts are consistent, and answering with their convention
    // would instruct an agent writing TypeScript in the shell one.
    expect(derived.conventions?.naming).toBeUndefined();
  });

  it("asks about the layout when the source directories share no shape", () => {
    const evidence = {
      rootEntries: ["services"],
      files: [
        "services/api/src/handler.ts",
        "services/api/src/router.ts",
        "services/worker/lib/queue.ts",
        "services/worker/lib/runner.ts",
      ],
    };

    const derived = deriveProjectProfile(evidence, {});

    expect(derived.paths?.source).toBeDefined();
    expect(derived.conventions?.directoryLayout).toBeUndefined();
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
