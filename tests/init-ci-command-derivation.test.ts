import { observeManifestContents } from "@kratos/runtime/composition/repository";
import {
  CI_WORKFLOW_MAX_FILES,
  deriveProjectProfile,
  type ManifestContents,
  type ProjectProfileLeaf,
} from "@kratos/runtime/domain/init";
import { memoryFileSystem } from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

function workflow(content: string, path = ".github/workflows/ci.yml") {
  return { path, content };
}

/** The command a leaf carries, or nothing when the slot went unanswered. */
function commandOf(
  leaf: ProjectProfileLeaf<string> | undefined,
): string | undefined {
  return leaf !== undefined && "value" in leaf ? leaf.value : undefined;
}

const DOTNET_WORKFLOW = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  verify:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - name: Restore dependencies",
  "        run: dotnet restore",
  "      - name: Run tests",
  "        run: dotnet test --filter Category!=Integration",
  "      - name: Lint the solution",
  "        run: dotnet format --verify-no-changes",
].join("\n");

describe("commands derived from CI workflows", () => {
  it("derives the command a named workflow step runs, naming file, job, and step", () => {
    const manifests: ManifestContents = {
      workflows: [workflow(DOTNET_WORKFLOW)],
    };
    const evidence = { rootEntries: ["Api.csproj"] };

    const derived = deriveProjectProfile(evidence, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "dotnet test --filter Category!=Integration",
      evidence: ".github/workflows/ci.yml#job:verify/step:Run tests",
    });
    expect(derived.commands?.lint).toEqual({
      status: "derived",
      value: "dotnet format --verify-no-changes",
      evidence: ".github/workflows/ci.yml#job:verify/step:Lint the solution",
    });
  });

  it("keeps a manifest declaration over what the workflow runs", () => {
    const manifests: ManifestContents = {
      packageJson: JSON.stringify({ scripts: { test: "vitest run" } }),
      workflows: [
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Run tests",
            "        run: npm test --workspaces",
          ].join("\n"),
        ),
      ],
    };

    const derived = deriveProjectProfile(
      { rootEntries: ["package.json"] },
      manifests,
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "npm test",
      evidence: "package.json#scripts.test",
    });
  });

  it("prefers the workflow command to the toolchain default", () => {
    const manifests: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Test",
            "        run: go test ./... -race",
          ].join("\n"),
        ),
      ],
    };

    const derived = deriveProjectProfile(
      { rootEntries: ["go.mod"] },
      manifests,
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "go test ./... -race",
      evidence: ".github/workflows/ci.yml#job:ci/step:Test",
    });
    // The slots the workflow said nothing about still fall to the toolchain.
    expect(commandOf(derived.commands?.build)).toBe("go build ./...");
  });

  it("derives nothing from a step whose name states no purpose", () => {
    const manifests: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Everything",
            "        run: npm test",
            "      - run: npm run lint",
          ].join("\n"),
        ),
      ],
    };

    const derived = deriveProjectProfile({ rootEntries: [] }, manifests);

    expect(derived.commands).toBeUndefined();
  });

  it("derives nothing from a step whose name states two purposes", () => {
    const manifests: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Build and test",
            "        run: make ci",
          ].join("\n"),
        ),
      ],
    };

    expect(
      deriveProjectProfile({ rootEntries: [] }, manifests).commands,
    ).toBeUndefined();
  });

  it("lets a job name answer only when the job runs a single command", () => {
    const single: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  lint:",
            "    name: Lint",
            "    steps:",
            "      - uses: actions/checkout@v4",
            "      - run: ruff check .",
          ].join("\n"),
        ),
      ],
    };
    const many: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  lint:",
            "    steps:",
            "      - run: pip install ruff",
            "      - run: ruff check .",
          ].join("\n"),
        ),
      ],
    };

    expect(
      deriveProjectProfile({ rootEntries: [] }, single).commands?.lint,
    ).toEqual({
      status: "derived",
      value: "ruff check .",
      evidence: ".github/workflows/ci.yml#job:lint",
    });
    expect(
      deriveProjectProfile({ rootEntries: [] }, many).commands,
    ).toBeUndefined();
  });

  it("skips a block scalar rather than deriving half of it", () => {
    const manifests: ManifestContents = {
      workflows: [
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Run tests",
            "        run: |",
            "          set -e",
            "          npm test",
            "      - name: Lint",
            "        run: npm run lint",
          ].join("\n"),
        ),
      ],
    };

    const derived = deriveProjectProfile({ rootEntries: [] }, manifests);

    expect(derived.commands?.test).toBeUndefined();
    expect(commandOf(derived.commands?.lint)).toBe("npm run lint");
  });

  it("skips a malformed workflow without failing the derivation", () => {
    const manifests: ManifestContents = {
      workflows: [
        workflow(
          "jobs:\n\t- this is not: [ valid, yaml",
          ".github/workflows/broken.yml",
        ),
        workflow(
          [
            "jobs:",
            "  ci:",
            "    steps:",
            "      - name: Tests",
            "        run: cargo test",
          ].join("\n"),
          ".github/workflows/ci.yml",
        ),
      ],
    };

    const derived = deriveProjectProfile({ rootEntries: [] }, manifests);

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "cargo test",
      evidence: ".github/workflows/ci.yml#job:ci/step:Tests",
    });
  });

  it("reads the same workflows the same way every time", () => {
    const manifests: ManifestContents = {
      workflows: [workflow(DOTNET_WORKFLOW)],
    };

    expect(deriveProjectProfile({ rootEntries: [] }, manifests)).toEqual(
      deriveProjectProfile({ rootEntries: [] }, manifests),
    );
  });
});

