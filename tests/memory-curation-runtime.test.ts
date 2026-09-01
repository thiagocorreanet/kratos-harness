import { createHash } from "node:crypto";

import type { CuratedMemoryV1_1 } from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { renderCuratedMemory } from "@kratos/runtime/domain/memory";
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

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const NOW = "2026-09-01T12:00:00.000Z";

function fixture(): CuratedMemoryV1_1 {
  const ledger: CuratedMemoryV1_1 = {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    revision: 3,
    projectionDigest: "0".repeat(64),
    updatedAt: "2026-08-20T00:00:00Z",
    confirmed: [
      {
        lessonId: "a".repeat(64),
        title: "Compiler cache becomes stale",
        why: ["Compiler cache contains stale paths"],
        apply: ["Remove compiler cache before retry"],
        candidateIds: ["c".repeat(64)],
        reviewer: "alice",
        confirmedAt: "2026-08-01T00:00:00Z",
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
        observationCount: 3,
        firstObservedAt: "2026-07-01T00:00:00Z",
        lastObservedAt: "2026-08-01T00:00:00Z",
      },
      {
        lessonId: "b".repeat(64),
        title: "Stale compiler state fails builds",
        why: ["Stale paths remain in compiler cache"],
        apply: ["Remove compiler cache before retry"],
        candidateIds: ["d".repeat(64)],
        reviewer: "bob",
        confirmedAt: "2026-08-02T00:00:00Z",
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
        observationCount: 2,
        firstObservedAt: "2026-06-01T00:00:00Z",
        lastObservedAt: "2026-08-02T00:00:00Z",
      },
    ],
    archive: [],
  };
  const projection = renderCuratedMemory(ledger as never);
  return { ...ledger, projectionDigest: sha256(projection) };
}

function subject() {
  const ledger = fixture();
  const projection = renderCuratedMemory(ledger as never);
  const storage = memoryTransactionStorage({
    directories: [
      ".brain",
      ".brain/transactions",
      ".brain/03-memory",
      ".brain/03-memory/candidates",
    ],
    files: {
      ".brain/03-memory/curated-memory.json": `${JSON.stringify(ledger, null, 2)}\n`,
      ".brain/03-memory/gotchas.md": projection,
      "tsconfig.json": "{}\n",
    },
  });
  const output = recordingOutput();
  const fileSystem = memoryFileSystem({ "tsconfig.json": "{}\n" });
  return {
    ledger,
    projection,
    storage,
    output,
    fileSystem,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem,
      environment: fixedEnvironment({}, "/project"),
      git: stubGit(),
      modelRouting: fixedModelRouting([claudeCatalog()]),
      output,
      standardInput: pipedInput(null),
      workspace: memoryWorkspace({ directories: ["/project"] }),
    } as unknown as RuntimePorts,
  };
}

function parsePlan(text: string): {
  planDigest: string;
  proposals: { proposalId: string; type: string }[];
} {
  const start = text.indexOf("{\n");
  return JSON.parse(text.slice(start)) as {
    planDigest: string;
    proposals: { proposalId: string; type: string }[];
  };
}

function authorization(text: string) {
  const value = (label: string): string =>
    new RegExp(`^${label}: (.+)$`, "mu").exec(text)?.[1] ?? "";
  return {
    approvalDigest: value("Approval digest"),
    planDigest: value("Plan digest"),
    planTime: value("Plan time"),
  };
}

