import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

const ROOT = "/project";

const ANSWERS = JSON.stringify({
  contractVersion: "1.1.0",
  hostContract: "1.1.0",
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
            contractVersion: "1.1.0",
            hostContract: "1.1.0",
            hosts: ["claude", "codex"],
            language: "en",
            policyMode: "standard",
            snapshots: true,
            modelRoles: {
              claude: claudeCatalog().defaults,
              codex: codexCatalog().defaults,
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
    expect(await runCommandLine(["init"], again.ports)).toBe(0);

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

  it("reports every destination as created, updated, or preserved", async () => {
    const run = subject();

    await runCommandLine(["--json", "init"], run.ports);
    const result: unknown = JSON.parse(run.output.structured_.join(""));

    expect(result).toMatchObject({
      reasonCode: "trail.ok",
      summary: expect.stringContaining("Created 27") as unknown,
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
  });

  it("refuses a host the answers never enabled", async () => {
    const answers = JSON.stringify({
      contractVersion: "1.1.0",
      hostContract: "1.1.0",
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
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
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
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
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
        contractVersion: "1.1.0",
        hostContract: "1.1.0",
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
      ).toContain('"language": "en"');
      expect(await readFile(join(target, "CLAUDE.md"), "utf8")).toContain(
        "BEGIN KRATOS MANAGED SECTION",
      );
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  });

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
      summary: expect.stringContaining("preserved 18") as unknown,
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
    ).toContain("No known stack matched");
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
