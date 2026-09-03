import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { destinationsOf, skeletonEffects } from "@kratos/runtime/domain/init";
import { profileStack } from "@kratos/runtime/domain/init";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import type { DurableFileSystem, RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import type { ProjectConfigV1_5 } from "@kratos/contracts";
import projectConfigV1_2 from "../fixtures/contracts/v1.2/project-config.json" with { type: "json" };

import {
  antigravityCatalog,
  claudeCatalog,
  codexCatalog,
} from "./support/model-routing.js";

const ROOT = "/project";

const ANSWERS = JSON.stringify({
  contractVersion: "1.3.0",
  hostContract: "1.3.0",
  hosts: ["claude", "codex"],
});

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(
  answers: string | null = ANSWERS,
  seed: Readonly<Record<string, string>> = {},
  projectFiles: Readonly<Record<string, string>> = {},
  workspaceDirectories: readonly string[] = [],
  seedDirectories: readonly string[] = [],
  modelRouting = fixedModelRouting([claudeCatalog(), codexCatalog()]),
): Subject {
  const storage = memoryTransactionStorage({
    files: seed,
    directories: seedDirectories,
  });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock("2026-08-14T00:00:00.000Z"),
      ids: sequentialIds("transaction"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({ "package.json": "{}", ...projectFiles }),
      git: { observe: () => Promise.reject(new Error("unused")) },
      locks: {} as RuntimePorts["locks"],
      modelRouting,
      environment: fixedEnvironment({}, ROOT),
      output,
      standardInput: pipedInput(answers),
      targetInspector: {
        capture: () =>
          Promise.resolve({
            inspect: (path) =>
              Promise.resolve({
                kind: "inside",
                lexicalPath: path,
                canonicalPath: path,
              }),
          }),
      },
      workspace: memoryWorkspace({
        directories: [ROOT, ...workspaceDirectories],
      }),
    },
  };
}

/**
 * Parity evidence for the initialization rows this suite exercises:
 * `CLI-INIT`, `FLAG-INIT-ANSWERS`, `FLAG-INIT-DETECT-ROOT`, `FLAG-INIT-FORCE`,
 * `FLAG-INIT-HOST`, `FLAG-INIT-MERGE`, `FLAG-INIT-ROOT`, and
 * `FLAG-INIT-WORKTREE-LOCAL`.
 *
 * The inventory establishes that the command exists, accepts those flag names,
 * and generates those paths. What each flag means is this runtime's contract,
 * so the rows stay `in_progress` until a differential capture exists to
 * compare behavior against.
 */
