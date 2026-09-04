import { describe, expect, it } from "vitest";
import {
  deriveHostPermissions,
  assertPermissionProvenance,
  profileStack,
  STACK_IDS,
  type StackProfile,
  unresolvedProjectProfile,
  type ResolvedAnswers,
} from "@kratos/runtime/domain/init";

function mockAnswers(
  overrides: Partial<ResolvedAnswers> = {},
): ResolvedAnswers {
  return {
    contractVersion: "1.6.0",
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
    const profile: StackProfile = profileStack({ rootEntries: [] });
    const answers = mockAnswers();
    const result = deriveHostPermissions(answers, profile, { hasGit: true });

    expect(result.allow).toContain("Bash(git status)");
    expect(result.allow).toContain("Bash(git diff)");
    expect(result.allow).toContain("Bash(git log)");
  });

  it("derives a toolchain permission for every detected stack", () => {
    // AC-10: detection that names a toolchain nobody gave commands to would
    // silently produce a project with no derived permissions at all.
    for (const id of STACK_IDS) {
      const profile: StackProfile = {
        stacks: [{ id, evidence: `evidence-for-${id}` }],
        languages: [],
        unrecognized: false,
        partial: false,
        observed: { extensions: [], rootEntries: [] },
      };

      const result = deriveHostPermissions(mockAnswers(), profile, {
        hasGit: false,
      });

      expect(result.allow.length).toBeGreaterThan(0);
      for (const entry of result.provenance) {
        expect(entry.origin).toBe("stack");
        expect(entry.evidence).toBe(`${id}:evidence-for-${id}`);
      }
    }
  });

  it("does not derive git permissions when git repository is absent", () => {
    const profile: StackProfile = profileStack({ rootEntries: [] });
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
    const profile: StackProfile = profileStack({ rootEntries: [] });
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

  it("derives a permission for a derived project profile command and keeps its evidence", () => {
    // The host records a derived answer without asking the operator, so a
    // command the runtime read from a manifest must earn its allowance from
    // that evidence rather than from a confirmation that no longer happens.
    const profile: StackProfile = profileStack({ rootEntries: [] });
    const answers = mockAnswers({
      projectProfile: {
        commands: {
          test: {
            status: "derived",
            value: "pnpm test",
            evidence: "package.json#scripts.test",
          },
          lint: {
            status: "derived",
            value: "make lint",
            evidence: "Makefile:lint",
          },
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

    expect(result.allow).toEqual(["Bash(make lint)", "Bash(pnpm test)"]);
    expect(result.provenance).toEqual([
      {
        permission: "Bash(pnpm test)",
        origin: "derived_profile",
        evidence: "package.json#scripts.test",
      },
      {
        permission: "Bash(make lint)",
        origin: "derived_profile",
        evidence: "Makefile:lint",
      },
    ]);
  });

  it("rejects a derived permission whose evidence the profile does not carry", () => {
    const profile: StackProfile = profileStack({ rootEntries: [] });
    const answers = mockAnswers({
      projectProfile: {
        commands: {
          test: {
            status: "derived",
            value: "pnpm test",
            evidence: "package.json#scripts.test",
          },
          lint: { status: "unresolved" },
          build: { status: "unresolved" },
          run: { status: "unresolved" },
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

    const wrongEvidence = {
      permission: "Bash(pnpm test)",
      origin: "derived_profile" as const,
      evidence: "Makefile:test",
    };
    expect(() => {
      assertPermissionProvenance(wrongEvidence, answers, profile, {
        hasGit: false,
      });
    }).toThrow(/PERMISSION_WITHOUT_PROVENANCE/);

    const wrongCommand = {
      permission: "Bash(pnpm run build)",
      origin: "derived_profile" as const,
      evidence: "package.json#scripts.test",
    };
    expect(() => {
      assertPermissionProvenance(wrongCommand, answers, profile, {
        hasGit: false,
      });
    }).toThrow(/PERMISSION_WITHOUT_PROVENANCE/);
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
