import type {
  ApprovalV1,
  EventV1,
  ReadableEvent,
  EvidenceV1,
  SnapshotV1,
} from "@kratos/contracts";

import type { Digests } from "../../ports/index.js";
import { canonicalizeJson } from "../schema/index.js";
import type { ArtifactLineage } from "../acceptance/index.js";
import type { GateDecision } from "../gates/index.js";

export interface Divergence {
  readonly field: string;
  readonly persisted: unknown;
  readonly replayed: unknown;
}

export type IntegrityAudit =
  | {
      readonly kind: "consistent";
      readonly snapshotDigest: string;
      readonly eventCursor: number;
    }
  | {
      readonly kind: "divergent";
      readonly snapshotDigest: string;
      readonly replayDigest: string;
      readonly divergences: readonly Divergence[];
    }
  | {
      readonly kind: "unreadable";
      readonly artifactRefs: readonly string[];
    };

export function auditSnapshot(
  persisted: SnapshotV1,
  replayed: SnapshotV1,
  digests: Pick<Digests, "sha256">,
): IntegrityAudit {
  const persistedCanonical = canonicalizeJson(persisted);
  const replayedCanonical = canonicalizeJson(replayed);
  const snapshotDigest = digests.sha256(persistedCanonical);
  if (persistedCanonical === replayedCanonical) {
    return {
      kind: "consistent",
      snapshotDigest,
      eventCursor: persisted.eventCursor,
    };
  }
  const fields = [
    ...new Set([...Object.keys(persisted), ...Object.keys(replayed)]),
  ]
    .sort()
    .flatMap((field) => {
      const left = persisted[field as keyof SnapshotV1];
      const right = replayed[field as keyof SnapshotV1];
      return canonicalizeJson(left) === canonicalizeJson(right)
        ? []
        : [{ field, persisted: left, replayed: right }];
    });
  return {
    kind: "divergent",
    snapshotDigest,
    replayDigest: digests.sha256(replayedCanonical),
    divergences: fields,
  };
}

export interface RepairPlan {
  readonly kind: "noop" | "ready" | "blocked";
  readonly writes: readonly {
    readonly path: string;
    readonly content: string;
    readonly expectedDigest: string | null;
  }[];
  readonly evidenceRefs: readonly string[];
  readonly planDigest: string;
}

export function planSnapshotRepair(
  audit: IntegrityAudit,
  path: string,
  replayed: SnapshotV1,
  digests: Pick<Digests, "sha256">,
): RepairPlan {
  if (audit.kind === "consistent") {
    return {
      kind: "noop",
      writes: [],
      evidenceRefs: [path],
      planDigest: digests.sha256("[]"),
    };
  }
  if (audit.kind === "unreadable") {
    return {
      kind: "blocked",
      writes: [],
      evidenceRefs: audit.artifactRefs,
      planDigest: digests.sha256("[]"),
    };
  }
  const writes = [
    {
      path,
      content: `${canonicalizeJson(replayed)}\n`,
      expectedDigest: audit.snapshotDigest,
    },
  ];
  return {
    kind: "ready",
    writes,
    evidenceRefs: [path],
    planDigest: digests.sha256(canonicalizeJson(writes)),
  };
}

export interface EvidenceBundle {
  readonly contractVersion: "1.0.0";
  readonly runId: string;
  readonly generatedAt: string;
  readonly events: readonly Pick<
    EventV1,
    "eventId" | "eventHash" | "reasonCode" | "occurredAt"
  >[];
  readonly evidence: readonly EvidenceV1[];
  readonly snapshot: Pick<
    SnapshotV1,
    "status" | "currentStep" | "eventCursor" | "eventHash" | "lineage"
  >;
  readonly gates: GateDecision;
  readonly approvals: readonly Pick<
    ApprovalV1,
    "approvalId" | "gate" | "decision" | "challenge" | "decidedAt" | "expiresAt"
  >[];
  readonly lineage: readonly ArtifactLineage[];
  readonly budget: {
    readonly allocated: number | null;
    readonly used: number | null;
  };
  readonly redactionReport: {
    readonly restrictedMetadata: number;
    readonly redacted: number;
  };
  readonly digest: string;
}

