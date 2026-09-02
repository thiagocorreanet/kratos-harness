import {
  profileStack,
  SCAN_EXCLUDED_DIRECTORIES,
  STACK_IDS,
  type StackId,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

describe("toolchain markers", () => {
  it.each([
    ["package.json", "node"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["setup.py", "python"],
    ["Pipfile", "python"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "java"],
    ["settings.gradle", "java"],
    ["Gemfile", "ruby"],
    ["composer.json", "php"],
    ["Runtime.csproj", "dotnet"],
    ["Runtime.fsproj", "dotnet"],
    ["Runtime.sln", "dotnet"],
    ["mix.exs", "elixir"],
    ["rebar.config", "erlang"],
    ["pubspec.yaml", "dart"],
    ["Package.swift", "swift"],
    ["build.sbt", "scala"],
    ["deps.edn", "clojure"],
    ["project.clj", "clojure"],
    ["CMakeLists.txt", "cmake"],
    ["deno.json", "deno"],
    ["bun.lockb", "bun"],
    ["stack.yaml", "haskell"],
    ["runtime.cabal", "haskell"],
    ["build.zig", "zig"],
    ["runtime.rockspec", "lua"],
    ["Project.toml", "julia"],
    ["cpanfile", "perl"],
    ["renv.lock", "r"],
  ])("recognizes %s as %s", (entry, id) => {
    const profile = profileStack({ rootEntries: [entry, "README.md"] });

    // The evidence travels with the verdict: a profile that names a stack
    // without naming why is a profile nobody can check.
    expect(profile.stacks).toEqual([{ id, evidence: entry }]);
    expect(profile.unrecognized).toBe(false);
  });

  it("reports every toolchain a polyglot repository shows", () => {
    const profile = profileStack({
      rootEntries: ["go.mod", "package.json", "Cargo.toml"],
    });

    // Ordered by identifier rather than by directory listing, so two runs on
    // two machines write the same profile.
    expect(profile.stacks.map(({ id }) => id)).toEqual(["go", "node", "rust"]);
  });

  it("names one marker per toolchain even when several match", () => {
    const profile = profileStack({
      rootEntries: ["requirements.txt", "pyproject.toml"],
    });

    expect(profile.stacks).toEqual([
      { id: "python", evidence: "pyproject.toml" },
    ]);
  });

  it("does not read a bare suffix as a project file", () => {
    // `.csproj` alone is a hidden file, not a project named nothing.
    const profile = profileStack({ rootEntries: [".csproj"] });

    expect(profile.stacks).toEqual([]);
    expect(profile.unrecognized).toBe(true);
  });

  it("is total and order-independent", () => {
    const entries = [
      "Cargo.toml",
      "Gemfile",
      "README.md",
      "Runtime.sln",
      "go.mod",
      "package.json",
    ];
    const forward = profileStack({ rootEntries: entries });
    const reversed = profileStack({ rootEntries: [...entries].reverse() });

    expect(reversed).toEqual(forward);
    expect(forward.stacks).toHaveLength(5);
  });

  it("breaks Unicode collation ties independently of root-entry order", () => {
    const composed = "Caf\u00e9.csproj";
    const decomposed = "Cafe\u0301.csproj";

    const forward = profileStack({ rootEntries: [composed, decomposed] });
    const reversed = profileStack({ rootEntries: [decomposed, composed] });

    expect(reversed).toEqual(forward);
    expect(forward.stacks).toEqual([{ id: "dotnet", evidence: decomposed }]);
  });

  it("enumerates every toolchain the marker tables can name", () => {
    // The identifiers are what the rules and permission tables are keyed by,
    // so a marker that names a toolchain nobody enumerated is a rules file
    // that never gets written.
    expect([...STACK_IDS]).toEqual([...STACK_IDS].sort());
    expect(new Set(STACK_IDS).size).toBe(STACK_IDS.length);
    expect(STACK_IDS).toContain<StackId>("elixir");
  });
});

describe("language census", () => {
  it("identifies a language that has no recognized manifest", () => {
    // AC-1: loose sources with no build system are still a project written in
    // something, and that is the question the census answers.
    const profile = profileStack({
      rootEntries: ["lib", "README.md"],
      files: ["lib/mailer.ex", "lib/queue.ex", "README.md"],
    });

    expect(profile.languages).toEqual([
      { id: "elixir", files: 2, evidence: "lib/mailer.ex" },
    ]);
    expect(profile.stacks).toEqual([]);
    expect(profile.unrecognized).toBe(false);
  });

  it("orders languages by file count and breaks ties by identifier", () => {
    const profile = profileStack({
      rootEntries: ["src"],
      files: ["src/a.rs", "src/b.rs", "src/c.rs", "src/one.go", "src/two.py"],
    });

    expect(
      profile.languages.map(({ id, files }) => `${id}:${String(files)}`),
    ).toEqual(["rust:3", "go:1", "python:1"]);
  });

  it("reports the language and the toolchain as separate facts", () => {
    // AC-6: a toolchain with no source yet is a freshly scaffolded project,
    // and a language with no toolchain is a directory of scripts. The profile
    // has to be able to say either.
    const scaffolded = profileStack({ rootEntries: ["pubspec.yaml"] });
    const scripts = profileStack({
      rootEntries: ["tools"],
      files: ["tools/report.swift"],
    });

    expect(scaffolded.stacks).toEqual([
      { id: "dart", evidence: "pubspec.yaml" },
    ]);
    expect(scaffolded.languages).toEqual([]);
    expect(scripts.stacks).toEqual([]);
    expect(scripts.languages).toEqual([
      { id: "swift", files: 1, evidence: "tools/report.swift" },
    ]);
  });

  it("reads a language and its toolchain together", () => {
    // AC-2
    const elixir = profileStack({
      rootEntries: ["mix.exs", "lib"],
      files: ["mix.exs", "lib/app.ex"],
    });
    const dart = profileStack({
      rootEntries: ["pubspec.yaml", "lib"],
      files: ["pubspec.yaml", "lib/main.dart"],
    });
    const swift = profileStack({
      rootEntries: ["Package.swift", "Sources"],
      files: ["Package.swift", "Sources/App/main.swift"],
    });

    expect(elixir.stacks).toEqual([{ id: "elixir", evidence: "mix.exs" }]);
    expect(elixir.languages.map(({ id }) => id)).toEqual(["elixir"]);
    expect(dart.stacks).toEqual([{ id: "dart", evidence: "pubspec.yaml" }]);
    expect(dart.languages.map(({ id }) => id)).toEqual(["dart"]);
    expect(swift.stacks).toEqual([{ id: "swift", evidence: "Package.swift" }]);
    expect(swift.languages.map(({ id }) => id)).toEqual(["swift"]);
  });

  it("counts an extension whatever case it was written in", () => {
    const profile = profileStack({
      rootEntries: ["analysis"],
      files: ["analysis/model.R", "analysis/plot.r"],
    });

    expect(profile.languages).toEqual([
      { id: "r", files: 2, evidence: "analysis/model.R" },
    ]);
  });

  it("reads a dotfile as a name rather than as an extension", () => {
    const profile = profileStack({
      rootEntries: [".gitignore", ".env"],
    });

    expect(profile.languages).toEqual([]);
    expect(profile.unrecognized).toBe(true);
  });
});

describe("nested evidence", () => {
  it("finds a manifest that is not at the root", () => {
    // AC-3
    const profile = profileStack({
      rootEntries: ["src"],
      files: ["src/Api/Api.csproj", "src/Api/Program.cs"],
    });

    expect(profile.stacks).toEqual([
      { id: "dotnet", evidence: "src/Api/Api.csproj" },
    ]);
    expect(profile.languages).toEqual([
      { id: "csharp", files: 1, evidence: "src/Api/Program.cs" },
    ]);
  });

  it("reports each toolchain of a monorepo, deterministically ordered", () => {
    // AC-4
    const files = ["apps/web/package.json", "services/api/go.mod"];
    const forward = profileStack({ rootEntries: ["apps", "services"], files });
    const reversed = profileStack({
      rootEntries: ["services", "apps"],
      files: [...files].reverse(),
    });

    expect(forward.stacks).toEqual([
      { id: "go", evidence: "services/api/go.mod" },
      { id: "node", evidence: "apps/web/package.json" },
    ]);
    expect(reversed).toEqual(forward);
  });

  it("prefers a root marker over a nested one for the same toolchain", () => {
    const profile = profileStack({
      rootEntries: ["package.json", "apps"],
      files: ["apps/web/package.json", "package.json"],
    });

    expect(profile.stacks).toEqual([{ id: "node", evidence: "package.json" }]);
  });

  it("prefers the shallower of two nested markers, then the earlier path", () => {
    const profile = profileStack({
      rootEntries: ["services"],
      files: ["services/api/go.mod", "services/go.mod", "services/z/go.mod"],
    });

    expect(profile.stacks).toEqual([{ id: "go", evidence: "services/go.mod" }]);
  });

  it("never counts a file inside an excluded directory", () => {
    // AC-7: a vendored dependency tree is somebody else's project.
    const files = SCAN_EXCLUDED_DIRECTORIES.map(
      (directory) => `${directory}/left/over.rs`,
    );
    const profile = profileStack({
      rootEntries: [...SCAN_EXCLUDED_DIRECTORIES, "README.md"],
      files: [...files, "node_modules/left/package.json"],
    });

    expect(profile.languages).toEqual([]);
    expect(profile.stacks).toEqual([]);
    expect(profile.observed.rootEntries).toEqual(["README.md"]);
  });

  it("counts a file whose own name matches an excluded directory", () => {
    // `build` the directory is output; `build.zig` and `src/build.rs` are
    // source somebody wrote.
    const profile = profileStack({
      rootEntries: ["build.zig", "src"],
      files: ["build.zig", "src/build.rs"],
    });

    expect(profile.stacks).toEqual([{ id: "zig", evidence: "build.zig" }]);
    expect(profile.languages).toEqual([
      { id: "rust", files: 1, evidence: "src/build.rs" },
      { id: "zig", files: 1, evidence: "build.zig" },
    ]);
  });

  it("ignores a path it cannot read as project-relative", () => {
    const profile = profileStack({
      rootEntries: ["", "/etc/passwd", "src//main.go", "./go.mod"],
    });

    expect(profile.stacks).toEqual([{ id: "go", evidence: "go.mod" }]);
  });
});

describe("unidentified projects", () => {
  it("reports what it saw rather than nothing", () => {
    // AC-5
    const profile = profileStack({
      rootEntries: ["bar.config", "src"],
      files: ["src/one.foo", "src/two.foo", "src/three.bar", "bar.config"],
    });

    expect(profile.unrecognized).toBe(true);
    expect(profile.observed.extensions).toEqual([
      { extension: ".foo", files: 2 },
      { extension: ".bar", files: 1 },
      { extension: ".config", files: 1 },
    ]);
    expect(profile.observed.rootEntries).toEqual(["bar.config", "src"]);
  });

  it("bounds the evidence it reports about a large unnamed tree", () => {
    const rootEntries = Array.from(
      { length: 40 },
      (_, index) => `entry-${String(index).padStart(2, "0")}`,
    );
    const files = Array.from(
      { length: 30 },
      (_, index) => `sources/file.ext${String(index).padStart(2, "0")}`,
    );
    const profile = profileStack({ rootEntries, files });

    expect(profile.observed.rootEntries).toHaveLength(16);
    expect(profile.observed.extensions).toHaveLength(8);
  });

  it("says when the scan stopped short of the whole tree", () => {
    // AC-9: a partial profile that reads as a complete one is how a reader
    // concludes a language is absent when the walk never reached it.
    const complete = profileStack({ rootEntries: ["package.json"] });
    const partial = profileStack({
      rootEntries: ["package.json"],
      truncated: true,
    });

    expect(complete.partial).toBe(false);
    expect(partial.partial).toBe(true);
    expect(partial.stacks).toEqual(complete.stacks);
  });

  it("is a pure function of the listing it was handed", () => {
    // AC-8: the same tree yields the same profile, whichever machine and
    // whenever it was observed.
    const evidence = {
      rootEntries: ["apps", "mix.exs"],
      files: ["apps/web/app.ex", "apps/web/page.exs", "mix.exs"],
    };

    expect(profileStack(evidence)).toEqual(profileStack(evidence));
    expect(Object.isFrozen(profileStack(evidence))).toBe(true);
  });
});
