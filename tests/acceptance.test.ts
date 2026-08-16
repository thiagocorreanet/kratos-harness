import type { ApprovalV1, EvidenceV1 } from "@kratos/contracts";
import {
  decideDone,
  validateLineageDag,
} from "@kratos/runtime/domain/acceptance";
import { describe, expect, it } from "vitest";

const approval = {
  runId: "run-01",
  gate: "final-acceptance",
  decision: "approved",
} as ApprovalV1;
const evidence = {
  evidenceId: "evidence-01",
  ref: ".brain/evidence/acceptance.json",
} as EvidenceV1;
const lineage = {
  contractVersion: "1.0.0" as const,
  artifactId: "artifact-01",
  artifactRef: ".brain/02-features/example/03-summa.md",
  artifactDigest: "a".repeat(64),
  parentDigests: ["b".repeat(64)],
  runId: "run-01",
  phase: "acceptance",
  policyMode: "enforce" as const,
  policyVersion: "workflow-v1",
  producerCommand: "sdd.continue:correlation-01",
  commit: null,
  evidenceRefs: [".brain/evidence/acceptance.json"],
  observedIdentity: {
    host: "codex",
    model: "gpt-5",
    provenance: "host-reported" as const,
  },
};

describe("done acceptance", () => {
  const candidate = {
    runId: "run-01",
    allStepsComplete: true,
    gates: {
      outcome: "pass" as const,
      primary: null,
      failures: [],
      mode: "enforce" as const,
    },
    approval,
    evidence: [evidence],
    invalidEvidenceIds: [],
    lineage: [lineage],
  };

  it("accepts only a complete, approved, evidenced lineage", () => {
    expect(decideDone(candidate)).toEqual({
      kind: "accepted",
      reasonCode: "done.all_steps",
      evidenceRefs: [".brain/evidence/acceptance.json"],
    });
  });

  it("keeps missing acceptance recoverable", () => {
    expect(decideDone({ ...candidate, approval: null })).toMatchObject({
      kind: "refused",
      reasonCode: "gate.aceitacao_final",
    });
  });

  it("refuses stale or incomplete lineage", () => {
    expect(
      decideDone({
        ...candidate,
        lineage: [{ ...lineage, runId: "run-other" }],
      }),
    ).toMatchObject({
      kind: "refused",
      reasonCode: "trail.aceite_incompleto",
    });
  });

  it("detects missing parents and lineage cycles", () => {
    const parent = { ...lineage, artifactDigest: "c".repeat(64) };
    const child = {
      ...lineage,
      artifactId: "artifact-02",
      artifactDigest: "d".repeat(64),
      parentDigests: [parent.artifactDigest],
    };
    expect(
      validateLineageDag([child, parent], new Set(lineage.parentDigests)),
    ).toMatchObject({
      kind: "valid",
    });
    expect(validateLineageDag([child], new Set())).toMatchObject({
      kind: "missing-parent",
      artifactId: "artifact-02",
    });
    expect(
      validateLineageDag(
        [{ ...parent, parentDigests: [child.artifactDigest] }, child],
        new Set(),
      ),
    ).toMatchObject({ kind: "cycle" });
  });
});
