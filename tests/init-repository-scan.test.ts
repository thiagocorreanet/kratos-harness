import { observeRepositoryEvidence } from "@kratos/runtime/composition/repository";
import {
  profileStack,
  SCAN_MAX_DEPTH,
  SCAN_MAX_ENTRIES,
} from "@kratos/runtime/domain/init";
import { memoryFileSystem } from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

function project(
  files: Readonly<Record<string, string>>,
): ReturnType<typeof memoryFileSystem> {
  return memoryFileSystem(files);
}

describe("bounded repository scan", () => {
  it("sees a manifest that does not sit at the root", async () => {
    // AC-3: the reproduction in the issue, from the filesystem side.
    const evidence = await observeRepositoryEvidence(
      project({
        "src/Api/Api.csproj": "<Project />",
        "src/Api/Program.cs": "class Program {}",
      }),
    );

    expect(evidence.rootEntries).toEqual(["src"]);
    expect(evidence.files).toEqual([
      "src/Api/Api.csproj",
      "src/Api/Program.cs",
    ]);
    expect(profileStack(evidence).stacks).toEqual([
      { id: "dotnet", evidence: "src/Api/Api.csproj" },
    ]);
  });

  it("never enters a dependency tree or this tool's own state", async () => {
    // AC-7
    const evidence = await observeRepositoryEvidence(
      project({
        "app.rb": "puts 1",
        ".brain/config.json": "{}",
        ".git/HEAD": "ref",
        "node_modules/left-pad/index.js": "module.exports = 1;",
        "vendor/gem/lib.rb": "1",
        "target/debug/build.rs": "1",
        "dist/bundle.js": "1",
        "build/out.o": "1",
      }),
    );

    expect(evidence.files).toEqual(["app.rb"]);
    expect(evidence.truncated).toBe(false);
  });

  it("reads the same tree the same way every time", async () => {
    // AC-8
    const files = {
      "apps/web/package.json": "{}",
      "apps/web/src/index.ts": "export {};",
      "services/api/go.mod": "module api",
    };

    expect(await observeRepositoryEvidence(project(files))).toEqual(
      await observeRepositoryEvidence(project(files)),
    );
  });

  it("reports both toolchains of a monorepo", async () => {
    // AC-4
    const profile = profileStack(
      await observeRepositoryEvidence(
        project({
          "apps/web/package.json": "{}",
          "services/api/go.mod": "module api",
        }),
      ),
    );

    expect(profile.stacks).toEqual([
      { id: "go", evidence: "services/api/go.mod" },
      { id: "node", evidence: "apps/web/package.json" },
    ]);
  });

  it("stops at its depth bound instead of following a tree down", async () => {
    const deep = `${"level/".repeat(SCAN_MAX_DEPTH + 2)}buried.rs`;
    const evidence = await observeRepositoryEvidence(
      project({ [deep]: "fn main() {}", "top.rs": "fn main() {}" }),
    );

    expect(evidence.files).toEqual(["top.rs"]);
  });

  it("stops at its entry budget and says the profile is partial", async () => {
    // AC-9: a repository nobody expected degrades to a partial answer rather
    // than to a run that never returns.
    const files: Record<string, string> = { "Cargo.toml": "" };
    for (let index = 0; index < SCAN_MAX_ENTRIES + 10; index += 1) {
      files[`src/file-${String(index).padStart(5, "0")}.rs`] = "";
    }
    const evidence = await observeRepositoryEvidence(project(files));
    const profile = profileStack(evidence);

    expect(evidence.truncated).toBe(true);
    expect(evidence.files?.length ?? 0).toBeLessThanOrEqual(SCAN_MAX_ENTRIES);
    expect(profile.partial).toBe(true);
    // The shallow part of the tree is complete, which is what breadth-first
    // spending of the budget buys: the root manifest is still found.
    expect(profile.stacks).toEqual([{ id: "rust", evidence: "Cargo.toml" }]);
  });

  it("counts an entry it cannot inspect as an entry it did not see", async () => {
    const fileSystem = project({ "app.go": "package main" });
    const refusing = {
      ...fileSystem,
      stat: async (path: string) => {
        if (path === "app.go")
          throw new Error("Runtime path escapes the project");
        return fileSystem.stat(path);
      },
    };

    const evidence = await observeRepositoryEvidence(refusing);

    expect(evidence.rootEntries).toEqual(["app.go"]);
    expect(evidence.files).toEqual([]);
  });
});
