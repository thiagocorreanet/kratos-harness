/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unused-vars */
import { runCommandLine } from "@kratos/runtime/composition/cli";
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
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { claudeCatalog } from "./support/model-routing.js";

const NOW = "2026-08-29T12:00:00.000Z";
const CANDIDATE = "a".repeat(64);
const LEDGER = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  revision: 0,
  projectionDigest:
    "09b049b364f55134c3b4942b653a7b677f7775fb67de8321064e6237da852e83",
  updatedAt: "1970-01-01T00:00:00Z",
  confirmed: [],
  archive: [],
};
const GOTCHAS =
  "# Gotchas\n\n## Confirmed lessons\n\nNo confirmed lessons.\n\n## Archived lessons\n\nNo archived lessons.\n";
const PROPOSAL = {
  contractVersion: "1.2.0",
  hostContract: "1.2.0",
  operation: "promote",
  reviewer: "reviewer",
  candidateIds: [CANDIDATE],
  title: "Avoid flaky build",
  why: ["The build needs its generated input."],
  apply: ["Generate inputs before build."],
};

function subject(now = NOW) {
  const storage = memoryTransactionStorage({
    directories: [
      ".brain",
      ".brain/transactions",
      ".brain/03-memory",
      ".brain/03-memory/candidates",
    ],
    files: {
      ".brain/03-memory/curated-memory.json": `${JSON.stringify(LEDGER, null, 2)}\n`,
      ".brain/03-memory/gotchas.md": GOTCHAS,
      [`.brain/03-memory/candidates/${CANDIDATE}.json`]: `${JSON.stringify(
        {
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          candidateId: CANDIDATE,
          toolFamily: "shell",
          failureClass: "nonzero_exit",
          exitCode: 1,
          diagnostic: "build input missing",
          firstObservedAt: NOW,
        },
        null,
        2,
      )}\n`,
    },
  });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(now),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({
        "proposal.json": `${JSON.stringify(PROPOSAL)}\n`,
      }),
      environment: fixedEnvironment({}, "/project"),
      git: stubGit(),
      modelRouting: fixedModelRouting([claudeCatalog()]),
      output,
      standardInput: pipedInput(null),
      workspace: memoryWorkspace({ directories: ["/project"] }),
    } as unknown as RuntimePorts,
  };
}

function applyArguments(
  authorization: ReturnType<typeof previewAuthorization>,
) {
  return [
    "memory",
    "promote",
    "proposal.json",
    "--yes",
    "--proposal-digest",
    authorization.proposalDigest,
    "--plan-digest",
    authorization.planDigest,
    "--plan-time",
    authorization.planTime,
  ];
}

function applyChange(
  operation: "merge" | "archive",
  proposal: string,
  authorization: ReturnType<typeof previewAuthorization>,
) {
  return [
    "memory",
    operation,
    proposal,
    "--yes",
    "--proposal-digest",
    authorization.proposalDigest,
    "--plan-digest",
    authorization.planDigest,
    "--plan-time",
    authorization.planTime,
  ];
}

async function overwrite(
  run: ReturnType<typeof subject>,
  path: string,
  content: string,
) {
  const staged = ".brain/03-memory/review-drift.tmp";
  await run.ports.durableFileSystem.writeSynced(staged, content);
  await run.ports.durableFileSystem.replaceFile(staged, path);
}

function previewAuthorization(text: string): {
  readonly proposalDigest: string;
  readonly planDigest: string;
  readonly planTime: string;
} {
  const values = new Map<string, string>();
  for (const match of text.matchAll(
    /^(Proposal digest|Plan digest|Plan time): (.+)$/gmu,
  )) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) values.set(key, value);
  }
  return {
    proposalDigest: values.get("Proposal digest") ?? "",
    planDigest: values.get("Plan digest") ?? "",
    planTime: values.get("Plan time") ?? "",
  };
}

