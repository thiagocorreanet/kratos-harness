import { createHash } from "node:crypto";

import type { SnapshotV1 } from "@kratos/contracts";
import {
  authorizeConfigMigration,
  authorizeMigration,
  completeConfigMigration,
  completeMigration,
  plannedConfigMigration,
  plannedMigration,
  rollBackConfigMigration,
  rollBackMigration,
  upgradeProjectConfiguration,
  upgradeState,
} from "@kratos/runtime/domain/migration";
import {
  auditSnapshot,
  planSnapshotRepair,
  renderStaticDashboard,
} from "@kratos/runtime/domain/observability";
import { describe, expect, it } from "vitest";

const digests = {
  sha256: (value: string) => createHash("sha256").update(value).digest("hex"),
};
const digest = "a".repeat(64);
const snapshot = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  projectId: "project-01",
  runId: "run-01",
  status: "active",
  currentStep: "code",
  eventCursor: 4,
  eventHash: digest,
  policyVersion: "workflow-v1",
  lineage: { prdDigest: digest, specDigest: "b".repeat(64) },
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:04:00.000Z",
} satisfies SnapshotV1;

describe("transactional migration lifecycle", () => {
  it("requires matching authorization, verification, and backup for rollback", () => {
    const planned = plannedMigration({
      migrationId: "migration-01",
      sourceContract: "go-v3@0.6.5",
      planDigest: digest,
      authorizationRef: ".brain/migrations/authorization.json",
      backupDigest: "b".repeat(64),
      conversions: [
        {
          payloadContract: "state.snapshot",
          sourceDigest: "c".repeat(64),
          destinationDigest: "d".repeat(64),
        },
      ],
      rollbackRef: ".brain/migrations/rollback.json",
      now: "2026-08-15T12:00:00.000Z",
    });
    const authorized = authorizeMigration(
      planned,
      digest,
      ".brain/migrations/authorization.json",
      "2026-08-15T12:01:00.000Z",
    );
    expect(authorized?.status).toBe("authorized");
    if (authorized === null) return;
    const completed = completeMigration(
      authorized,
      [".brain/migrations/verification.json"],
      "2026-08-15T12:02:00.000Z",
    );
    expect(completed?.status).toBe("completed");
    if (completed === null) return;
    expect(
      rollBackMigration(completed, "b".repeat(64), "2026-08-15T12:03:00.000Z")
        ?.status,
    ).toBe("rolled-back");
  });

  it("applies only an unambiguous declared upgrade chain", () => {
    expect(
      upgradeState({ value: 1 }, "0.9.0", "1.0.0", [
        {
          from: "0.9.0",
          to: "1.0.0",
          upgrade: (value) => ({ ...(value as object), upgraded: true }),
        },
      ]),
    ).toMatchObject({ kind: "upgraded", path: ["0.9.0", "1.0.0"] });
  });

  it("upgrades only the configuration contract and adds resolved roles", () => {
    const upgraded = upgradeProjectConfiguration(
      {
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        pluginVersion: "0.4.0",
        hostContract: "1.0.0",
        language: "pt-BR",
        policyMode: "strict",
        managedState: {
          directory: ".brain",
          eventLog: "events.jsonl",
          snapshots: false,
        },
      },
      {
        codex: {
          planner: { model: "planner", effort: "medium" },
          implementer: { model: "implementer", effort: "high" },
          judge: { model: "judge", effort: "medium" },
        },
      },
    );

    expect(upgraded).toEqual({
      contractVersion: "1.2.0",
      stateContract: "1.2.0",
      pluginVersion: "0.4.0",
      hostContract: "1.2.0",
      language: {
        conversation: "pt-BR",
        documentation: "pt-BR",
        comments: "en",
        identifiers: "en",
        commits: "en",
        preserveConventions: true,
        enforcement: "advisory",
      },
      policyMode: "strict",
      managedState: {
        directory: ".brain",
        eventLog: "events.jsonl",
        snapshots: false,
      },
      modelRoles: {
        codex: {
          planner: { model: "planner", effort: "medium" },
          implementer: { model: "implementer", effort: "high" },
          judge: { model: "judge", effort: "medium" },
        },
      },
    });
  });

  it("binds replacement completion and rollback to exact digests", () => {
    const root = ".brain/migrations/config-01";
    const planned = plannedConfigMigration({
      migrationId: "config-01",
      planDigest: "1".repeat(64),
      authorizationRef: `${root}/authorization.json`,
      backupRef: `${root}/backup/config.json`,
      backupDigest: "2".repeat(64),
      destinationRef: ".brain/config.json",
      destinationDigest: "3".repeat(64),
      verificationRef: `${root}/verification.json`,
      now: "2026-08-28T12:00:00.000Z",
    });
    const authorized = authorizeConfigMigration(
      planned,
      "1".repeat(64),
      `${root}/authorization.json`,
      "2026-08-28T12:00:00.000Z",
    );
    expect(authorized?.status).toBe("authorized");
    if (authorized === null) return;
    const completed = completeConfigMigration(
      authorized,
      `${root}/verification.json`,
      "3".repeat(64),
      "2026-08-28T12:00:00.000Z",
    );
    expect(completed?.status).toBe("completed");
    if (completed === null) return;

    expect(
      rollBackConfigMigration(
        completed,
        "2".repeat(64),
        "3".repeat(64),
        "2026-08-28T12:01:00.000Z",
      )?.status,
    ).toBe("rolled-back");
    expect(
      rollBackConfigMigration(
        completed,
        "2".repeat(64),
        "4".repeat(64),
        "2026-08-28T12:01:00.000Z",
      ),
    ).toBeNull();
  });
});

describe("audit, repair, and static dashboard", () => {
  it("produces a digest-bound repair preview for divergent snapshots", () => {
    const persisted = {
      ...snapshot,
      currentStep: "review",
    } satisfies SnapshotV1;
    const audit = auditSnapshot(persisted, snapshot, digests);
    expect(audit).toMatchObject({
      kind: "divergent",
      divergences: [{ field: "currentStep" }],
    });
    const repair = planSnapshotRepair(
      audit,
      ".brain/02-features/example/runs/run-01/state.json",
      snapshot,
      digests,
    );
    expect(repair.kind).toBe("ready");
    expect(repair.writes).toHaveLength(1);
    expect(repair.planDigest).toHaveLength(64);
  });

  it("escapes every dynamic value in the script-free dashboard", () => {
    const dashboard = renderStaticDashboard({
      contractVersion: "1.0.0",
      runId: "run-<unsafe>",
      generatedAt: "2026-08-15T12:00:00.000Z",
      events: [],
      evidence: [],
      snapshot: {
        status: snapshot.status,
        currentStep: snapshot.currentStep,
        eventCursor: snapshot.eventCursor,
        eventHash: snapshot.eventHash,
        lineage: snapshot.lineage,
      },
      gates: {
        outcome: "pass",
        primary: null,
        failures: [],
        gateModes: {
          "context-readable": "enforce",
          "stop-loss": "enforce",
          "prd-present": "enforce",
          "spec-approved": "enforce",
          "gaps-closed": "enforce",
          "partition-approved": "enforce",
          "acceptance-criteria": "enforce",
          "final-acceptance": "enforce",
        },
        criteria: [],
      },
      approvals: [],
      lineage: [],
      budget: { allocated: null, used: null },
      redactionReport: { restrictedMetadata: 0, redacted: 0 },
      digest,
    });
    expect(dashboard).toContain("run-&lt;unsafe&gt;");
    expect(dashboard).not.toContain("<script");
    expect(dashboard).not.toContain("http://");
    expect(dashboard).not.toContain("https://");
  });
});
