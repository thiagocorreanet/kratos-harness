import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectProfileV1 } from "@kratos/contracts";
import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { recordingOutput } from "@kratos/runtime/infra/fake";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

async function project(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-profile-derive-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

async function derive(root: string, ...flags: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(
    [...flags, "profile", "derive", "--root", root],
    createRuntime({ output }),
  );
  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("the profile derive command", () => {
  it("publishes every profile answer, derived ones carrying their evidence", async () => {
    const root = await project({
      "package.json": JSON.stringify({
        name: "sample",
        scripts: { test: "vitest run", lint: "eslint .", build: "tsc" },
      }),
      "src/index.ts": "export const value = 1;\n",
      "tests/index.test.ts": "export const covered = true;\n",
    });

    const { exitCode, stdout } = await derive(root, "--json");

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as ProjectProfileV1;
    expect(payload.contractVersion).toBe("1.0.0");
    expect(payload.hostContract).toBe("1.4.0");
    expect(payload.profile).toEqual({
      commands: {
        test: {
          status: "derived",
          value: "npm test",
          evidence: "package.json#scripts.test",
        },
        lint: {
          status: "derived",
          value: "npm run lint",
          evidence: "package.json#scripts.lint",
        },
        build: {
          status: "derived",
          value: "npm run build",
          evidence: "package.json#scripts.build",
        },
        // Nothing declares how this project runs, so nothing is offered for it.
        run: { status: "unresolved" },
      },
      paths: {
        source: {
          status: "derived",
          value: ["src"],
          evidence: "directory:src",
        },
        tests: {
          status: "derived",
          value: ["tests"],
          evidence: "directory:tests",
        },
        configuration: { status: "unresolved" },
      },
      conventions: {
        directoryLayout: {
          status: "derived",
          value:
            "Place new source under `src/` at the repository root and its tests in the sibling `tests/` directory.",
          evidence: "layout:root src; 1 source file, 1 test file",
        },
        // Two file names are not a naming convention, so that one is asked.
        naming: { status: "unresolved" },
        implementationLanguages: {
          status: "derived",
          value: ["typescript"],
          evidence: "census:typescript",
        },
      },
    });
  });

  it("reports an answer the derivation cannot reach as unresolved rather than absent", async () => {
    const root = await project({ "README.md": "# empty\n" });

    const { exitCode, stdout } = await derive(root, "--json");

    expect(exitCode).toBe(0);
    const { profile } = JSON.parse(stdout) as ProjectProfileV1;
    const leaves = [
      ...Object.values(profile.commands),
      ...Object.values(profile.paths),
      ...Object.values(profile.conventions),
    ];
    expect(leaves).toEqual(
      Array.from({ length: 10 }, () => ({ status: "unresolved" })),
    );
  });

  it("answers one repository identically on every run", async () => {
    const root = await project({
      "go.mod": "module example.com/sample\n\ngo 1.24\n",
      "app/main.go": "package main\n\nfunc main() {}\n",
    });

    const first = await derive(root, "--json");
    const second = await derive(root, "--json");

    expect(first.stdout).toBe(second.stdout);
    const { profile } = JSON.parse(first.stdout) as ProjectProfileV1;
    expect(profile.commands.test).toEqual({
      status: "derived",
      value: "go test ./...",
      evidence: "stack:go via go.mod",
    });
    expect(profile.paths.source).toEqual({
      status: "derived",
      value: ["app"],
      evidence: "directory:app",
    });
  });

  it("derives the command CI runs, and survives a workflow it cannot parse", async () => {
    const root = await project({
      "Api.csproj": "<Project />\n",
      "src/Program.cs": "class Program {}\n",
      ".github/workflows/broken.yml": "jobs:\n\t- not: [ yaml\n",
      ".github/workflows/ci.yml": [
        "name: CI",
        "on: [push]",
        "jobs:",
        "  verify:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - name: Run tests",
        "        run: dotnet test --filter Category!=Integration",
        "",
      ].join("\n"),
    });

    const { exitCode, stdout } = await derive(root, "--json");

    expect(exitCode).toBe(0);
    const { profile } = JSON.parse(stdout) as ProjectProfileV1;
    expect(profile.commands.test).toEqual({
      status: "derived",
      value: "dotnet test --filter Category!=Integration",
      evidence: ".github/workflows/ci.yml#job:verify/step:Run tests",
    });
    // The workflow says nothing about building, so the toolchain still does.
    expect(profile.commands.build).toEqual({
      status: "derived",
      value: "dotnet build",
      evidence: "stack:dotnet via Api.csproj",
    });
  });

  it("names each answer with its evidence in human output", async () => {
    const root = await project({
      Makefile: "test:\n\tgo test ./...\n",
    });

    const { exitCode, stdout } = await derive(root);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "projectProfile.commands.test: make test (Makefile:test)",
    );
    expect(stdout).toContain("projectProfile.commands.run: not derived");
  });

  it("writes nothing into the project it read", async () => {
    const root = await project({ "package.json": '{ "name": "sample" }\n' });

    expect((await derive(root, "--json")).exitCode).toBe(0);

    // Reporting what a repository looks like must not be the thing that
    // creates managed state in it.
    expect((await readdir(root)).sort()).toEqual(["package.json"]);
  });

  it("refuses a root flag that conflicts with detection", async () => {
    const root = await project({ "package.json": '{ "name": "sample" }\n' });

    const { exitCode, stderr } = await derive(root, "--detect-root");

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("trail.uso");
  });
});
