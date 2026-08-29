import type { ApprovalV1, EvidenceV1 } from "@kratos/contracts";

import type { GateAdvisory, GateDecision, GateMode } from "../gates/index.js";

export interface ArtifactLineage {
  readonly contractVersion: "1.0.0";
  readonly artifactId: string;
  readonly artifactRef: string;
  readonly artifactDigest: string;
  readonly parentDigests: readonly string[];
  readonly runId: string;
  readonly phase: string;
  readonly policyMode: GateMode;
  readonly policyVersion: string;
  readonly producerCommand: string;
  readonly commit: string | null;
  readonly evidenceRefs: readonly string[];
  readonly observedIdentity: {
    readonly host: string;
    readonly model: string | null;
    readonly provenance: "host-reported" | "user-declared" | "unknown";
  };
}

export type LineageValidation =
  | { readonly kind: "valid"; readonly orderedArtifactIds: readonly string[] }
  | {
      readonly kind:
        "cycle" | "duplicate" | "invalid-digest" | "missing-parent";
      readonly artifactId: string;
    };

export function validateLineageDag(
  nodes: readonly ArtifactLineage[],
  rootDigests: ReadonlySet<string>,
): LineageValidation {
  const byDigest = new Map<string, ArtifactLineage>();
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.artifactId) || byDigest.has(node.artifactDigest)) {
      return { kind: "duplicate", artifactId: node.artifactId };
    }
    if (!/^[a-f0-9]{64}$/u.test(node.artifactDigest)) {
      return { kind: "invalid-digest", artifactId: node.artifactId };
    }
    ids.add(node.artifactId);
    byDigest.set(node.artifactDigest, node);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (node: ArtifactLineage): LineageValidation | null => {
    if (visited.has(node.artifactId)) return null;
    if (visiting.has(node.artifactId)) {
      return { kind: "cycle", artifactId: node.artifactId };
    }
    visiting.add(node.artifactId);
    for (const parent of node.parentDigests) {
      if (rootDigests.has(parent)) continue;
      const parentNode = byDigest.get(parent);
      if (parentNode === undefined) {
        return { kind: "missing-parent", artifactId: node.artifactId };
      }
      const invalid = visit(parentNode);
      if (invalid !== null) return invalid;
    }
    visiting.delete(node.artifactId);
    visited.add(node.artifactId);
    ordered.push(node.artifactId);
    return null;
  };
  for (const node of [...nodes].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId, "en-US"),
  )) {
    const invalid = visit(node);
    if (invalid !== null) return invalid;
  }
  return { kind: "valid", orderedArtifactIds: ordered };
}

export interface DoneCandidate {
  readonly runId: string;
  readonly allStepsComplete: boolean;
  readonly gates: GateDecision;
  readonly approval: ApprovalV1 | null;
  readonly evidence: readonly EvidenceV1[];
  readonly invalidEvidenceIds: readonly string[];
  readonly lineage: readonly ArtifactLineage[];
}

export type DoneDecision =
  | {
      readonly kind: "accepted";
      readonly reasonCode: "done.all_steps";
      readonly evidenceRefs: readonly string[];
      readonly advisories?: readonly GateAdvisory[];
    }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        | "gate.aceitacao_final"
        | "trail.aceite_incompleto"
        | "trail.gate_divergente";
      readonly evidenceRefs: readonly string[];
      readonly advisories?: readonly GateAdvisory[];
    };

export function decideDone(candidate: DoneCandidate): DoneDecision {
  const evidenceRefs = candidate.evidence
    .map(({ ref }) => ref)
    .sort((left, right) => left.localeCompare(right, "en-US"));
  if (
    !candidate.allStepsComplete ||
    candidate.invalidEvidenceIds.length > 0 ||
    candidate.gates.criteria.length === 0 ||
    candidate.gates.criteria.some(
      ({ state, checked, evidenceValid }) =>
        state !== "passed" || !checked || !evidenceValid,
    )
  ) {
    return {
      kind: "refused",
      reasonCode: "trail.aceite_incompleto",
      evidenceRefs,
    };
  }
  if (candidate.gates.failures.length > 0) {
    return {
      kind: "refused",
      reasonCode: "trail.gate_divergente",
      evidenceRefs: [
        ...evidenceRefs,
        ...candidate.gates.failures.flatMap(({ evidenceRefs: refs }) => refs),
      ],
    };
  }
  if (
    candidate.approval?.decision !== "approved" ||
    candidate.approval.runId !== candidate.runId ||
    candidate.approval.gate !== "final-acceptance"
  ) {
    return {
      kind: "refused",
      reasonCode: "gate.aceitacao_final",
      evidenceRefs,
    };
  }
  if (
    candidate.lineage.length === 0 ||
    candidate.lineage.some(
      ({ runId, artifactDigest, policyVersion, producerCommand }) =>
        runId !== candidate.runId ||
        !/^[a-f0-9]{64}$/u.test(artifactDigest) ||
        policyVersion.length === 0 ||
        producerCommand.length === 0,
    )
  ) {
    return {
      kind: "refused",
      reasonCode: "trail.aceite_incompleto",
      evidenceRefs,
    };
  }
  const advisories = candidate.gates.advisories;
  const advisoryProps =
    advisories !== undefined && advisories.length > 0 ? { advisories } : {};
  return {
    kind: "accepted",
    reasonCode: "done.all_steps",
    evidenceRefs,
    ...advisoryProps,
  };
}