describe("curated memory promotion", () => {
  it("keeps preview read-only then commits the ledger/projection pair before consuming candidates", async () => {
    const run = subject();
    expect(
      await runCommandLine(["memory", "promote", "proposal.json"], run.ports),
    ).toBe(0);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    expect(authorization.planDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      run.storage.snapshot().files[
        `.brain/03-memory/candidates/${CANDIDATE}.json`
      ],
    ).toBeDefined();

    expect(
      await runCommandLine(
        [
          "memory",
          "promote",
          "proposal.json",
          "--yes",
          "--proposal-digest",
          authorization.proposalDigest,
          "--plan-digest",
          authorization.planDigest,
          "--plan-time",
          authorization.planTime,
        ],
        run.ports,
      ),
    ).toBe(0);
    const files = run.storage.snapshot().files;
    expect(
      files[`.brain/03-memory/candidates/${CANDIDATE}.json`],
    ).toBeUndefined();
    const ledger = JSON.parse(
      files[".brain/03-memory/curated-memory.json"] ?? "",
    ) as { readonly confirmed: readonly unknown[] };
    expect(ledger.confirmed).toHaveLength(1);
    expect(files[".brain/03-memory/gotchas.md"]).toContain("Avoid flaky build");
  });

  it("does not consume candidates when the managed publication faults", async () => {
    const run = subject();
    await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    run.storage.fail({
      operation: "replace_file",
      timing: "before",
      occurrence: 1,
    });
    expect(
      await runCommandLine(
        [
          "memory",
          "promote",
          "proposal.json",
          "--yes",
          "--proposal-digest",
          authorization.proposalDigest,
          "--plan-digest",
          authorization.planDigest,
          "--plan-time",
          authorization.planTime,
        ],
        run.ports,
      ),
    ).toBe(2);
    const files = run.storage.snapshot().files;
    expect(
      files[`.brain/03-memory/candidates/${CANDIDATE}.json`],
    ).toBeDefined();
    expect(files[".brain/03-memory/curated-memory.json"]).toBe(
      `${JSON.stringify(LEDGER, null, 2)}\n`,
    );
    expect(files[".brain/03-memory/gotchas.md"]).toBe(GOTCHAS);
  });

  it("replays the reviewed plan time across a changed wall clock", async () => {
    const run = subject();
    await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    (run.ports as { clock: RuntimePorts["clock"] }).clock = fixedClock(
      "2026-09-01T00:00:00.000Z",
    );
    expect(await runCommandLine(applyArguments(authorization), run.ports)).toBe(
      0,
    );
    const ledger = JSON.parse(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
        "",
    ) as { updatedAt: string };
    expect(ledger.updatedAt).toBe(NOW);
  });

  it("refuses stale proposal, ledger, projection, and candidate observations", async () => {
    const cases: readonly [
      string,
      (run: ReturnType<typeof subject>) => Promise<void>,
    ][] = [
      [
        "proposal",
        async (run) =>
          run.ports.fileSystem.write(
            "proposal.json",
            `${JSON.stringify({ ...PROPOSAL, title: "Changed" })}\n`,
          ),
      ],
      [
        "ledger",
        async (run) =>
          overwrite(
            run,
            ".brain/03-memory/curated-memory.json",
            `${JSON.stringify({ ...LEDGER, updatedAt: "2026-08-30T00:00:00Z" })}\n`,
          ),
      ],
      [
        "projection",
        async (run) =>
          overwrite(run, ".brain/03-memory/gotchas.md", "changed\n"),
      ],
      [
        "candidate",
        async (run) =>
          overwrite(
            run,
            `.brain/03-memory/candidates/${CANDIDATE}.json`,
            `${JSON.stringify({ contractVersion: "1.0.0", stateContract: "1.0.0", candidateId: CANDIDATE, toolFamily: "shell", failureClass: "nonzero_exit", exitCode: 1, diagnostic: "changed", firstObservedAt: NOW })}\n`,
          ),
      ],
    ];
    for (const [_name, drift] of cases) {
      const run = subject();
      await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
      const authorization = previewAuthorization(
        run.output.structured_.join(""),
      );
      await drift(run);
      expect(
        await runCommandLine(applyArguments(authorization), run.ports),
      ).not.toBe(0);
      expect(
        run.storage.snapshot().files[
          `.brain/03-memory/candidates/${CANDIDATE}.json`
        ],
      ).toBeDefined();
    }
  });

  it("retains a candidate when post-commit cleanup fails", async () => {
    const run = subject();
    await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    run.storage.fail({
      operation: "remove_file",
      timing: "before",
      occurrence: 1,
    });
    expect(await runCommandLine(applyArguments(authorization), run.ports)).toBe(
      0,
    );
    expect(
      run.storage.snapshot().files[
        `.brain/03-memory/candidates/${CANDIDATE}.json`
      ],
    ).toBeDefined();
    expect(
      run.storage.snapshot().files[".brain/03-memory/gotchas.md"],
    ).toContain("Avoid flaky build");
  });

  it("previews and applies real archive commands", async () => {
    const run = subject();
    await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
    const promote = previewAuthorization(run.output.structured_.join(""));
    await runCommandLine(applyArguments(promote), run.ports);
    const lessonId = (
      JSON.parse(
        run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
          "",
      ) as { confirmed: { lessonId: string }[] }
    ).confirmed[0]!.lessonId;
    await run.ports.fileSystem.write(
      "archive.json",
      `${JSON.stringify({ contractVersion: "1.2.0", hostContract: "1.2.0", operation: "archive", reviewer: "reviewer", lessonId, reason: "obsolete" })}\n`,
    );
    expect(
      await runCommandLine(["memory", "archive", "archive.json"], run.ports),
    ).toBe(0);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    expect(
      await runCommandLine(
        applyChange("archive", "archive.json", authorization),
        run.ports,
      ),
    ).toBe(0);
    expect(
      (
        JSON.parse(
          run.storage.snapshot().files[
            ".brain/03-memory/curated-memory.json"
          ] ?? "",
        ) as { archive: unknown[] }
      ).archive,
    ).toHaveLength(1);
  });

  it("previews and applies real merge commands with source tombstones", async () => {
    const run = subject();
    await runCommandLine(["memory", "promote", "proposal.json"], run.ports);
    await runCommandLine(
      applyArguments(previewAuthorization(run.output.structured_.join(""))),
      run.ports,
    );
    const second = "b".repeat(64);
    await run.ports.durableFileSystem.writeSynced(
      `.brain/03-memory/candidates/${second}.json`,
      `${JSON.stringify({ contractVersion: "1.0.0", stateContract: "1.0.0", candidateId: second, toolFamily: "shell", failureClass: "nonzero_exit", exitCode: 1, diagnostic: "second", firstObservedAt: NOW })}\n`,
    );
    await run.ports.fileSystem.write(
      "second.json",
      `${JSON.stringify({ ...PROPOSAL, candidateIds: [second], title: "Second", why: ["second why"], apply: ["second apply"] })}\n`,
    );
    await runCommandLine(["memory", "promote", "second.json"], run.ports);
    await runCommandLine(
      [
        "memory",
        "promote",
        "second.json",
        "--yes",
        "--proposal-digest",
        previewAuthorization(run.output.structured_.join("")).proposalDigest,
        "--plan-digest",
        previewAuthorization(run.output.structured_.join("")).planDigest,
        "--plan-time",
        previewAuthorization(run.output.structured_.join("")).planTime,
      ],
      run.ports,
    );
    const lessonIds = (
      JSON.parse(
        run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
          "",
      ) as { confirmed: { lessonId: string }[] }
    ).confirmed.map(({ lessonId }) => lessonId);
    await run.ports.fileSystem.write(
      "merge.json",
      `${JSON.stringify({ contractVersion: "1.2.0", hostContract: "1.2.0", operation: "merge", reviewer: "reviewer", lessonIds, title: "Merged" })}\n`,
    );
    expect(
      await runCommandLine(["memory", "merge", "merge.json"], run.ports),
    ).toBe(0);
    const authorization = previewAuthorization(run.output.structured_.join(""));
    expect(
      await runCommandLine(
        applyChange("merge", "merge.json", authorization),
        run.ports,
      ),
    ).toBe(0);
    const ledger = JSON.parse(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
        "",
    ) as {
      confirmed: { why: string[]; apply: string[] }[];
      archive: { replacementLessonId: string | null }[];
    };
    expect(ledger.confirmed).toHaveLength(1);
    expect(ledger.confirmed[0]?.why).toEqual([
      "The build needs its generated input.",
      "second why",
    ]);
    expect(ledger.archive).toHaveLength(2);
    expect(
      ledger.archive.every(
        ({ replacementLessonId }) =>
          replacementLessonId ===
          (
            JSON.parse(
              run.storage.snapshot().files[
                ".brain/03-memory/curated-memory.json"
              ] ?? "",
            ) as { confirmed: { lessonId: string }[] }
          ).confirmed[0]?.lessonId,
      ),
    ).toBe(true);
  });
});
