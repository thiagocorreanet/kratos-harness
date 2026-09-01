import { createHash } from "node:crypto";

import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  createSchemaRegistry,
  inspectManagedTransactions,
  recoverManagedMutation,
  type TransactionServices,
} from "@kratos/runtime/composition";
import {
  renderCuratedMemory,
  validateCuratedMemoryProjection,
} from "@kratos/runtime/domain/memory";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
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
const GOTCHAS =
  "# Gotchas\n\n## Confirmed lessons\n\n- Run codegen before tests.\n";
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function subject(gotchas = GOTCHAS) {
  const storage = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions", ".brain/03-memory"],
    files: { ".brain/03-memory/gotchas.md": gotchas },
  });
  const proposal = {
    contractVersion: "1.2.0",
    hostContract: "1.2.0",
    sourceDigest: sha256(gotchas),
    reviewer: "reviewer",
    lessons: [
      {
        title: "Run codegen before tests",
        why: ["Generated inputs are required."],
        apply: ["Run codegen before the test suite."],
        sourceRanges: [{ startLine: 5, endLine: 5 }],
      },
    ],
  };
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("memory-migration"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({
        "mapping.json": JSON.stringify(proposal),
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

function structuredSubject() {
  const title = "Clear stale cache";
  const why = ["Compiler state can be stale"];
  const apply = ["Clear compiler cache"];
  const candidateIds = ["c".repeat(64), "d".repeat(64)];
  const lessonId = sha256(
    canonicalizeJson({ title, why, apply, candidateIds }),
  );
  const provisional = {
    contractVersion: "1.0.0" as const,
    stateContract: "1.0.0" as const,
    revision: 2,
    projectionDigest: "",
    updatedAt: "2026-01-01T00:00:00Z",
    confirmed: [
      {
        lessonId,
        title,
        why,
        apply,
        candidateIds,
        reviewer: "alice",
        confirmedAt: "2026-01-01T00:00:00Z",
      },
    ],
    archive: [],
  };
  const projection = renderCuratedMemory(provisional);
  const ledger = { ...provisional, projectionDigest: sha256(projection) };
  const ledgerBytes = `${JSON.stringify(ledger, null, 2)}\n`;
  const storage = memoryTransactionStorage({
    directories: [".brain", ".brain/transactions", ".brain/03-memory"],
    files: {
      ".brain/03-memory/curated-memory.json": ledgerBytes,
      ".brain/03-memory/gotchas.md": projection,
    },
  });
  const proposal = {
    contractVersion: "1.4.0",
    hostContract: "1.4.0",
    sourceDigest: sha256(ledgerBytes),
    reviewer: "curator",
    lessons: [
      {
        lessonId,
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
      },
    ],
  };
  const output = recordingOutput();
  return {
    storage,
    output,
    ledgerBytes,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("memory-state-migration"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({
        "mapping.json": JSON.stringify(proposal),
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

function authorization(text: string) {
  const values = new Map<string, string>();
  for (const match of text.matchAll(
    /^(Proposal digest|Plan digest|Plan time): (.+)$/gmu,
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      values.set(match[1], match[2]);
  }
  return {
    proposalDigest: values.get("Proposal digest") ?? "",
    planDigest: values.get("Plan digest") ?? "",
    planTime: values.get("Plan time") ?? "",
  };
}

function applyArguments(value: ReturnType<typeof authorization>): string[] {
  return [
    "migrate",
    "memory",
    "mapping.json",
    "--yes",
    "--proposal-digest",
    value.proposalDigest,
    "--plan-digest",
    value.planDigest,
    "--plan-time",
    value.planTime,
  ];
}

function transactionServices(
  run: ReturnType<typeof subject>,
): TransactionServices {
  return {
    clock: fixedClock(NOW),
    ids: sequentialIds("memory-migration-recovery"),
    digests: run.storage.digests,
    durableFileSystem: run.storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

async function recoverLatest(run: ReturnType<typeof subject>): Promise<void> {
  const [summary] = await inspectManagedTransactions(transactionServices(run));
  if (summary === undefined)
    throw new Error("expected recoverable transaction");
  await recoverManagedMutation(
    {
      transactionId: summary.transactionId,
      recoveryToken: summary.recoveryToken,
    },
    transactionServices(run),
  );
}

function assertCuratedPair(run: ReturnType<typeof subject>): void {
  const files = run.storage.snapshot().files;
  const ledger = files[".brain/03-memory/curated-memory.json"];
  const projection = files[".brain/03-memory/gotchas.md"];
  expect(ledger).toBeDefined();
  expect(projection).toBeDefined();
  expect(
    validateCuratedMemoryProjection(
      JSON.parse(ledger ?? "") as Parameters<
        typeof validateCuratedMemoryProjection
      >[0],
      projection ?? "",
      (value) => run.storage.digests.sha256(value),
    ),
  ).toEqual({ kind: "valid" });
}

function receipt(run: ReturnType<typeof subject>): {
  readonly migrationId: string;
} {
  const files = run.storage.snapshot().files;
  const path = Object.keys(files).find((candidate) =>
    candidate.endsWith("/receipt.json"),
  );
  if (path === undefined) throw new Error("expected migration receipt");
  return JSON.parse(files[path] ?? "") as { readonly migrationId: string };
}

function raceAfterObservation(
  run: ReturnType<typeof subject>,
  path: string,
  replacement: string,
  occurrence: number,
): RuntimePorts {
  const durable = run.ports.durableFileSystem;
  let seen = 0;
  return {
    ...run.ports,
    durableFileSystem: {
      ...durable,
      inspect: async (candidate) => {
        const observed = await durable.inspect(candidate);
        if (candidate === path && ++seen === occurrence) {
          const staged = ".brain/03-memory/execution-race.tmp";
          await durable.writeSynced(staged, replacement);
          await durable.replaceFile(staged, path);
        }
        return observed;
      },
    },
  };
}

describe("legacy memory migration", () => {
  it("previews and applies the adjacent v1 to v1.1 metadata migration", async () => {
    const run = structuredSubject();
    expect(
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports),
    ).toBe(0);
    expect(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"],
    ).toBe(run.ledgerBytes);
    const preview = authorization(run.output.structured_.join(""));
    expect(await runCommandLine(applyArguments(preview), run.ports)).toBe(0);
    const files = run.storage.snapshot().files;
    const ledger = JSON.parse(
      files[".brain/03-memory/curated-memory.json"] ?? "",
    ) as {
      stateContract: string;
      confirmed: { observationCount: number; technology: string }[];
    };
    expect(ledger).toMatchObject({
      stateContract: "1.1.0",
      confirmed: [{ observationCount: 2, technology: "typescript" }],
    });
    expect(
      Object.keys(files).some((path) =>
        path.endsWith("/backup/curated-memory.json"),
      ),
    ).toBe(true);
    expect(
      Object.keys(files).some((path) => path.endsWith("/receipt.json")),
    ).toBe(true);
    const receiptPath = Object.keys(files).find((path) =>
      path.endsWith("/receipt.json"),
    );
    if (receiptPath === undefined) throw new Error("expected receipt");
    const migrationId = (
      JSON.parse(files[receiptPath] ?? "") as { migrationId: string }
    ).migrationId;
    expect(
      await runCommandLine(["migrate", "rollback", migrationId], run.ports),
    ).toBe(0);
    expect(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"],
    ).toBe(run.ledgerBytes);
  });

  it("requires migration before ordinary memory commands touch custom legacy gotchas", async () => {
    const run = subject();
    expect(await runCommandLine(["--json", "memory", "list"], run.ports)).toBe(
      4,
    );
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "memory.migration_required",
    });
  });

  it("previews without writes, applies the exact mapping with a backup and restores original bytes", async () => {
    const run = subject();
    const before = run.storage.snapshot();
    expect(
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports),
    ).toBe(0);
    expect(run.storage.snapshot()).toEqual(before);
    const preview = authorization(run.output.structured_.join(""));
    expect(preview.planDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(run.output.structured_.join("")).toContain(
      'Apply argv: ["kratos","migrate","memory","mapping.json","--yes"',
    );
    expect(run.output.structured_.join("")).toContain(
      "Apply command (PowerShell): & 'kratos' 'migrate' 'memory'",
    );

    expect(
      await runCommandLine(
        [
          "migrate",
          "memory",
          "mapping.json",
          "--yes",
          "--proposal-digest",
          preview.proposalDigest,
          "--plan-digest",
          preview.planDigest,
          "--plan-time",
          preview.planTime,
        ],
        run.ports,
      ),
    ).toBe(0);
    const files = run.storage.snapshot().files;
    expect(files[".brain/03-memory/curated-memory.json"]).toContain(
      "Run codegen before tests",
    );
    const receiptPath = Object.keys(files).find((path) =>
      path.endsWith("/receipt.json"),
    );
    expect(receiptPath).toBeDefined();
    const root = receiptPath?.slice(0, -"/receipt.json".length) ?? "";
    expect(files[`${root}/backup/gotchas.md`]).toBe(GOTCHAS);
    const receipt = JSON.parse(files[receiptPath ?? ""] ?? "null") as {
      migrationId: string;
    };

    expect(
      await runCommandLine(
        ["migrate", "rollback", receipt.migrationId],
        run.ports,
      ),
    ).toBe(0);
    expect(run.storage.snapshot().files[".brain/03-memory/gotchas.md"]).toBe(
      GOTCHAS,
    );
    expect(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"],
    ).toBeUndefined();
  });

  it("refuses apply when the previewed source bytes changed", async () => {
    const run = subject();
    expect(
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports),
    ).toBe(0);
    const preview = authorization(run.output.structured_.join(""));
    await run.ports.durableFileSystem.writeSynced(
      ".brain/03-memory/changed-gotchas.md",
      `${GOTCHAS}drift\n`,
    );
    await run.ports.durableFileSystem.replaceFile(
      ".brain/03-memory/changed-gotchas.md",
      ".brain/03-memory/gotchas.md",
    );
    expect(
      await runCommandLine(
        [
          "--json",
          "migrate",
          "memory",
          "mapping.json",
          "--yes",
          "--proposal-digest",
          preview.proposalDigest,
          "--plan-digest",
          preview.planDigest,
          "--plan-time",
          preview.planTime,
        ],
        run.ports,
      ),
    ).toBe(5);
    expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject({
      reasonCode: "runtime.revision_conflict",
    });
  });

  it.each([4, 7])(
    "recovers an interrupted migration publication at replace stage %i",
    async (stage) => {
      const run = subject();
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports);
      const preview = authorization(run.output.structured_.join(""));
      run.storage.fail({
        operation: "replace_file",
        timing: "before",
        occurrence: stage,
      });

      expect(await runCommandLine(applyArguments(preview), run.ports)).not.toBe(
        0,
      );
      expect(run.storage.failureHits()).toHaveLength(1);
      await recoverLatest(run);

      assertCuratedPair(run);
      expect(
        run.storage.snapshot().files[".brain/03-memory/gotchas.md"],
      ).not.toBe(GOTCHAS);
      expect(
        Object.values(run.storage.snapshot().files).some(
          (content) => content === GOTCHAS,
        ),
      ).toBe(true);
    },
  );

  it.each([1, 3])(
    "recovers an interrupted memory rollback at replace stage %i",
    async (stage) => {
      const run = subject();
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports);
      const preview = authorization(run.output.structured_.join(""));
      expect(await runCommandLine(applyArguments(preview), run.ports)).toBe(0);
      const nextReplace =
        run.storage.calls().filter((operation) => operation === "replace_file")
          .length + stage;
      run.storage.fail({
        operation: "replace_file",
        timing: "before",
        occurrence: nextReplace,
      });

      expect(
        await runCommandLine(
          ["migrate", "rollback", receipt(run).migrationId],
          run.ports,
        ),
      ).not.toBe(0);
      await recoverLatest(run);

      const files = run.storage.snapshot().files;
      if (files[".brain/03-memory/curated-memory.json"] === undefined) {
        expect(files[".brain/03-memory/gotchas.md"]).toBe(GOTCHAS);
      } else {
        assertCuratedPair(run);
      }
    },
  );

  it.each([
    [
      "ledger",
      ".brain/03-memory/curated-memory.json",
      "replacement-ledger\n",
      2,
    ],
    [
      "projection",
      ".brain/03-memory/gotchas.md",
      "replacement-projection\n",
      3,
    ],
  ] as const)(
    "refuses an apply execution race on the %s with its exact evidence path",
    async (_name, path, replacement, occurrence) => {
      const run = subject();
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports);
      const preview = authorization(run.output.structured_.join(""));
      const raced = raceAfterObservation(run, path, replacement, occurrence);

      expect(
        await runCommandLine(["--json", ...applyArguments(preview)], raced),
      ).toBe(5);
      expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject(
        {
          reasonCode: "runtime.revision_conflict",
          evidence: [{ kind: "artifact", ref: path }],
        },
      );
      expect(run.storage.snapshot().files[path]).toBe(replacement);
    },
  );

  it.each([
    [
      "ledger",
      ".brain/03-memory/curated-memory.json",
      "replacement-ledger\n",
      3,
    ],
    [
      "projection",
      ".brain/03-memory/gotchas.md",
      "replacement-projection\n",
      3,
    ],
  ] as const)(
    "refuses a rollback execution race on the %s without deleting changed state",
    async (_name, path, replacement, occurrence) => {
      const run = subject();
      await runCommandLine(["migrate", "memory", "mapping.json"], run.ports);
      const preview = authorization(run.output.structured_.join(""));
      expect(await runCommandLine(applyArguments(preview), run.ports)).toBe(0);
      const raced = raceAfterObservation(run, path, replacement, occurrence);

      expect(
        await runCommandLine(
          ["--json", "migrate", "rollback", receipt(run).migrationId],
          raced,
        ),
      ).toBe(5);
      expect(JSON.parse(run.output.structured_.at(-1) ?? "null")).toMatchObject(
        {
          reasonCode: "runtime.revision_conflict",
          evidence: [{ kind: "artifact", ref: path }],
        },
      );
      expect(run.storage.snapshot().files[path]).toBe(replacement);
    },
  );
});
