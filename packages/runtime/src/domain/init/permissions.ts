import type { ResolvedAnswers } from "./answers.js";
import type { StackId, StackProfile } from "./stack.js";

export type PermissionOrigin =
  "git" | "stack" | "explicit_profile" | "derived_profile";

export interface PermissionProvenance {
  readonly permission: string;
  readonly origin: PermissionOrigin;
  readonly evidence: string;
}

export interface HostPermissionsResult {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly provenance: readonly PermissionProvenance[];
}

export interface GitEvidence {
  readonly hasGit: boolean;
}

const STACK_TOOLCHAIN_COMMANDS: Record<StackId, readonly string[]> = {
  node: ["npm test", "npm run lint", "npm run build"],
  rust: ["cargo test", "cargo check", "cargo clippy"],
  python: ["pytest", "python -m unittest"],
  go: ["go test ./...", "go vet ./..."],
  dotnet: ["dotnet test", "dotnet build"],
  java: ["gradle test", "mvn test"],
  php: ["composer test", "vendor/bin/phpunit"],
  ruby: ["bundle exec rake test", "bundle exec rspec"],
  bun: ["bun test", "bun run build"],
  clojure: ["clojure -M:test", "lein test"],
  cmake: ["cmake -S . -B build", "ctest --test-dir build"],
  dart: ["dart test", "dart analyze"],
  deno: ["deno test", "deno lint"],
  elixir: ["mix test", "mix format --check-formatted"],
  erlang: ["rebar3 eunit", "rebar3 dialyzer"],
  haskell: ["stack test", "cabal test"],
  julia: ["julia --project=. test/runtests.jl"],
  lua: ["busted", "luacheck ."],
  perl: ["prove -lr t"],
  r: ["R CMD check ."],
  scala: ["sbt test", "sbt compile"],
  swift: ["swift test", "swift build"],
  zig: ["zig build test", "zig build"],
};

const GIT_COMMANDS: readonly string[] = ["git status", "git diff", "git log"];

/**
 * Derives a deterministic permission allowlist from verified evidence.
 * No permission is ever generated without strict provenance.
 */
export function deriveHostPermissions(
  answers: ResolvedAnswers,
  profile: StackProfile,
  gitEvidence: GitEvidence = { hasGit: true },
): HostPermissionsResult {
  const provenance: PermissionProvenance[] = [];
  const allowSet = new Set<string>();

  // 1. Git inspection provenance
  if (gitEvidence.hasGit) {
    for (const cmd of GIT_COMMANDS) {
      const perm = `Bash(${cmd})`;
      if (!allowSet.has(perm)) {
        allowSet.add(perm);
        provenance.push({
          permission: perm,
          origin: "git",
          evidence: ".git",
        });
      }
    }
  }

  // 2. Detected Stack Toolchain provenance
  for (const detected of profile.stacks) {
    const commands = STACK_TOOLCHAIN_COMMANDS[detected.id];
    for (const cmd of commands) {
      const perm = `Bash(${cmd})`;
      if (!allowSet.has(perm)) {
        allowSet.add(perm);
        provenance.push({
          permission: perm,
          origin: "stack",
          evidence: `${detected.id}:${detected.evidence}`,
        });
      }
    }
  }

  // 3. Project profile command provenance. A resolved command is one the
  // operator stated; a derived command is one the runtime read from a manifest
  // and the host recorded without asking, so its allowance traces to the
  // evidence string rather than to a confirmation.
  for (const slot of profileCommandSlots(answers)) {
    if (slot.status !== "resolved" && slot.status !== "derived") continue;
    const command = slot.value.trim();
    if (command.length === 0) continue;
    const perm = `Bash(${command})`;
    if (allowSet.has(perm)) continue;
    allowSet.add(perm);
    provenance.push(
      slot.status === "resolved"
        ? { permission: perm, origin: "explicit_profile", evidence: command }
        : {
            permission: perm,
            origin: "derived_profile",
            evidence: slot.evidence,
          },
    );
  }

  const allow = [...allowSet].sort(compareText);

  // Assert provenance for all generated entries before returning
  for (const entry of provenance) {
    assertPermissionProvenance(entry, answers, profile, gitEvidence);
  }

  return Object.freeze({
    allow: Object.freeze(allow),
    deny: Object.freeze([]),
    provenance: Object.freeze(provenance),
  });
}

/**
 * Validates that a permission entry traces directly to a recognized origin.
 * Fails fast if any permission lacks legitimate provenance.
 */
export function assertPermissionProvenance(
  entry: PermissionProvenance,
  answers: ResolvedAnswers,
  profile: StackProfile,
  gitEvidence: GitEvidence,
): void {
  switch (entry.origin) {
    case "git": {
      if (
        !gitEvidence.hasGit ||
        !GIT_COMMANDS.some((cmd) => entry.permission === `Bash(${cmd})`)
      ) {
        throw new Error(
          `PERMISSION_WITHOUT_PROVENANCE: Git permission '${entry.permission}' is invalid.`,
        );
      }
      return;
    }
    case "stack": {
      const matchedStack = profile.stacks.find((s) =>
        entry.evidence.startsWith(`${s.id}:`),
      );
      if (!matchedStack) {
        throw new Error(
          `PERMISSION_WITHOUT_PROVENANCE: Stack permission '${entry.permission}' has no detected stack.`,
        );
      }
      const validCommands = STACK_TOOLCHAIN_COMMANDS[matchedStack.id];
      if (!validCommands.some((cmd) => entry.permission === `Bash(${cmd})`)) {
        throw new Error(
          `PERMISSION_WITHOUT_PROVENANCE: Toolchain command '${entry.permission}' not allowed for stack '${matchedStack.id}'.`,
        );
      }
      return;
    }
    case "explicit_profile": {
      const stated = profileCommandSlots(answers).some(
        (slot) =>
          slot.status === "resolved" &&
          entry.permission === `Bash(${slot.value.trim()})`,
      );
      if (!stated) {
        throw new Error(
          `PERMISSION_WITHOUT_PROVENANCE: Explicit command '${entry.permission}' not found in resolved profile.`,
        );
      }
      return;
    }
    case "derived_profile": {
      const derived = profileCommandSlots(answers).some(
        (slot) =>
          slot.status === "derived" &&
          entry.permission === `Bash(${slot.value.trim()})` &&
          entry.evidence === slot.evidence,
      );
      if (!derived) {
        throw new Error(
          `PERMISSION_WITHOUT_PROVENANCE: Derived command '${entry.permission}' does not carry the evidence the profile recorded.`,
        );
      }
      return;
    }
    default: {
      const unknownOrigin: never = entry.origin;
      throw new Error(
        `PERMISSION_WITHOUT_PROVENANCE: Unknown permission origin '${String(unknownOrigin)}'.`,
      );
    }
  }
}

function profileCommandSlots(answers: ResolvedAnswers) {
  const commands = answers.projectProfile.commands;
  return [commands.test, commands.lint, commands.build, commands.run];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
