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
