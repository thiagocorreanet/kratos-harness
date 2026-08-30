import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { observePhaseMemoryBinding } from "@kratos/runtime/composition/memory";
import {
  STOCK_GOTCHAS_TEMPLATE,
  projectCuratedMemory,
} from "@kratos/runtime/domain/memory";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { memoryTransactionStorage } from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

const registry = createSchemaRegistry();
const SHA256 = "a".repeat(64);

function memoryPorts(files: Readonly<Record<string, string>>): RuntimePorts {
  const storage = memoryTransactionStorage({
    files,
    directories: [".brain", ".brain/03-memory"],
  });
  return {
    durableFileSystem: storage.durableFileSystem,
    digests: storage.digests,
  } as RuntimePorts;
}

function populatedMemory(): Readonly<Record<string, string>> {
  const ports = memoryPorts({});
  const lesson = {
    title: "Avoid stale memory",
    why: ["Projections are evidence."],
    apply: ["Read the confirmed section."],
    candidateIds: ["b".repeat(64)],
    reviewer: "reviewer",
    confirmedAt: "2026-08-29T00:00:00Z",
  };
  const lessonId = ports.digests.sha256(
    canonicalizeJson({
      title: lesson.title,
      why: lesson.why,
      apply: lesson.apply,
      candidateIds: lesson.candidateIds,
    }),
  );
  const draft = {
    contractVersion: "1.0.0" as const,
    stateContract: "1.0.0" as const,
    revision: 1,
    projectionDigest: "",
    updatedAt: "2026-08-29T00:00:00Z",
    confirmed: [{ ...lesson, lessonId }],
    archive: [],
  };
  const projection = projectCuratedMemory(draft, ports.digests.sha256);
  const ledger = { ...draft, projectionDigest: projection.projectionDigest };
  return {
    ".brain/03-memory/curated-memory.json": JSON.stringify(ledger),
    ".brain/03-memory/gotchas.md": projection.content,
  };
}

describe("curated-memory phase bindings", () => {
  it("selects the closed v1.2 handoff and output contracts", () => {
    const handoff = registry.validate({
      id: "host.phase-handoff",
      version: "1.2.0",
      structuralReasonCode: "trail.output_invalido",
      value: {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        feature: "feature",
        runId: "run",
        revision: 1,
        phase: "code",
        host: "codex",
        assignment: {
          phase: "code",
          role: "implementer",
          model: "model",
          effort: "medium",
        },
        assignmentDigest: SHA256,
        objectiveDigest: SHA256,
        status: "active",
        gateOutcome: "pass",
        blockers: [],
        openGaps: 0,
        nextAction: "Complete code.",
        memory: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: SHA256,
          lessonIds: [],
        },
      },
    });
    expect(handoff.kind).toBe("valid");

    const output = registry.validate({
      id: "host.agent-output",
      version: "1.2.0",
      structuralReasonCode: "trail.output_invalido",
      value: {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        agent: "code",
        outcome: {
          status: "completed",
          next: "proceed",
          questions: [],
          blockers: [],
        },
        artifacts: [],
        changedFiles: [],
        payload: { stepId: "step", testsAdded: 0, testsPassed: true },
        memory: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: SHA256,
          lessonIds: [],
        },
      },
    });
    expect(output.kind).toBe("valid");
  });

  it("requires a null memory acknowledgement outside code and review", () => {
    const output = registry.validate({
      id: "host.agent-output",
      version: "1.2.0",
      structuralReasonCode: "trail.output_invalido",
      value: {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        agent: "prd",
        outcome: {
          status: "completed",
          next: "proceed",
          questions: [],
          blockers: [],
        },
        artifacts: [],
        changedFiles: [],
        payload: { objective: "Objective", requirementIds: [], gapIds: [] },
        memory: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: SHA256,
          lessonIds: [],
        },
      },
    });
    expect(output.kind).toBe("invalid");
  });

  it("binds empty and populated confirmed lessons from validated bytes", async () => {
    const empty = memoryPorts({
      ".brain/03-memory/gotchas.md": STOCK_GOTCHAS_TEMPLATE,
    });
    await expect(
      observePhaseMemoryBinding("code", empty, registry),
    ).resolves.toEqual({
      kind: "value",
      value: {
        ref: ".brain/03-memory/gotchas.md",
        sha256: empty.digests.sha256(STOCK_GOTCHAS_TEMPLATE),
        lessonIds: [],
      },
    });

    const files = populatedMemory();
    const populated = memoryPorts(files);
    const expected = JSON.parse(
      files[".brain/03-memory/curated-memory.json"] ?? "{}",
    ) as { readonly confirmed: readonly { readonly lessonId: string }[] };
    await expect(
      observePhaseMemoryBinding("review", populated, registry),
    ).resolves.toEqual({
      kind: "value",
      value: {
        ref: ".brain/03-memory/gotchas.md",
        sha256: populated.digests.sha256(
          files[".brain/03-memory/gotchas.md"] ?? "",
        ),
        lessonIds: expected.confirmed.map(({ lessonId }) => lessonId),
      },
    });
  });

  it("refuses migration-required and projection-drift phase context", async () => {
    await expect(
      observePhaseMemoryBinding(
        "code",
        memoryPorts({ ".brain/03-memory/gotchas.md": "Legacy note\n" }),
        registry,
      ),
    ).resolves.toEqual({
      kind: "refused",
      reasonCode: "memory.migration_required",
    });

    const drift = { ...populatedMemory() };
    drift[".brain/03-memory/gotchas.md"] = "changed\n";
    await expect(
      observePhaseMemoryBinding("review", memoryPorts(drift), registry),
    ).resolves.toEqual({
      kind: "refused",
      reasonCode: "memory.projection_drift",
    });
  });
});