describe("memory curate runtime", () => {
  it("previews and applies explicit reinforcement with candidate cleanup", async () => {
    const run = subject();
    const candidateId = "c".repeat(64);
    const candidatePath = `.brain/03-memory/candidates/${candidateId}.json`;
    await run.ports.durableFileSystem.writeSynced(
      candidatePath,
      `${JSON.stringify({
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        candidateId,
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: "cache failed again",
        observationCount: 2,
        firstObservedAt: "2026-08-20T00:00:00Z",
        lastObservedAt: "2026-08-30T00:00:00Z",
      })}\n`,
    );
    await run.fileSystem.write(
      "reinforce.json",
      `${JSON.stringify({
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        operation: "reinforce",
        reviewer: "curator",
        lessonId: "a".repeat(64),
        candidateIds: [candidateId],
      })}\n`,
    );
    const previewExit = await runCommandLine(
      ["memory", "reinforce", "reinforce.json"],
      run.ports,
    );
    if (previewExit !== 0)
      throw new Error(
        [...run.output.structured_, ...run.output.human_].join(""),
      );
    const auth = (() => {
      const text = run.output.structured_.join("");
      const get = (label: string): string =>
        new RegExp(`^${label}: (.+)$`, "mu").exec(text)?.[1] ?? "";
      return {
        proposalDigest: get("Proposal digest"),
        planDigest: get("Plan digest"),
        planTime: get("Plan time"),
      };
    })();
    expect(
      await runCommandLine(
        [
          "memory",
          "reinforce",
          "reinforce.json",
          "--yes",
          "--proposal-digest",
          auth.proposalDigest,
          "--plan-digest",
          auth.planDigest,
          "--plan-time",
          auth.planTime,
        ],
        run.ports,
      ),
    ).toBe(0);
    const next = JSON.parse(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
        "",
    ) as CuratedMemoryV1_1;
    expect(
      next.confirmed.find(({ lessonId }) => lessonId === "a".repeat(64)),
    ).toMatchObject({
      observationCount: 5,
      lastObservedAt: "2026-08-30T00:00:00Z",
    });
    expect(run.storage.snapshot().files[candidatePath]).toBeUndefined();
  });

  it("requires an explicit date and produces byte-identical scored plans", async () => {
    const missing = subject();
    expect(await runCommandLine(["memory", "curate"], missing.ports)).toBe(2);

    const first = subject();
    const second = subject();
    const firstExit = await runCommandLine(
      ["memory", "curate", "--as-of", "2026-09-01"],
      first.ports,
    );
    if (firstExit !== 0)
      throw new Error(
        [...first.output.structured_, ...first.output.human_].join("") ||
          `exit ${String(firstExit)}`,
      );
    expect(
      await runCommandLine(
        ["memory", "curate", "--as-of", "2026-09-01"],
        second.ports,
      ),
    ).toBe(0);
    expect(first.output.structured_.join("")).toBe(
      second.output.structured_.join(""),
    );
    const plan = parsePlan(first.output.structured_.join(""));
    expect(plan.proposals[0]).toMatchObject({ type: "merge" });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      first.storage.snapshot().files[".brain/03-memory/curated-memory.json"],
    ).toBe(`${JSON.stringify(first.ledger, null, 2)}\n`);
  });

  it("previews a complete approval and publishes all approved changes once", async () => {
    const run = subject();
    await runCommandLine(
      ["memory", "curate", "--as-of", "2026-09-01"],
      run.ports,
    );
    const plan = parsePlan(run.output.structured_.join(""));
    const approval = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      kind: "approval",
      reviewer: "curator",
      planDigest: plan.planDigest,
      decisions: plan.proposals.map(({ proposalId, type }) => ({
        proposalId,
        decision: type === "merge" ? "approve" : "reject",
      })),
    };
    await run.fileSystem.write(
      "approval.json",
      `${JSON.stringify(approval)}\n`,
    );
    run.output.structured_.length = 0;
    expect(
      await runCommandLine(
        ["memory", "curate", "--as-of", "2026-09-01", "approval.json"],
        run.ports,
      ),
    ).toBe(0);
    const auth = authorization(run.output.structured_.join(""));
    expect(auth.planDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await runCommandLine(
        [
          "memory",
          "curate",
          "--as-of",
          "2026-09-01",
          "approval.json",
          "--yes",
          "--plan-digest",
          auth.planDigest,
          "--approval-digest",
          auth.approvalDigest,
          "--plan-time",
          auth.planTime,
        ],
        run.ports,
      ),
    ).toBe(0);
    const next = JSON.parse(
      run.storage.snapshot().files[".brain/03-memory/curated-memory.json"] ??
        "",
    ) as CuratedMemoryV1_1;
    expect(next.revision).toBe(4);
    expect(next.confirmed).toHaveLength(1);
    expect(next.confirmed[0]?.observationCount).toBe(5);
    expect(next.archive).toHaveLength(2);
  });

  it("leaves both authoritative files byte-identical when publication is interrupted", async () => {
    const run = subject();
    await runCommandLine(
      ["memory", "curate", "--as-of", "2026-09-01"],
      run.ports,
    );
    const plan = parsePlan(run.output.structured_.join(""));
    const approval = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      kind: "approval",
      reviewer: "curator",
      planDigest: plan.planDigest,
      decisions: plan.proposals.map(({ proposalId }) => ({
        proposalId,
        decision: "approve",
      })),
    };
    await run.fileSystem.write(
      "approval.json",
      `${JSON.stringify(approval)}\n`,
    );
    run.output.structured_.length = 0;
    await runCommandLine(
      ["memory", "curate", "--as-of", "2026-09-01", "approval.json"],
      run.ports,
    );
    const auth = authorization(run.output.structured_.join(""));
    run.storage.fail({
      operation: "replace_file",
      timing: "before",
      occurrence: 1,
    });
    expect(
      await runCommandLine(
        [
          "memory",
          "curate",
          "--as-of",
          "2026-09-01",
          "approval.json",
          "--yes",
          "--plan-digest",
          auth.planDigest,
          "--approval-digest",
          auth.approvalDigest,
          "--plan-time",
          auth.planTime,
        ],
        run.ports,
      ),
    ).not.toBe(0);
    const files = run.storage.snapshot().files;
    expect(files[".brain/03-memory/curated-memory.json"]).toBe(
      `${JSON.stringify(run.ledger, null, 2)}\n`,
    );
    expect(files[".brain/03-memory/gotchas.md"]).toBe(run.projection);
  });
});
