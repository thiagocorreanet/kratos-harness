import { createHash } from "node:crypto";

import {
  digestPhaseAssignment,
  normalizeModelAssignment,
  roleForPhase,
  resolvePhaseAssignment,
  type HostModelCatalog,
  type ResolvedPhaseAssignment,
} from "@kratos/runtime/domain/model-roles";
import { describe, expect, it } from "vitest";

import {
  claudeCatalog,
  codexCatalog,
  equalAliasInput,
  roleConfig,
} from "./support/model-routing.js";

const sha256 = (canonical: string): string =>
  createHash("sha256").update(canonical, "utf8").digest("hex");

const resolvedReview: ResolvedPhaseAssignment = {
  phase: "review",
  role: "judge",
  model: "judge-canonical",
  effort: "medium",
};

function resolved(input: Parameters<typeof resolvePhaseAssignment>[0]) {
  return resolvePhaseAssignment(input);
}

describe("model role resolution", () => {
  it.each([
    ["prd", "planner"],
    ["spec", "planner"],
    ["plan", "planner"],
    ["code", "implementer"],
    ["review", "judge"],
    ["acceptance", "judge"],
  ] as const)("binds %s to %s", (phase, role) => {
    expect(roleForPhase(phase)).toBe(role);
  });

  it("normalizes the bare and object forms identically", () => {
    expect(normalizeModelAssignment("model-a")).toEqual(
      normalizeModelAssignment({ model: "model-a", effort: "medium" }),
    );
  });

  it("returns the canonical model bound to the phase role", () => {
    expect(
      resolved({
        phase: "code",
        host: "codex",
        configuration: roleConfig("codex", {
          planner: "planner-alias",
          implementer: { model: "impl-alias", effort: "high" },
          judge: "judge-alias",
        }),
        catalog: codexCatalog(),
      }),
    ).toEqual({
      kind: "resolved",
      assignment: {
        phase: "code",
        role: "implementer",
        model: "implementer-canonical",
        effort: "high",
      },
    });
  });

  it("refuses a host without a role map", () => {
    expect(
      resolved({
        phase: "review",
        host: "claude",
        configuration: roleConfig("codex", {
          planner: "planner",
          implementer: "implementer",
          judge: "judge",
        }),
        catalog: claudeCatalog(),
      }),
    ).toEqual({ kind: "refused", reasonCode: "model.host_missing" });
  });

  it("refuses a missing mapped role instead of using a catalog default", () => {
    expect(
      resolved({
        phase: "code",
        host: "codex",
        configuration: roleConfig("codex", {
          planner: "planner",
          judge: "judge",
        }),
        catalog: codexCatalog(),
      }),
    ).toEqual({ kind: "refused", reasonCode: "model.role_missing" });
  });

  it("refuses an unknown configured alias", () => {
    expect(
      resolved({
        phase: "review",
        host: "codex",
        configuration: roleConfig("codex", {
          planner: "planner",
          implementer: "implementer",
          judge: "unknown-model",
        }),
        catalog: codexCatalog(),
      }),
    ).toEqual({ kind: "refused", reasonCode: "model.resolution_unavailable" });
  });

  it("refuses an alias that identifies more than one catalog model", () => {
    const catalog: HostModelCatalog = {
      ...codexCatalog(),
      models: [
        ...codexCatalog().models,
        {
          canonicalModel: "other-canonical",
          aliases: ["judge-alias", "other"],
          efforts: ["medium"],
        },
      ],
    };

    expect(
      resolved({
        phase: "review",
        host: "codex",
        configuration: roleConfig("codex", {
          planner: "planner",
          implementer: "implementer",
          judge: "judge-alias",
        }),
        catalog,
      }),
    ).toEqual({ kind: "refused", reasonCode: "model.resolution_unavailable" });
  });

  it("refuses an effort unsupported by the canonical model", () => {
    expect(
      resolved({
        phase: "code",
        host: "codex",
        configuration: roleConfig("codex", {
          planner: "planner",
          implementer: { model: "implementer", effort: "low" },
          judge: "judge",
        }),
        catalog: codexCatalog(),
      }),
    ).toEqual({ kind: "refused", reasonCode: "model.effort_unsupported" });
  });

  it("rejects aliases whose canonical implementer and judge are equal", () => {
    expect(resolved(equalAliasInput("review"))).toEqual({
      kind: "refused",
      reasonCode: "model.independence_violation",
    });
  });

  it("checks implementer and judge independence before planner assignment", () => {
    expect(resolved(equalAliasInput("prd"))).toEqual({
      kind: "refused",
      reasonCode: "model.independence_violation",
    });
  });

  it("binds assignment digests deterministically", () => {
    const input = {
      configDigest: "config-digest",
      runId: "run-123",
      revision: 7,
      host: "codex" as const,
      assignment: resolvedReview,
    };

    expect(digestPhaseAssignment(input, sha256)).toBe(
      digestPhaseAssignment(input, sha256),
    );
  });

  it.each([
    ["config digest", { configDigest: "other-config" }],
    ["run id", { runId: "other-run" }],
    ["revision", { revision: 8 }],
    ["host", { host: "claude" as const }],
    [
      "phase",
      { assignment: { ...resolvedReview, phase: "acceptance" as const } },
    ],
    [
      "role",
      { assignment: { ...resolvedReview, role: "implementer" as const } },
    ],
    ["model", { assignment: { ...resolvedReview, model: "other-model" } }],
    ["effort", { assignment: { ...resolvedReview, effort: "high" } }],
  ] as const)("changes the digest when %s changes", (_field, changed) => {
    const input = {
      configDigest: "config-digest",
      runId: "run-123",
      revision: 7,
      host: "codex" as const,
      assignment: resolvedReview,
    };

    expect(digestPhaseAssignment({ ...input, ...changed }, sha256)).not.toBe(
      digestPhaseAssignment(input, sha256),
    );
  });
});