describe("commands derived from language-agnostic task runners", () => {
  it("derives task names from a Taskfile", () => {
    const derived = deriveProjectProfile(
      { rootEntries: ["Taskfile.yml"] },
      {
        taskfile: {
          path: "Taskfile.yml",
          content: [
            "version: '3'",
            "tasks:",
            "  test:",
            "    cmds:",
            "      - go test ./...",
            "  build:",
            "    cmds:",
            "      - go build ./...",
          ].join("\n"),
        },
      },
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "task test",
      evidence: "Taskfile.yml#tasks.test",
    });
    expect(commandOf(derived.commands?.build)).toBe("task build");
  });

  it("derives recipes from a justfile", () => {
    const derived = deriveProjectProfile(
      { rootEntries: ["justfile"] },
      {
        justfile: {
          path: "justfile",
          content: [
            "export RUST_LOG := 'info'",
            "",
            "test:",
            "    cargo test",
            "",
            "lint arg='':",
            "    cargo clippy {{arg}}",
          ].join("\n"),
        },
      },
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "just test",
      evidence: "justfile:test",
    });
    expect(commandOf(derived.commands?.lint)).toBe("just lint");
  });

  it("derives tasks from a mise configuration in either spelling", () => {
    const derived = deriveProjectProfile(
      { rootEntries: ["mise.toml"] },
      {
        miseToml: {
          path: "mise.toml",
          content: [
            "[tools]",
            'node = "24"',
            "",
            "[tasks.test]",
            'run = "npm test"',
            "",
            "[tasks]",
            'lint = "eslint ."',
          ].join("\n"),
        },
      },
    );

    expect(derived.commands?.test).toEqual({
      status: "derived",
      value: "mise run test",
      evidence: "mise.toml#tasks.test",
    });
    expect(commandOf(derived.commands?.lint)).toBe("mise run lint");
  });

  it("derives only the named lifecycle commands of a devcontainer", () => {
    const derived = deriveProjectProfile(
      { rootEntries: [] },
      {
        devcontainerJson: {
          path: ".devcontainer/devcontainer.json",
          content: JSON.stringify({
            postCreateCommand: { install: "npm ci", build: "npm run build" },
            postStartCommand: "npm start",
          }),
        },
      },
    );

    expect(derived.commands?.build).toEqual({
      status: "derived",
      value: "npm run build",
      evidence: ".devcontainer/devcontainer.json#postCreateCommand.build",
    });
    // The string form names nothing, so it answers nothing.
    expect(derived.commands?.run).toBeUndefined();
  });

  it("keeps a task runner over the workflow that invokes it", () => {
    const derived = deriveProjectProfile(
      { rootEntries: ["justfile"] },
      {
        justfile: { path: "justfile", content: "test:\n    cargo test\n" },
        workflows: [
          workflow(
            [
              "jobs:",
              "  ci:",
              "    steps:",
              "      - name: Run tests",
              "        run: just test --verbose",
            ].join("\n"),
          ),
        ],
      },
    );

    expect(commandOf(derived.commands?.test)).toBe("just test");
  });
});

