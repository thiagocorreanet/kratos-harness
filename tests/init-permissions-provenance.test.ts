import { describe, expect, it } from "vitest";
import {
  deriveHostPermissions,
  assertPermissionProvenance,
  profileStack,
  type StackProfile,
  unresolvedProjectProfile,
  type ResolvedAnswers,
} from "@kratos/runtime/domain/init";

function mockAnswers(
  overrides: Partial<ResolvedAnswers> = {},
): ResolvedAnswers {
  return {
    contractVersion: "1.5.0",
    hostContract: "1.4.0",
    hosts: ["claude", "codex"],
    language: {
      conversation: "en",
      documentation: "en",
      comments: "en",
      identifiers: "en",
      commits: "en",
      preserveConventions: true,
      enforcement: "advisory",
    },
    policyMode: "standard",
    gateModes: {},
    snapshots: true,
    modelRoles: {},
    projectProfile: unresolvedProjectProfile(),
    ...overrides,
  };
}

describe("permission allowlist derivation and strict provenance", () => {
  it("derives git read-only permissions when git repository is present", () => {
    const profile: StackProfile = { stacks: [], unrecognized: true };
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: true });

    expect(result.allow).toContain("Bash(git status)");
    expect(result.allow).toContain("Bash(git diff)");
    expect(result.allow).toContain("Bash(git log)");
  });

  it("does not derive git permissions when git repository is absent", () => {
    const profile: StackProfile = { stacks: [], unrecognized: true };
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow.some((p) => p.includes("git"))).toBe(false);
  });

  it("derives npm permissions for a detected Node stack", () => {
    const profile = profileStack({ rootEntries: ["package.json"] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow).toContain("Bash(npm test)");
    expect(result.allow).toContain("Bash(npm run lint)");
    expect(result.allow).toContain("Bash(npm run build)");
  });

  it("derives cargo permissions for a detected Rust stack", () => {
    const profile = profileStack({ rootEntries: ["Cargo.toml"] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow).toContain("Bash(cargo test)");
    expect(result.allow).toContain("Bash(cargo check)");
    expect(result.allow).toContain("Bash(cargo clippy)");
  });

  it("derives pytest permissions for a detected Python stack", () => {
    const profile = profileStack({ rootEntries: ["pyproject.toml"] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow).toContain("Bash(pytest)");
  });

  it("derives go permissions for a detected Go stack", () => {
    const profile = profileStack({ rootEntries: ["go.mod"] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow).toContain("Bash(go test ./...)");
    expect(result.allow).toContain("Bash(go vet ./...)");
  });

  it("derives permissions for explicit project profile commands", () => {
    const profile: StackProfile = { stacks: [], unrecognized: true };
    const answers = mockAnswers({
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "make test-unit" },
          lint: { status: "resolved", value: "make lint-all" },
          build: { status: "unresolved" },
          run: { status: "not-applicable", reason: "library" },
        },
        paths: {
          source: { status: "unresolved" },
          tests: { status: "unresolved" },
          configuration: { status: "unresolved" },
        },
        conventions: {
          directoryLayout: { status: "unresolved" },
          naming: { status: "unresolved" },
          implementationLanguages: { status: "unresolved" },
        },
      },
    });
    const result = deriveHostPermissions(answers, profile, { hasGit: false });

    expect(result.allow).toContain("Bash(make test-unit)");
    expect(result.allow).toContain("Bash(make lint-all)");
  });

  it("asserts provenance for all derived permissions and throws on unproven allowances", () => {
    const profile = profileStack({ rootEntries: ["package.json"] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: true });

    // All derived permissions must pass provenance validation
    for (const entry of result.provenance) {
      expect(() => {
        assertPermissionProvenance(entry, answers, profile, { hasGit: true });
      }).not.toThrow();
    }

    // An invented allowance must fail provenance validation
    const invented = {
      permission: "Bash(rm -rf /)",
      origin: "invalid_origin" as unknown as "git",
      evidence: "none",
    };

    expect(() => {
      assertPermissionProvenance(invented, answers, profile, { hasGit: true });
    }).toThrow(/PERMISSION_WITHOUT_PROVENANCE/);
  });
});
