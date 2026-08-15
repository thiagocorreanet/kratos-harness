import { profileStack } from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

describe("stack profiling", () => {
  it.each([
    ["package.json", "node"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "java"],
    ["Gemfile", "ruby"],
    ["composer.json", "php"],
    ["Runtime.csproj", "dotnet"],
    ["Runtime.fsproj", "dotnet"],
    ["Runtime.sln", "dotnet"],
  ])("recognizes %s as %s", (entry, id) => {
    const profile = profileStack({ rootEntries: [entry, "README.md"] });

    // The evidence travels with the verdict: a profile that names a stack
    // without naming why is a profile nobody can check.
    expect(profile).toEqual({
      stacks: [{ id, evidence: entry }],
      unrecognized: false,
    });
  });

  it("reports an unrecognized project as a project, not a failure", () => {
    const profile = profileStack({ rootEntries: ["README.md", "LICENSE"] });

    expect(profile).toEqual({ stacks: [], unrecognized: true });
  });

  it("reports every stack a polyglot repository shows", () => {
    const profile = profileStack({
      rootEntries: ["go.mod", "package.json", "Cargo.toml"],
    });

    // Ordered by identifier rather than by directory listing, so two runs on
    // two machines write the same profile.
    expect(profile.stacks.map(({ id }) => id)).toEqual(["go", "node", "rust"]);
    expect(profile.unrecognized).toBe(false);
  });

  it("names one marker per stack even when several match", () => {
    const profile = profileStack({
      rootEntries: ["requirements.txt", "pyproject.toml"],
    });

    expect(profile.stacks).toEqual([
      { id: "python", evidence: "pyproject.toml" },
    ]);
  });

  it("does not read a bare suffix as a project file", () => {
    // `.csproj` alone is a hidden file, not a project named nothing.
    expect(profileStack({ rootEntries: [".csproj"] })).toEqual({
      stacks: [],
      unrecognized: true,
    });
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
});