describe("the init command", () => {
  it("establishes the frozen surface from a piped answers document", async () => {
    const run = subject();

    expect(await runCommandLine(["init"], run.ports)).toBe(0);

    // The transaction keeps its own receipt under the reserved namespace; the
    // surface under test is everything the caller asked for.
    const written = Object.keys(run.storage.snapshot().files)
      .filter((path) => !path.startsWith(".brain/transactions/"))
      .sort();
    expect(written).toEqual(
      destinationsOf(
        skeletonEffects(
          {
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
            modelRoles: {
              claude: claudeCatalog().defaults,
              codex: codexCatalog().defaults,
            },
            projectProfile: {
              commands: {
                test: { status: "unresolved" },
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
          },
          profileStack({ rootEntries: ["package.json"] }),
        ),
      ),
    );
  });

  it("decides there is nothing to do the second time", async () => {
    const first = subject();
    await runCommandLine(["init"], first.ports);
    const settled = first.storage.snapshot();

    // The second run starts from what the first one wrote, which is the only
    // way to prove nothing moved: a fresh project would pass either way.
    const again = subject(ANSWERS, settled.files);
    expect(
      await runCommandLine(["init"], again.ports),
      again.output.human_.join("") + again.output.structured_.join(""),
    ).toBe(0);

    expect(
      Object.fromEntries(
        Object.entries(again.storage.snapshot().files).filter(
          ([path]) => !path.startsWith(".brain/transactions/"),
        ),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(settled.files).filter(
          ([path]) => !path.startsWith(".brain/transactions/"),
        ),
      ),
    );
    expect(again.output.structured_.join("")).toContain("preserved");
  });

  it("preserves gate modes when a re-initialization omits them", async () => {
    const first = subject(
      JSON.stringify({
        contractVersion: "1.5.0",
        hostContract: "1.4.0",
        hosts: ["claude", "codex"],
        gateModes: { "gaps-closed": "shadow" },
      }),
    );
    expect(await runCommandLine(["init"], first.ports)).toBe(0);
    const initialized = first.storage.snapshot();

    const again = subject(
      JSON.stringify({
        contractVersion: "1.5.0",
        hostContract: "1.4.0",
        hosts: ["claude", "codex"],
      }),
      initialized.files,
      {},
      [],
      initialized.directories,
    );
    expect(await runCommandLine(["init"], again.ports)).toBe(0);

    expect(
      JSON.parse(
        again.storage.snapshot().files[".brain/config.json"] ?? "null",
      ),
    ).toMatchObject({ gateModes: { "gaps-closed": "shadow" } });
  });

  it("creates measurement artifacts once and preserves their bytes while refreshing managed instructions", async () => {
    const first = subject();
    expect(await runCommandLine(["init"], first.ports)).toBe(0);
    const initialized = Object.fromEntries(
      Object.entries(first.storage.snapshot().files).filter(
        ([path]) => !path.startsWith(".brain/transactions/"),
      ),
    );
    expect(initialized[".brain/03-memory/task_log.jsonl"]).toBe("");
    expect(initialized[".brain/03-memory/task_metrics.md"]).toContain(
      "# Task metrics",
    );

    const raw = '{"measured":"raw bytes"}\r\n';
    const rollup = "# Task metrics\r\n\r\nMeasured rollup bytes.  \r\n";
    const instructions = initialized["CLAUDE.md"];
    if (instructions === undefined) {
      throw new Error("Initialization did not create CLAUDE.md");
    }
    const staleInstructions = `# Project-owned prefix\r\n\r\n${instructions.replace("# Kratos", "# Stale Kratos")}`;
    const again = subject(
      ANSWERS,
      {
        ...initialized,
        ".brain/03-memory/task_log.jsonl": raw,
        ".brain/03-memory/task_metrics.md": rollup,
        "CLAUDE.md": staleInstructions,
      },
      {},
      [],
      first.storage.snapshot().directories,
    );

    expect(
      await runCommandLine(["init"], again.ports),
      again.output.human_.join("") + again.output.structured_.join(""),
    ).toBe(0);

    const reinitialized = again.storage.snapshot().files;
    expect(reinitialized[".brain/03-memory/task_log.jsonl"]).toBe(raw);
    expect(reinitialized[".brain/03-memory/task_metrics.md"]).toBe(rollup);
    expect(reinitialized["CLAUDE.md"]).toBe(
      `# Project-owned prefix\r\n\r\n${instructions}`,
    );
  });

  it.each([
    [
      "raw log",
      ".brain/03-memory/task_log.jsonl",
      '{"concurrent":"raw bytes"}\r\n',
    ],
    [
      "rollup",
      ".brain/03-memory/task_metrics.md",
      "# Concurrent metrics\r\n\r\nSentinel bytes.  \r\n",
    ],
  ])(
    "rejects concurrent %s creation without publishing partial initialization",
    async (_label, target, sentinel) => {
      const run = subject(
        ANSWERS,
        {},
        {},
        [],
        [".brain", ".brain/transactions"],
      );
      const observed = run.ports.durableFileSystem;
      let targetInspections = 0;
      const durableFileSystem: DurableFileSystem = {
        ...observed,
        inspect: async (path) => {
          if (path === target) {
            targetInspections += 1;
            if (targetInspections === 2) {
              await run.storage.fileSystem.write(target, sentinel);
            }
          }
          return observed.inspect(path);
        },
      };

      expect(
        await runCommandLine(["--json", "init"], {
          ...run.ports,
          durableFileSystem,
        }),
        run.output.structured_.join("") + run.output.human_.join(""),
      ).toBe(5);
      expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
        reasonCode: "runtime.revision_conflict",
        stateChanged: false,
        evidence: [{ ref: target }],
      });
      expect(targetInspections).toBeGreaterThanOrEqual(2);
      expect(
        Object.fromEntries(
          Object.entries(run.storage.snapshot().files).filter(
            ([path]) => !path.startsWith(".brain/transactions/"),
          ),
        ),
      ).toEqual({ [target]: sentinel });
    },
  );

  it("persists every profile leaf as unresolved on a fresh initialization", async () => {
    const run = subject();

    expect(await runCommandLine(["init"], run.ports)).toBe(0);

    const configuration = JSON.parse(
      run.storage.snapshot().files[".brain/config.json"] ?? "null",
    ) as { readonly projectProfile: unknown };
    expect(configuration.projectProfile).toEqual({
      commands: {
        test: { status: "unresolved" },
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
    });
  });

  it("merges explicit profile leaves fieldwise, including override and clearing", async () => {
    const initialAnswers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude", "codex"],
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "npm test" },
          lint: { status: "resolved", value: "npm run lint" },
          build: { status: "not-applicable", reason: "No build step." },
          run: { status: "resolved", value: "npm start" },
        },
        paths: {
          source: { status: "resolved", value: ["src"] },
          tests: { status: "resolved", value: ["tests"] },
          configuration: { status: "resolved", value: ["package.json"] },
        },
        conventions: {
          directoryLayout: { status: "resolved", value: "Feature folders." },
          naming: { status: "resolved", value: "Use camelCase." },
          implementationLanguages: {
            status: "resolved",
            value: ["TypeScript"],
          },
        },
      },
    });
    const first = subject(initialAnswers);
    expect(await runCommandLine(["init"], first.ports)).toBe(0);
    const initialState = first.storage.snapshot();
    const settled = Object.fromEntries(
      Object.entries(initialState.files).filter(
        ([path]) => !path.startsWith(".brain/transactions/"),
      ),
    );

    const nextAnswers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude", "codex"],
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "npm run test:unit" },
          lint: { status: "unresolved" },
        },
        paths: {
          tests: { status: "not-applicable", reason: "No test directory." },
        },
      },
    });
    const again = subject(
      nextAnswers,
      settled,
      {},
      [],
      initialState.directories,
    );

    expect(
      await runCommandLine(["init"], again.ports),
      again.output.human_.join("") + again.output.structured_.join(""),
    ).toBe(0);

    const configuration = JSON.parse(
      again.storage.snapshot().files[".brain/config.json"] ?? "null",
    ) as {
      readonly projectProfile: {
        readonly commands: Readonly<Record<string, unknown>>;
        readonly paths: Readonly<Record<string, unknown>>;
        readonly conventions: Readonly<Record<string, unknown>>;
      };
    };
    expect(configuration.projectProfile.commands).toEqual({
      test: { status: "resolved", value: "npm run test:unit" },
      lint: { status: "unresolved" },
      build: { status: "not-applicable", reason: "No build step." },
      run: { status: "resolved", value: "npm start" },
    });
    expect(configuration.projectProfile.paths).toEqual({
      source: { status: "resolved", value: ["src"] },
      tests: { status: "not-applicable", reason: "No test directory." },
      configuration: { status: "resolved", value: ["package.json"] },
    });
    expect(configuration.projectProfile.conventions).toEqual({
      directoryLayout: { status: "resolved", value: "Feature folders." },
      naming: { status: "resolved", value: "Use camelCase." },
      implementationLanguages: {
        status: "resolved",
        value: ["TypeScript"],
      },
    });
  });

  it("refuses a concurrent profile update without publishing partial initialization writes", async () => {
    const initialAnswers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude", "codex"],
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "npm test" },
          lint: { status: "resolved", value: "npm run lint:old" },
        },
      },
    });
    const first = subject(initialAnswers);
    expect(await runCommandLine(["init"], first.ports)).toBe(0);
    const settled = first.storage.snapshot();
    const reinitAnswers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude", "codex"],
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "npm run test:unit" },
        },
      },
    });
    const run = subject(
      reinitAnswers,
      settled.files,
      {},
      [],
      settled.directories,
    );
    const projectFileSystem = run.ports.fileSystem;
    let raced = false;
    const ports: RuntimePorts = {
      ...run.ports,
      fileSystem: {
        ...projectFileSystem,
        list: async (path) => {
          const entries = await projectFileSystem.list(path);
          if (!raced && path === ".") {
            raced = true;
            const concurrent = JSON.parse(
              run.storage.snapshot().files[".brain/config.json"] ?? "null",
            ) as {
              projectProfile: {
                commands: {
                  lint: { status: "resolved"; value: string };
                };
              };
            };
            concurrent.projectProfile.commands.lint.value =
              "npm run lint:concurrent";
            await run.storage.fileSystem.write(
              ".brain/config.json",
              `${JSON.stringify(concurrent, null, 2)}\n`,
            );
          }
          return entries;
        },
      },
    };

    expect(
      await runCommandLine(["--json", "init"], ports),
      run.output.structured_.join("") + run.output.human_.join(""),
    ).toBe(5);

    const result = JSON.parse(run.output.structured_.join("")) as {
      readonly reasonCode: string;
      readonly evidence: readonly { readonly ref: string }[];
    };
    expect(result).toMatchObject({
      reasonCode: "runtime.revision_conflict",
      evidence: [{ ref: ".brain/config.json" }],
    });
    const after = run.storage.snapshot().files;
    expect(JSON.parse(after[".brain/config.json"] ?? "null")).toMatchObject({
      projectProfile: {
        commands: {
          test: { status: "resolved", value: "npm test" },
          lint: { status: "resolved", value: "npm run lint:concurrent" },
        },
      },
    });
    expect(
      Object.fromEntries(
        Object.entries(after).filter(([path]) => path !== ".brain/config.json"),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(settled.files).filter(
          ([path]) => path !== ".brain/config.json",
        ),
      ),
    );
  });

  it("refuses initialization over project configuration 1.2 until explicit migration", async () => {
    const run = subject(ANSWERS, {
      ".brain/config.json": `${JSON.stringify(projectConfigV1_2, null, 2)}\n`,
    });

    expect(await runCommandLine(["--json", "init"], run.ports)).toBe(4);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "profile.config_migration_required",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[".brain/config.json"]).toBe(
      `${JSON.stringify(projectConfigV1_2, null, 2)}\n`,
    );
  });

  it("reports every destination as created, updated, or preserved", async () => {
    const run = subject();

    await runCommandLine(["--json", "init"], run.ports);
    const result: unknown = JSON.parse(run.output.structured_.join(""));

    expect(result).toMatchObject({
      reasonCode: "trail.ok",
      summary: expect.stringContaining("Created 31") as unknown,
      stateChanged: true,
    });
    expect(run.output.structured_.join("")).toContain("modelRoles.codex");
  });

  it("keeps a user's instruction file and refuses to guess", async () => {
    const run = subject(ANSWERS, { "CLAUDE.md": "# Mine\n" });

    // Appending to a document whose structure it does not understand is how a
    // tool silently corrupts something somebody wrote.
    expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
    expect(run.storage.snapshot().files["CLAUDE.md"]).toBe("# Mine\n");
  });

  it("appends to that file when merging is authorized", async () => {
    const run = subject(ANSWERS, { "CLAUDE.md": "# Mine\n" });

    expect(await runCommandLine(["init", "--merge"], run.ports)).toBe(0);

    const written = run.storage.snapshot().files["CLAUDE.md"] ?? "";
    expect(written.startsWith("# Mine\n")).toBe(true);
    expect(written).toContain("BEGIN KRATOS MANAGED SECTION");
  });

  it("narrows the surface to one enabled host", async () => {
    const run = subject();

    expect(await runCommandLine(["init", "--host", "codex"], run.ports)).toBe(
      0,
    );

    const written = Object.keys(run.storage.snapshot().files);
    expect(written).toContain("AGENTS.md");
    expect(written).not.toContain("CLAUDE.md");
    expect(written).not.toContain(".claude/settings.json");
    expect(
      JSON.parse(run.storage.snapshot().files[".brain/config.json"] ?? "null"),
    ).toMatchObject({
      modelRoles: { codex: codexCatalog().defaults },
    });
    expect(
      Object.keys(
        (
          JSON.parse(
            run.storage.snapshot().files[".brain/config.json"] ?? "null",
          ) as { readonly modelRoles: Readonly<Record<string, unknown>> }
        ).modelRoles,
      ),
    ).toEqual(["codex"]);
  });

  it("initializes workspace surface for antigravity host", async () => {
    const answers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["antigravity"],
    });
    const run = subject(
      answers,
      {},
      {},
      [],
      [],
      fixedModelRouting([antigravityCatalog()]),
    );

    expect(
      await runCommandLine(["init", "--host", "antigravity"], run.ports),
      run.output.human_.join("") + run.output.structured_.join(""),
    ).toBe(0);

    const written = Object.keys(run.storage.snapshot().files);
    expect(written).toContain("GEMINI.md");
    expect(written).toContain(".gemini/settings.json");
    expect(written).not.toContain("CLAUDE.md");
    expect(written).not.toContain("AGENTS.md");
    expect(
      JSON.parse(run.storage.snapshot().files[".brain/config.json"] ?? "null"),
    ).toMatchObject({
      modelRoles: { antigravity: antigravityCatalog().defaults },
    });
    expect(
      JSON.parse(
        run.storage.snapshot().files[".gemini/settings.json"] ?? "null",
      ),
    ).toMatchObject({
      permissions: {
        allow: expect.arrayContaining([
          "Bash(git status)",
          "Bash(npm test)",
        ]) as unknown,
        deny: [],
      },
    });
    expect(run.storage.snapshot().files["GEMINI.md"]).toContain(
      "BEGIN KRATOS MANAGED SECTION",
    );
  });

  it("refuses a host the answers never enabled", async () => {
    const answers = JSON.stringify({
      contractVersion: "1.3.0",
      hostContract: "1.3.0",
      hosts: ["claude"],
    });
    const run = subject(answers);

    // Answers are the configuration. A flag that quietly added a host would
    // make the same document produce two different projects.
    expect(
      await runCommandLine(["init", "--host", "codex"], run.ports),
    ).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("refuses an answers document that fails its contract", async () => {
    const run = subject(JSON.stringify({ hosts: ["claude"] }));

    expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("writes nothing when enabled-host defaults cannot be resolved", async () => {
    const run = subject(
      JSON.stringify({
        contractVersion: "1.3.0",
        hostContract: "1.3.0",
        hosts: ["codex"],
      }),
      {},
      {},
      [],
      [],
      fixedModelRouting([]),
    );

    expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("names the host and role for distinct model-routing refusals", async () => {
    const unavailable = subject(
      JSON.stringify({
        contractVersion: "1.3.0",
        hostContract: "1.3.0",
        hosts: ["claude", "codex"],
      }),
      {},
      {},
      [],
      [],
      fixedModelRouting([claudeCatalog()]),
    );
    const unsupportedEffort = subject(
      JSON.stringify({
        contractVersion: "1.3.0",
        hostContract: "1.3.0",
        hosts: ["claude", "codex"],
        modelRoles: {
          codex: {
            planner: "planner",
            implementer: "implementer",
            judge: { model: "judge", effort: "xhigh" },
          },
        },
      }),
      {},
      {},
      [],
      [],
      fixedModelRouting([claudeCatalog(), codexCatalog()]),
    );

    expect(
      await runCommandLine(["--json", "init"], unavailable.ports),
    ).not.toBe(0);
    expect(JSON.parse(unavailable.output.structured_.join(""))).toMatchObject({
      why: [expect.stringContaining("codex")],
    });

    expect(
      await runCommandLine(["--json", "init"], unsupportedEffort.ports),
    ).not.toBe(0);
    expect(
      JSON.parse(unsupportedEffort.output.structured_.join("")),
    ).toMatchObject({ why: [expect.stringContaining("judge")] });
  });

  it("refuses when no answers document arrives at all", async () => {
    const run = subject(null);

    expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
  });

  it("reads the answers document from a file", async () => {
    const run = subject(null, {}, { "answers.json": ANSWERS });

    expect(
      await runCommandLine(["init", "--answers", "answers.json"], run.ports),
    ).toBe(0);
    expect(Object.keys(run.storage.snapshot().files)).toContain(
      ".brain/config.json",
    );
  });

  it("refuses an answers file that is not there", async () => {
    const run = subject(null);

    expect(
      await runCommandLine(["init", "--answers", "missing.json"], run.ports),
    ).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("refuses a document that is not JSON", async () => {
    const run = subject("not json at all");

    // The answers contract names the failure; parsing does not get to invent
    // one of its own.
    expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("refuses a destination occupied by something that is not a file", async () => {
    const run = subject(ANSWERS, {});
    // A directory where `CLAUDE.md` belongs is not a file to replace, and
    // removing it is not initialization's decision to make.
    await run.storage.durableFileSystem.createDirectory("CLAUDE.md");

    expect(await runCommandLine(["init", "--force"], run.ports)).not.toBe(0);
  });

  it("refuses a named root and a search for one at the same time", async () => {
    const run = subject();

    // One names a directory and the other asks for a search. Honouring both
    // means picking one silently.
    expect(
      await runCommandLine(
        ["init", "--root", "/elsewhere", "--detect-root"],
        run.ports,
      ),
    ).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });

  it("initializes the root that detection finds", async () => {
    const run = subject(ANSWERS, {}, {}, [`${ROOT}/.brain`]);

    expect(
      await runCommandLine(
        ["init", "--detect-root", "--worktree-local"],
        run.ports,
      ),
    ).toBe(0);
    expect(Object.keys(run.storage.snapshot().files)).toContain(
      ".brain/config.json",
    );
  });

  it("refuses detection that finds no project", async () => {
    const run = subject();

    // Falling back to the current directory would initialize somewhere the
    // caller never named.
    expect(await runCommandLine(["init", "--detect-root"], run.ports)).not.toBe(
      0,
    );
  });

  it("initializes the directory --root names", async () => {
    const target = await mkdtemp(join(tmpdir(), "kratos-init-root-"));
    try {
      const output = recordingOutput();
      const ports = createRuntime({
        output,
        standardInput: pipedInput(ANSWERS),
      });

      expect(await ports.modelRouting.observe("claude")).not.toBeNull();
      expect(await ports.modelRouting.observe("codex")).not.toBeNull();

      // Ports are composed where the process started; the run has to write
      // where it was told instead.
      expect(await runCommandLine(["init", "--root", target], ports)).toBe(0);

      expect(
        await readFile(join(target, ".brain/config.json"), "utf8"),
      ).toContain('"conversation": "en"');
      expect(await readFile(join(target, "CLAUDE.md"), "utf8")).toContain(
        "BEGIN KRATOS MANAGED SECTION",
      );
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  }, 20000);

  it("renders a hostile suffix-marker filename from the real filesystem as one inert table cell", async () => {
    const target = await mkdtemp(join(tmpdir(), "kratos-init-hostile-stack-"));
    const hostile = "Runtime\n| injected | row |.csproj";
    try {
      await writeFile(join(target, hostile), "", "utf8");
      const output = recordingOutput();
      const ports = createRuntime({
        output,
        standardInput: pipedInput(ANSWERS),
      });

      expect(await runCommandLine(["init", "--root", target], ports)).toBe(0);

      const profile = await readFile(
        join(target, ".brain/01-architecture/stack-profile.md"),
        "utf8",
      );
      expect(profile).toContain(
        "| dotnet | `Runtime\\n&#124; injected &#124; row &#124;.csproj` |",
      );
      expect(profile).not.toContain(hostile);
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  }, 20000);

  it("completes a partially initialized project without rewriting the rest", async () => {
    const first = subject();
    await runCommandLine(["init"], first.ports);
    const settled = first.storage.snapshot().files;

    // Half a project: the state root survived, the host surface did not.
    const partial = Object.fromEntries(
      Object.entries(settled).filter(
        ([path]) =>
          path.startsWith(".brain/") &&
          !path.startsWith(".brain/transactions/"),
      ),
    );
    const run = subject(
      ANSWERS,
      partial,
      {},
      [],
      [".brain", ".brain/transactions"],
    );

    expect(await runCommandLine(["--json", "init"], run.ports)).toBe(0);

    const result: unknown = JSON.parse(run.output.structured_.join(""));
    expect(result).toMatchObject({
      summary: expect.stringContaining("preserved 20") as unknown,
    });
    expect(Object.keys(run.storage.snapshot().files)).toContain("CLAUDE.md");
  });

  it("initializes a project whose stack it does not recognize", async () => {
    const run = subject(ANSWERS, {}, {});
    const bare = {
      ...run,
      ports: {
        ...run.ports,
        fileSystem: memoryFileSystem({ "notes.txt": "" }),
      },
    };

    expect(await runCommandLine(["init"], bare.ports)).toBe(0);

    // A project this tool does not recognize is still a project it initializes.
    expect(
      run.storage.snapshot().files[".brain/01-architecture/stack-profile.md"],
    ).toContain("The technology was not identified.");
  });

  it("initializes a project whose only manifest is nested", async () => {
    // The reproduction from ADP-07: a solution under `src/Api/` used to report
    // no stack, no rules file, and no toolchain permission.
    const run = subject(ANSWERS, {}, {});
    const nested = {
      ...run,
      ports: {
        ...run.ports,
        fileSystem: memoryFileSystem({
          "src/Api/Api.csproj": "<Project />",
          "src/Api/Program.cs": "class Program {}",
        }),
      },
    };

    expect(await runCommandLine(["init"], nested.ports)).toBe(0);

    const files = run.storage.snapshot().files;
    const profile = files[".brain/01-architecture/stack-profile.md"] ?? "";
    expect(profile).toContain("| dotnet | `src/Api/Api.csproj` |");
    expect(profile).toContain("| csharp | 1 | `src/Api/Program.cs` |");
    expect(files[".claude/rules/dotnet.md"]).toContain("# .NET Conventions");
    expect(files[".claude/settings.json"]).toContain("Bash(dotnet test)");
  });

  it("derives the four commands from the toolchain the census named", async () => {
    // The reproduction from ADP-09: a .NET solution matches no manifest the
    // content reader parses, and the operator was asked for four commands the
    // runtime had already identified the toolchain for.
    const run = subject(ANSWERS, {}, {});
    const dotnet = {
      ...run,
      ports: {
        ...run.ports,
        fileSystem: memoryFileSystem({
          "Sample.sln": "Microsoft Visual Studio Solution File",
          "src/Api/Api.csproj": "<Project />",
          "src/Api/Program.cs": "class Program {}",
        }),
      },
    };

    expect(await runCommandLine(["init"], dotnet.ports)).toBe(0);

    const files = run.storage.snapshot().files;
    const config = JSON.parse(
      files[".brain/config.json"] ?? "null",
    ) as ProjectConfigV1_5;
    expect(config.projectProfile.commands).toEqual({
      test: {
        status: "derived",
        value: "dotnet test",
        evidence: "stack:dotnet via Sample.sln",
      },
      lint: {
        status: "derived",
        value: "dotnet format",
        evidence: "stack:dotnet via Sample.sln",
      },
      build: {
        status: "derived",
        value: "dotnet build",
        evidence: "stack:dotnet via Sample.sln",
      },
      run: {
        status: "derived",
        value: "dotnet run",
        evidence: "stack:dotnet via Sample.sln",
      },
    });
    expect(files[".brain/01-architecture/stack-profile.md"] ?? "").toContain(
      "### Test (derived from stack:dotnet via Sample.sln)",
    );
  });

  it("derives commands and paths from repository manifests when answers omit them", async () => {
    const pkg = JSON.stringify({
      scripts: {
        test: "vitest run",
        lint: "eslint .",
        build: "tsc -b",
        start: "node dist/index.js",
      },
    });
    const run = subject(
      ANSWERS,
      {},
      {
        "package.json": pkg,
        "src/index.ts": "console.log('hi');",
        "tests/index.test.ts": "test('hi', () => {});",
        "config/default.json": "{}",
      },
    );

    expect(await runCommandLine(["init"], run.ports)).toBe(0);

    const files = run.storage.snapshot().files;
    const config = JSON.parse(
      files[".brain/config.json"] ?? "null",
    ) as ProjectConfigV1_5;
    expect(config.projectProfile).toEqual({
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
        run: {
          status: "derived",
          value: "npm start",
          evidence: "package.json#scripts.start",
        },
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
        configuration: {
          status: "derived",
          value: ["config"],
          evidence: "directory:config",
        },
      },
      conventions: {
        directoryLayout: {
          status: "derived",
          value:
            "Place new source under `src/` at the repository root and its tests in the sibling `tests/` directory.",
          evidence: "layout:root src; 1 source file, 1 test file",
        },
        // Two file names attest to no casing, so that one is still asked.
        naming: { status: "unresolved" },
        implementationLanguages: {
          status: "derived",
          value: ["typescript"],
          evidence: "census:typescript",
        },
      },
    });

    const stackProfile = files[".brain/01-architecture/stack-profile.md"] ?? "";
    expect(stackProfile).toContain(
      "### Test (derived from package.json#scripts.test)",
    );
    expect(stackProfile).toContain(
      "### Lint (derived from package.json#scripts.lint)",
    );
    expect(stackProfile).toContain(
      "### Build (derived from package.json#scripts.build)",
    );
    expect(stackProfile).toContain(
      "### Run (derived from package.json#scripts.start)",
    );
    expect(stackProfile).toContain(
      "| Source | src (derived from directory:src) |",
    );
    expect(stackProfile).toContain(
      "| Tests | tests (derived from directory:tests) |",
    );
    expect(stackProfile).toContain(
      "| Configuration | config (derived from directory:config) |",
    );
  });

  it("refuses both an answers file and a piped document", async () => {
    const run = subject();

    const code = await runCommandLine(
      ["init", "--answers", "a.json"],
      run.ports,
    );

    // A precedence rule nobody can remember is worse than a refusal.
    expect(code).not.toBe(0);
    expect(run.storage.snapshot().files).toEqual({});
  });
});