describe("reading the files a derivation needs", () => {
  it("reads the workflows and task runners the scan saw", async () => {
    const fileSystem = memoryFileSystem({
      "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      "Taskfile.yml": "tasks:\n  test:\n    cmds:\n      - vitest\n",
      justfile: "test:\n    vitest\n",
      "mise.toml": "[tasks.lint]\nrun = 'eslint .'\n",
      ".devcontainer/devcontainer.json": "{}",
      ".github/workflows/ci.yml": DOTNET_WORKFLOW,
      ".github/workflows/release.yaml": "jobs:\n",
      ".github/workflows/notes.md": "not a workflow",
    });

    const evidence = {
      rootEntries: [
        ".devcontainer",
        ".github",
        "Taskfile.yml",
        "justfile",
        "mise.toml",
        "package.json",
      ],
      files: [
        ".devcontainer/devcontainer.json",
        ".github/workflows/ci.yml",
        ".github/workflows/notes.md",
        ".github/workflows/release.yaml",
        "Taskfile.yml",
        "justfile",
        "mise.toml",
        "package.json",
      ],
    };

    const manifests = await observeManifestContents(fileSystem, evidence);

    expect(manifests.packageJson).toContain("vitest");
    expect(manifests.taskfile?.path).toBe("Taskfile.yml");
    expect(manifests.justfile?.path).toBe("justfile");
    expect(manifests.miseToml?.path).toBe("mise.toml");
    expect(manifests.devcontainerJson?.path).toBe(
      ".devcontainer/devcontainer.json",
    );
    expect(manifests.workflows?.map((file) => file.path)).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yaml",
    ]);
  });

  it("reads nothing the scan did not see", async () => {
    const fileSystem = memoryFileSystem({
      ".github/workflows/ci.yml": DOTNET_WORKFLOW,
    });

    const manifests = await observeManifestContents(fileSystem, {
      rootEntries: [".github"],
    });

    expect(manifests.workflows).toBeUndefined();
  });

  it("stops at the workflow count ceiling, in path order", async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let index = 0; index < CI_WORKFLOW_MAX_FILES + 4; index += 1) {
      const path = `.github/workflows/w${String(index).padStart(3, "0")}.yml`;
      files[path] = "jobs:\n";
      paths.push(path);
    }

    const manifests = await observeManifestContents(memoryFileSystem(files), {
      rootEntries: [".github"],
      files: paths,
    });

    expect(manifests.workflows).toHaveLength(CI_WORKFLOW_MAX_FILES);
    expect(manifests.workflows?.[0]?.path).toBe(paths[0]);
  });

  it("skips a file too large to parse and every file it cannot read", async () => {
    const fileSystem = memoryFileSystem({
      ".github/workflows/huge.yml": "#".repeat(70_000),
      justfile: "test:\n    vitest\n",
    });

    const manifests = await observeManifestContents(fileSystem, {
      rootEntries: ["justfile"],
      files: [".github/workflows/huge.yml", "justfile", "Taskfile.yml"],
    });

    expect(manifests.workflows).toBeUndefined();
    expect(manifests.taskfile).toBeUndefined();
    expect(manifests.justfile?.content).toContain("vitest");
  });
});