export function buildEvidenceBundle(
  input: {
    readonly runId: string;
    readonly generatedAt: string;
    readonly events: readonly ReadableEvent[];
    readonly evidence: readonly EvidenceV1[];
    readonly snapshot: SnapshotV1;
    readonly gates: GateDecision;
    readonly approvals: readonly ApprovalV1[];
    readonly lineage: readonly ArtifactLineage[];
    readonly budget: {
      readonly allocated: number | null;
      readonly used: number | null;
    };
  },
  digests: Pick<Digests, "sha256">,
): EvidenceBundle {
  const events = input.events.map(
    ({ eventId, eventHash, reasonCode, occurredAt }) => ({
      eventId,
      eventHash,
      reasonCode,
      occurredAt,
    }),
  );
  const evidence = [...input.evidence].sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId, "en-US"),
  );
  const approvals = input.approvals
    .map(({ approvalId, gate, decision, challenge, decidedAt, expiresAt }) => ({
      approvalId,
      gate,
      decision,
      challenge,
      decidedAt,
      expiresAt,
    }))
    .sort((left, right) =>
      left.approvalId.localeCompare(right.approvalId, "en-US"),
    );
  const lineage = [...input.lineage].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId, "en-US"),
  );
  const body = {
    contractVersion: "1.0.0" as const,
    runId: input.runId,
    generatedAt: input.generatedAt,
    events,
    evidence,
    snapshot: {
      status: input.snapshot.status,
      currentStep: input.snapshot.currentStep,
      eventCursor: input.snapshot.eventCursor,
      eventHash: input.snapshot.eventHash,
      lineage: input.snapshot.lineage,
    },
    gates: input.gates,
    approvals,
    lineage,
    budget: input.budget,
    redactionReport: {
      restrictedMetadata: evidence.filter(
        ({ classification }) => classification === "restricted",
      ).length,
      redacted: evidence.filter(({ redaction }) => redaction !== "none").length,
    },
  };
  return { ...body, digest: digests.sha256(canonicalizeJson(body)) };
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Render a self-contained local dashboard with no script or network access. */
export function renderStaticDashboard(bundle: EvidenceBundle): string {
  const rows = bundle.events
    .map(
      (event) =>
        `<tr><td>${html(event.occurredAt)}</td><td>${html(event.reasonCode)}</td><td><code>${html(event.eventHash)}</code></td></tr>`,
    )
    .join("");
  const gateRows = bundle.gates.failures
    .map(
      (gate) =>
        `<tr><td>${html(gate.gateId)}</td><td>${html(gate.reasonCode)}</td><td>${html(gate.mode)}</td></tr>`,
    )
    .join("");
  const evidenceRows = bundle.evidence
    .map(
      (entry) =>
        `<tr><td>${html(entry.kind)}</td><td>${html(entry.ref)}</td><td><code>${html(entry.sha256)}</code></td></tr>`,
    )
    .join("");
  return [
    "<!doctype html>",
    '<html lang="en"><meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
    `<title>Kratos run ${html(bundle.runId)}</title>`,
    "<style>body{font:14px system-ui;margin:2rem;max-width:80rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;text-align:left}code{word-break:break-all}</style>",
    `<h1>Run ${html(bundle.runId)}</h1>`,
    `<p>Bundle digest: <code>${html(bundle.digest)}</code></p>`,
    `<p>Status: ${html(bundle.snapshot.status)}. Policy: per-gate. Budget: ${html(bundle.budget.allocated === null ? "unbounded" : String(bundle.budget.allocated))}.</p>`,
    "<h2>Timeline</h2>",
    "<table><caption>Verified event timeline</caption><thead><tr><th>Time</th><th>Reason</th><th>Event hash</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    "<h2>Gate findings</h2>",
    "<table><caption>Gate decision trace</caption><thead><tr><th>Gate</th><th>Reason</th><th>Mode</th></tr></thead>",
    `<tbody>${gateRows}</tbody></table>`,
    "<h2>Evidence</h2>",
    "<table><caption>Digest-bound evidence</caption><thead><tr><th>Kind</th><th>Reference</th><th>Digest</th></tr></thead>",
    `<tbody>${evidenceRows}</tbody></table>`,
    `<p>Redaction report: ${String(bundle.redactionReport.redacted)} redacted; ${String(bundle.redactionReport.restrictedMetadata)} restricted metadata record.</p>`,
    "</html>\n",
  ].join("");
}
