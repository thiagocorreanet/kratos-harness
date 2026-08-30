import {
  resolveProjectProfile,
  unresolvedProjectProfile,
  unresolvedProjectProfileKeys,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

const persisted = {
  commands: {
    test: { status: "resolved", value: "npm test" },
    lint: { status: "resolved", value: "npm run lint" },
    build: { status: "resolved", value: "npm run build" },
    run: { status: "resolved", value: "npm run dev" },
  },
  paths: {
    source: { status: "resolved", value: ["src"] },
    tests: { status: "resolved", value: ["tests"] },
    configuration: {
      status: "not-applicable",
      reason: "No configuration files.",
    },
  },
  conventions: {
    directoryLayout: { status: "resolved", value: "Feature directories." },
    naming: { status: "resolved", value: "camelCase names." },
    implementationLanguages: { status: "resolved", value: ["TypeScript"] },
  },
} as const;

describe("project profile resolution", () => {
  it("resolves every leaf independently by explicit, persisted, then unresolved precedence", () => {
    const resolved = resolveProjectProfile(
      {
        commands: {
          test: { status: "resolved", value: "pnpm test" },
          lint: { status: "unresolved" },
        },
        paths: {
          source: {
            status: "not-applicable",
            reason: "Generated source only.",
          },
        },
        conventions: {
          implementationLanguages: {
            status: "resolved",
            value: ["TypeScript", "SQL"],
          },
        },
      },
      persisted,
    );

    expect(resolved.commands).toEqual({
      test: { status: "resolved", value: "pnpm test" },
      lint: { status: "unresolved" },
      build: { status: "resolved", value: "npm run build" },
      run: { status: "resolved", value: "npm run dev" },
    });
    expect(resolved.paths).toEqual({
      source: { status: "not-applicable", reason: "Generated source only." },
      tests: { status: "resolved", value: ["tests"] },
      configuration: {
        status: "not-applicable",
        reason: "No configuration files.",
      },
    });
    expect(resolved.conventions.implementationLanguages).toEqual({
      status: "resolved",
      value: ["TypeScript", "SQL"],
    });
  });

  it("returns a complete unresolved profile when no answer exists", () => {
    expect(resolveProjectProfile(undefined, undefined)).toEqual(
      unresolvedProjectProfile(),
    );
  });

  it("lists unresolved keys in stable profile order", () => {
    const profile = resolveProjectProfile(
      { commands: { test: { status: "resolved", value: "npm test" } } },
      undefined,
    );

    expect(unresolvedProjectProfileKeys(profile)).toEqual([
      "projectProfile.commands.lint",
      "projectProfile.commands.build",
      "projectProfile.commands.run",
      "projectProfile.paths.source",
      "projectProfile.paths.tests",
      "projectProfile.paths.configuration",
      "projectProfile.conventions.directoryLayout",
      "projectProfile.conventions.naming",
      "projectProfile.conventions.implementationLanguages",
    ]);
  });
});
