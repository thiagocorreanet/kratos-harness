import type { StackId, StackProfile } from "./stack.js";

type Host = "claude" | "codex" | "antigravity";

const HOST_RULES_DIRECTORIES: Record<Host, string> = {
  claude: ".claude/rules",
  codex: ".codex/rules",
  antigravity: ".gemini/rules",
};

const STACK_RULES_CONTENT: Record<StackId, readonly string[]> = {
  node: [
    "# Node.js and TypeScript Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Node.js stack.",
    "",
    "- Run tests using the project-configured test runner (e.g. `npm test` or `vitest`).",
    "- Preserve module imports (`import` / `export`) and strict TypeScript types.",
    "- Do not suppress ESLint or TypeScript compiler errors with unapproved ignores.",
    "- Follow existing code formatting and directory layout conventions.",
  ],
  rust: [
    "# Rust Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Rust stack.",
    "",
    "- Run tests with `cargo test` and format checks with `cargo fmt --check`.",
    "- Verify code hygiene with `cargo clippy --all-targets`.",
    "- Prefer idiomatic error handling via `Result` and `Option` over `unwrap()` / `panic!()`.",
    "- Document public APIs with doc comments (`///`).",
  ],
  python: [
    "# Python Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Python stack.",
    "",
    "- Run tests using `pytest` or `python -m unittest`.",
    "- Enforce type hints and lint checks according to repository tooling.",
    "- Use virtual environments and project manifests (`pyproject.toml` / `requirements.txt`).",
    "- Adhere to PEP 8 naming and formatting standards.",
  ],
  go: [
    "# Go Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Go stack.",
    "",
    "- Run tests with `go test ./...` and verify with `go vet ./...`.",
    "- Keep packages focused and handle errors explicitly; do not discard errors with `_`.",
    "- Follow standard Go project layout and formatting (`gofmt`).",
  ],
  dotnet: [
    "# .NET Conventions",
    "",
    "> Managed by Kratos. Scoped to detected .NET stack.",
    "",
    "- Run tests with `dotnet test` and build with `dotnet build`.",
    "- Follow C# / F# naming conventions (PascalCase for public members).",
    "- Treat compiler warnings as errors when configured.",
  ],
  java: [
    "# Java / JVM Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Java/JVM stack.",
    "",
    "- Run tests via Gradle (`./gradlew test`) or Maven (`mvn test`).",
    "- Maintain package structure aligning with directory layout.",
    "- Adhere to project code style guidelines.",
  ],
  php: [
    "# PHP Conventions",
    "",
    "> Managed by Kratos. Scoped to detected PHP stack.",
    "",
    "- Run test suites via `composer test` or `vendor/bin/phpunit`.",
    "- Comply with PSR coding standards (PSR-12).",
    "- Declare strict types (`declare(strict_types=1);`) where customary.",
  ],
  bun: [
    "# Bun Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Bun toolchain.",
    "",
    "- Run tests with `bun test` and scripts with `bun run <script>`.",
    "- Keep `bun.lock` committed so installs stay reproducible.",
    "- Do not mix package managers in one workspace without a recorded reason.",
  ],
  clojure: [
    "# Clojure Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Clojure toolchain.",
    "",
    "- Run tests with `clojure -M:test` or `lein test`, as the project declares.",
    "- Keep aliases and dependencies in `deps.edn` or `project.clj`, not ad hoc.",
    "- Prefer pure functions and explicit namespaces over dynamic reloading tricks.",
  ],
  cmake: [
    "# CMake Conventions",
    "",
    "> Managed by Kratos. Scoped to detected CMake toolchain.",
    "",
    "- Configure and build out of source (`cmake -S . -B build`).",
    "- Run tests with `ctest --test-dir build`.",
    "- Declare targets and their dependencies in `CMakeLists.txt`, not in scripts.",
  ],
  dart: [
    "# Dart Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Dart toolchain.",
    "",
    "- Run tests with `dart test` and static checks with `dart analyze`.",
    "- Keep dependencies and SDK bounds in `pubspec.yaml`.",
    "- Follow `dart format` output rather than hand formatting.",
  ],
  deno: [
    "# Deno Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Deno toolchain.",
    "",
    "- Run tests with `deno test` and lint with `deno lint`.",
    "- Declare tasks, imports, and permissions in `deno.json`.",
    "- Grant the narrowest runtime permissions a task needs.",
  ],
  elixir: [
    "# Elixir Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Elixir toolchain.",
    "",
    "- Run tests with `mix test` and formatting checks with `mix format --check-formatted`.",
    "- Keep dependencies and aliases in `mix.exs`.",
    "- Prefer pattern matching and supervised processes over defensive branching.",
  ],
  erlang: [
    "# Erlang Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Erlang toolchain.",
    "",
    "- Run tests with `rebar3 eunit` and static analysis with `rebar3 dialyzer`.",
    "- Keep applications, dependencies, and profiles in `rebar.config`.",
    "- Let processes fail and be restarted rather than trapping every error.",
  ],
  haskell: [
    "# Haskell Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Haskell toolchain.",
    "",
    "- Run tests with `stack test` or `cabal test`, as the project declares.",
    "- Keep dependencies and language extensions in the Cabal file.",
    "- Prefer total functions and explicit error types over partial ones.",
  ],
  julia: [
    "# Julia Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Julia toolchain.",
    "",
    "- Run tests through the project environment (`julia --project=. test/runtests.jl`).",
    "- Keep dependencies and compatibility bounds in `Project.toml`.",
    "- Keep functions type stable and avoid untyped globals in hot paths.",
  ],
  lua: [
    "# Lua Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Lua toolchain.",
    "",
    "- Run tests with `busted` and static checks with `luacheck .`.",
    "- Declare modules and dependencies in the rockspec.",
    "- Prefer local variables over globals.",
  ],
  perl: [
    "# Perl Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Perl toolchain.",
    "",
    "- Run tests with `prove -lr t`.",
    "- Declare dependencies in `cpanfile` or `Makefile.PL`.",
    "- Enable `strict` and `warnings` in every module.",
  ],
  r: [
    "# R Conventions",
    "",
    "> Managed by Kratos. Scoped to detected R toolchain.",
    "",
    "- Check the package with `R CMD check .`.",
    "- Keep dependencies pinned through `renv.lock` when the project uses it.",
    "- Keep scripts free of absolute paths and interactive state.",
  ],
  scala: [
    "# Scala Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Scala toolchain.",
    "",
    "- Run tests with `sbt test` and compile with `sbt compile`.",
    "- Keep dependencies and cross versions in `build.sbt`.",
    "- Prefer immutable data and total functions over exceptions.",
  ],
  swift: [
    "# Swift Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Swift toolchain.",
    "",
    "- Run tests with `swift test` and build with `swift build`.",
    "- Declare targets and dependencies in `Package.swift`.",
    "- Prefer `Result` and typed errors over force unwrapping.",
  ],
  zig: [
    "# Zig Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Zig toolchain.",
    "",
    "- Run tests with `zig build test` and build with `zig build`.",
    "- Declare steps and dependencies in `build.zig`.",
    "- Handle errors explicitly with error unions rather than discarding them.",
  ],
  ruby: [
    "# Ruby Conventions",
    "",
    "> Managed by Kratos. Scoped to detected Ruby stack.",
    "",
    "- Run tests using `bundle exec rake test` or `bundle exec rspec`.",
    "- Adhere to standard Ruby style guides and linter rules (e.g. RuboCop).",
  ],
};

/**
 * Returns the markdown body for a given stack rule.
 */
export function renderStackRuleContent(stackId: StackId): string {
  const lines = STACK_RULES_CONTENT[stackId];
  return `${lines.join("\n")}\n`;
}

/**
 * Generates rules files for a given host and detected stack profile.
 * Emits zero files if the stack profile is unrecognized.
 */
export function generateHostStackRules(
  host: Host,
  profile: StackProfile,
): readonly (readonly [path: string, content: string])[] {
  if (profile.unrecognized || profile.stacks.length === 0) {
    return Object.freeze([]);
  }

  const directory = HOST_RULES_DIRECTORIES[host];

  const results: (readonly [string, string])[] = [];
  for (const stack of profile.stacks) {
    const path = `${directory}/${stack.id}.md`;
    const content = renderStackRuleContent(stack.id);
    results.push([path, content]);
  }

  return Object.freeze(
    results.sort(([left], [right]) => (left < right ? -1 : 1)),
  );
}
