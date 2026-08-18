import type {
  AgentOutputV1,
  ApprovalV1,
  EventV1,
  EvidenceV1,
  GapRecordV1,
  SnapshotV1,
} from "@kratos/contracts";

import {
  validateLineageDag,
  type ArtifactLineage,
} from "../domain/acceptance/index.js";
import {
  approvalChallenge,
  validateApproval,
} from "../domain/approvals/index.js";

import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import {
  replayEventStream,
  verifyEventStream,
} from "../domain/events/index.js";
import {
  ACTIVE_FEATURE_PATH,
  featurePaths,
} from "../domain/objective/index.js";
import type { Result } from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import {
  RUN_PHASES,
  workflowReducerRegistry,
  type RunLineage,
  type WorkflowObservation,
  type WorkflowReducerConfiguration,
} from "../domain/workflow/index.js";
import type { GitPath } from "../domain/git/index.js";
import { verifyEvidence } from "../domain/evidence/index.js";
import {
  extractAgentBlock,
  type AgentOutputObservation,
} from "../domain/agent/index.js";
import type { GapProposalObservation } from "../domain/gaps/index.js";
import { evaluateGates, type GateMode } from "../domain/gates/index.js";
import {
  inspectPrdDocument,
  type PrdDocumentObservation,
} from "../domain/feature-documents/index.js";
import {
  auditSnapshot,
  buildEvidenceBundle,
  planSnapshotRepair,
  renderStaticDashboard,
} from "../domain/observability/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";

const EMPTY_DIGEST =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Where a run's files live. The helpers that only read those paths take this
 * rather than the reducer configuration, so nothing can reach a lineage that
 * is not theirs to read.
 */
interface RunReference {
  readonly feature: string;
  readonly runId: string;
}

/** Where one run keeps everything it recorded. */
function runRoot(reference: RunReference): string {
  return `.brain/02-features/${reference.feature}/runs/${reference.runId}`;
}

export type ObservedWorkflow =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      readonly ports: RuntimePorts;
    };

export async function observeWorkflow(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedWorkflow> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  const feature = await activeFeature(anchored);
  const objectiveActive =
    feature !== null && (await hasActiveObjective(feature, anchored, registry));
  const objectiveDigest =
    feature === null
      ? EMPTY_DIGEST
      : await fileDigest(featurePaths(feature).state, anchored);
  const tokenBudget =
    feature === null
      ? null
      : await activeTokenBudget(feature, anchored, registry);
  const activeRun =
    feature === null ? null : await activeRunId(feature, anchored);
  const requestedRun = invocation.flags.get("--run-id");
  const runId =
    activeRun ??
    (typeof requestedRun === "string" ? requestedRun : anchored.ids.next());
  const observedPrd =
    feature === null
      ? {
          digest: EMPTY_DIGEST,
          document: { kind: "missing" as const },
          readable: true,
        }
      : await observePrd(feature, anchored);
  const observedLineage =
    feature === null
      ? { prdDigest: EMPTY_DIGEST, specDigest: EMPTY_DIGEST }
      : {
          prdDigest: observedPrd.digest,
          specDigest: await fileDigest(
            `.brain/02-features/${feature}/01-design.md`,
            anchored,
          ),
        };
  const projectId = `project-${anchored.digests
    .sha256(anchored.environment.workingDirectory())
    .slice(0, 32)}`;
  const location = {
    projectId,
    feature: feature ?? "unselected",
    runId,
  } as const;
  const run =
    feature === null
      ? {
          workflow: { kind: "absent", operations: [] } as const,
          events: [],
          persistedSnapshot: null,
          replayedSnapshot: null,
        }
      : await observeRun(location, anchored, registry);
  /**
   * Lineage is a fact of the run, not of the working tree the run is there to
   * change. An open run replays from the digests it committed at `run.started`;
   * only a run that does not exist yet takes the ones on disk, which is how
   * that fact gets recorded in the first place.
   */
  const configuration: WorkflowReducerConfiguration = {
    ...location,
    lineage: run.persistedSnapshot?.lineage ?? observedLineage,
  };
  const approvals = await observeApprovals(configuration, anchored, registry);
  const correlation = invocation.flags.get("--correlation-id");
  const host = invocation.flags.get("--host");
  const model = invocation.flags.get("--model");
  const occurredAt = anchored.clock.now().toISOString();
  const git = await observeGitContext(anchored);
  const policy = await observePolicy(anchored, registry);
  const evidence = await observeEvidence(configuration, anchored, registry);
  const gateFacts = await observeGateFacts(configuration, anchored, registry);
  const gaps = await observeGaps(configuration, anchored, registry);
  const gapProposal = await observeGapProposal(invocation, anchored, registry);
  const agentOutput = await observeAgentReply(invocation, anchored, registry);
  const agentOutputs = await observeAgentOutputs(
    configuration,
    anchored,
    registry,
  );
  const referencedFiles = await observeReferencedFiles(invocation, anchored);
  const artifactLineage = await observeArtifactLineage(
    configuration,
    observedLineage,
    anchored,
  );
  const validApprovals = approvals.values.filter((approval, index, values) => {
    const seen = new Set(
      values.slice(0, index).map(({ approvalId }) => approvalId),
    );
    return (
      validateApproval(
        approval,
        {
          runId,
          gate: approval.gate,
          prdDigest: observedLineage.prdDigest,
          specDigest: observedLineage.specDigest,
          policyVersion: "workflow-v1",
          policyMode: policy.mode,
          objectiveDigest,
          revision: approvalRevision(
            approval.gate,
            run.workflow.kind === "present" ? run.workflow.state.revision : 0,
          ),
        },
        occurredAt,
        seen,
        anchored.digests,
      ).kind === "valid"
    );
  });
  /**
   * Whether the specification the run is bound to has been approved.
   *
   * The same fact the `spec-approved` gate reads, exposed because it is also
   * the boundary gap detection stops at.
   */
  const specApproved = validApprovals.some(
    (approval) =>
      approval.gate === "spec" &&
      approval.decision === "approved" &&
      approval.prdDigest === observedLineage.prdDigest &&
      approval.specDigest === observedLineage.specDigest,
  );
  /**
   * The open-gap count the gates act on.
   *
   * After approval the remaining questions are technical by construction, so a
   * gap recorded past that point is history rather than a blocker. Applying the
   * boundary here as well as where the facts are derived keeps a run approved
   * after its last derivation honest.
   */
  const openGaps = specApproved ? 0 : gateFacts.openGaps;
  const phase =
    run.workflow.kind === "present"
      ? (run.workflow.state.currentStep ?? "acceptance")
      : "prd";
  const gateDecision = evaluateGates({
    mode: policy.mode,
    phase,
    contextReadable:
      policy.readable &&
      approvals.readable &&
      evidence.readable &&
      gateFacts.readable &&
      gaps.readable &&
      artifactLineage.readable &&
      observedPrd.readable &&
      run.workflow.kind !== "corrupt",
    stopLoss: gateFacts.stopLoss,
    prdDigest:
      observedLineage.prdDigest === EMPTY_DIGEST
        ? null
        : observedLineage.prdDigest,
    prdDocument: observedPrd.document,
    specDigest:
      observedLineage.specDigest === EMPTY_DIGEST
        ? null
        : observedLineage.specDigest,
    approvals: validApprovals,
    openGaps,
    partitionRequired: gateFacts.partitionRequired,
    partitionApproved: gateFacts.partitionApproved,
    finalAcceptance: validApprovals.some(
      ({ gate }) => gate === "final-acceptance",
    ),
  });
  const integrityAudit =
    run.workflow.kind === "corrupt"
      ? ({
          kind: "unreadable" as const,
          artifactRefs: [
            `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/events.jsonl`,
            `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/state.json`,
          ],
        } as const)
      : run.persistedSnapshot === null || run.replayedSnapshot === null
        ? null
        : auditSnapshot(
            run.persistedSnapshot,
            run.replayedSnapshot,
            anchored.digests,
          );
  const repairPlan =
    integrityAudit === null || run.replayedSnapshot === null
      ? null
      : planSnapshotRepair(
          integrityAudit,
          `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/state.json`,
          run.replayedSnapshot,
          anchored.digests,
        );
  const evidenceBundle =
    run.workflow.kind === "present" && run.replayedSnapshot !== null
      ? buildEvidenceBundle(
          {
            runId,
            generatedAt: occurredAt,
            events: run.events,
            evidence: evidence.values.filter(
              ({ evidenceId }) => !evidence.invalidIds.includes(evidenceId),
            ),
            snapshot: run.replayedSnapshot,
            gates: gateDecision,
            approvals: approvals.values,
            lineage: artifactLineage.readable ? artifactLineage.values : [],
            budget: { allocated: tokenBudget, used: null },
          },
          anchored.digests,
        )
      : null;
  return {
    kind: "observed",
    observation: {
      kind: "workflow",
      workflow: run.workflow,
      configuration,
      observedLineage,
      correlationId:
        typeof correlation === "string" ? correlation : anchored.ids.next(),
      eventId: anchored.ids.next(),
      occurredAt,
      objectiveActive,
      objectiveDigest,
      worktreeClean: git.clean,
      gitCommit: git.commit,
      observedIdentity: {
        host: typeof host === "string" ? host : "cli",
        model: typeof model === "string" ? model : null,
      },
      identityProvenance:
        typeof host === "string" || typeof model === "string"
          ? "user-declared"
          : "unknown",
      approvals: approvals.values,
      approvalsReadable: approvals.readable,
      evidence: evidence.values,
      invalidEvidenceIds: evidence.invalidIds,
      evidenceReadable: evidence.readable,
      gaps: gaps.values,
      gapsReadable: gaps.readable,
      gapProposal,
      agentOutput,
      agentOutputs: agentOutputs.values,
      agentOutputsReadable: agentOutputs.readable,
      gateFacts,
      openGaps,
      specApproved,
      referencedFiles,
      gateDecision,
      policyMode: policy.mode,
      tokenBudget,
      approvalChallenge: approvalChallenge(
        {
          runId,
          gate: invocation.positionals[0] ?? "final-acceptance",
          prdDigest: observedLineage.prdDigest,
          specDigest: observedLineage.specDigest,
          policyVersion: "workflow-v1",
          policyMode: policy.mode,
          objectiveDigest,
          revision: approvalRevision(
            invocation.positionals[0] ?? "final-acceptance",
            run.workflow.kind === "present" ? run.workflow.state.revision : 0,
          ),
        },
        anchored.digests,
      ),
      events: run.events,
      persistedSnapshot: run.persistedSnapshot,
      replayedSnapshot: run.replayedSnapshot,
      integrityAudit,
      repairPlan,
      evidenceBundle,
      dashboardHtml:
        evidenceBundle === null ? null : renderStaticDashboard(evidenceBundle),
    },
    ports: anchored,
  };
}

function approvalRevision(gate: string, revision: number): number {
  return gate === "final-acceptance" ? revision : 0;
}

/**
 * Lineage read back from disk is untrusted input. Widening the fields the
 * validation below actually re-checks keeps every guard meaningful instead of
 * asserting the parsed value already satisfies the contract.
 */
type ArtifactLineageCandidate = Omit<
  ArtifactLineage,
  "contractVersion" | "observedIdentity"
> & {
  readonly contractVersion: string;
  readonly observedIdentity?: ArtifactLineage["observedIdentity"] | undefined;
};

async function observeArtifactLineage(
  configuration: RunReference,
  observedLineage: RunLineage,
  ports: RuntimePorts,
): Promise<{
  readonly readable: boolean;
  readonly values: readonly ArtifactLineage[];
}> {
  const root = `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/lineage`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") return { readable: true, values: [] };
  if (entry.kind !== "directory") return { readable: false, values: [] };
  try {
    const values: ArtifactLineage[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) return { readable: false, values: [] };
      const parsed = JSON.parse(
        await ports.durableFileSystem.readText(`${root}/${name}`),
      ) as ArtifactLineageCandidate;
      if (
        parsed.contractVersion !== "1.0.0" ||
        typeof parsed.artifactId !== "string" ||
        typeof parsed.artifactRef !== "string" ||
        !/^[a-f0-9]{64}$/u.test(parsed.artifactDigest) ||
        !Array.isArray(parsed.parentDigests) ||
        !parsed.parentDigests.every(
          (digest: unknown) =>
            typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest),
        ) ||
        parsed.runId !== configuration.runId ||
        !RUN_PHASES.includes(parsed.phase as (typeof RUN_PHASES)[number]) ||
        !["shadow", "warn", "enforce"].includes(parsed.policyMode) ||
        typeof parsed.policyVersion !== "string" ||
        parsed.policyVersion.length === 0 ||
        typeof parsed.producerCommand !== "string" ||
        (parsed.commit !== null &&
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(parsed.commit)) ||
        !Array.isArray(parsed.evidenceRefs) ||
        !parsed.evidenceRefs.every((ref) => typeof ref === "string") ||
        typeof parsed.observedIdentity?.host !== "string" ||
        (parsed.observedIdentity.model !== null &&
          typeof parsed.observedIdentity.model !== "string") ||
        !["host-reported", "user-declared", "unknown"].includes(
          parsed.observedIdentity.provenance,
        )
      ) {
        return { readable: false, values: [] };
      }
      values.push(parsed as ArtifactLineage);
    }
    // Lineage files record the digests observed when their artifact was
    // produced, so the roots they may descend from are the ones on disk.
    const validation = validateLineageDag(
      values,
      new Set([observedLineage.prdDigest, observedLineage.specDigest]),
    );
    return validation.kind === "valid"
      ? { readable: true, values }
      : { readable: false, values: [] };
  } catch {
    return { readable: false, values: [] };
  }
}

interface ObservedGateFacts {
  readonly readable: boolean;
  readonly stopLoss: { readonly tripped: boolean; readonly exhausted: boolean };
  readonly openGaps: number;
  readonly partitionRequired: boolean;
  readonly partitionApproved: boolean;
}

/**
 * Read the facts the gates evaluate.
 *
 * Absence is not a failure: a project that has recorded nothing yet has no
 * open gaps, no tripped budget, and no partition to approve. Anything else
 * that cannot be read as the published contract fails closed, because a file
 * the runtime cannot understand is not evidence that everything is fine.
 */
async function observeGateFacts(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedGateFacts> {
  const empty = {
    readable: true,
    stopLoss: { tripped: false, exhausted: false },
    openGaps: 0,
    partitionRequired: false,
    partitionApproved: true,
  } as const;
  const path = `${runRoot(configuration)}/gates.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind === "missing") return empty;
  if (entry.kind !== "file") return { ...empty, readable: false };
  try {
    const validated = registry.validate({
      id: "state.gates",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (
      validated.kind !== "valid" ||
      validated.value.runId !== configuration.runId ||
      validated.value.openGaps !== validated.value.openGapIds.length
    ) {
      return { ...empty, readable: false };
    }
    return {
      readable: true,
      stopLoss: {
        tripped: validated.value.stopLoss.tripped,
        exhausted: validated.value.stopLoss.exhausted,
      },
      openGaps: validated.value.openGaps,
      partitionRequired: validated.value.partitionRequired,
      partitionApproved: validated.value.partitionApproved,
    };
  } catch {
    return { ...empty, readable: false };
  }
}

/**
 * Read every gap the run recorded.
 *
 * Gaps are read whole rather than counted, because the commands that answer
 * one need the record they are answering and the gate needs a count derived
 * from the same set.
 */
async function observeGaps(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly readable: boolean;
  readonly values: readonly GapRecordV1[];
}> {
  const root = `${runRoot(configuration)}/gaps`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") return { readable: true, values: [] };
  if (entry.kind !== "directory") return { readable: false, values: [] };
  try {
    const values: GapRecordV1[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) return { readable: false, values: [] };
      const path = `${root}/${name}`;
      const file = await ports.durableFileSystem.inspect(path);
      if (file.kind !== "file") return { readable: false, values: [] };
      const validated = registry.validate({
        id: "state.gap",
        version: "1.0.0",
        value: JSON.parse(
          await ports.durableFileSystem.readText(path),
        ) as unknown,
        structuralReasonCode: "runtime.state_corrupt",
      });
      if (
        validated.kind !== "valid" ||
        validated.value.runId !== configuration.runId ||
        `${validated.value.gapId}.json` !== name
      ) {
        return { readable: false, values: [] };
      }
      values.push(validated.value);
    }
    values.sort((left, right) =>
      left.gapId.localeCompare(right.gapId, "en-US"),
    );
    return { readable: true, values };
  } catch {
    return { readable: false, values: [] };
  }
}

/**
 * Read the proposal a gap-recording command was pointed at.
 *
 * The model authored it, so it is validated at the boundary and handed to the
 * decision as an outcome rather than as content to be trusted.
 */
async function observeGapProposal(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<GapProposalObservation> {
  if (invocation.command.path.join(" ") !== "gaps record") {
    return { kind: "absent" };
  }
  const ref = invocation.positionals[0];
  if (ref === undefined) return { kind: "absent" };
  try {
    const entry = await ports.durableFileSystem.inspect(ref);
    if (entry.kind !== "file") return { kind: "unreadable", ref };
    const validated = registry.validate({
      id: "host.gap-proposal",
      version: "1.0.0",
      value: JSON.parse(await ports.durableFileSystem.readText(ref)) as unknown,
      structuralReasonCode: "trail.uso",
    });
    return validated.kind === "valid"
      ? { kind: "valid", ref, value: validated.value }
      : { kind: "invalid", ref, diagnostics: validated.diagnostics };
  } catch {
    return { kind: "unreadable", ref };
  }
}

/**
 * Read the agent reply an output-recording command was pointed at.
 *
 * Extraction happens here, at the boundary, and the decision receives an
 * outcome rather than prose. Nothing below this line ever sees the reply text,
 * which is what keeps a domain decision from depending on phrasing.
 */
async function observeAgentReply(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<AgentOutputObservation> {
  if (invocation.command.path.join(" ") !== "agent record") {
    return { kind: "none" };
  }
  const ref = invocation.positionals[0];
  if (ref === undefined) return { kind: "none" };
  let reply: string;
  try {
    const entry = await ports.durableFileSystem.inspect(ref);
    if (entry.kind !== "file") return { kind: "unreadable", ref };
    reply = await ports.durableFileSystem.readText(ref);
  } catch {
    return { kind: "unreadable", ref };
  }
  const extracted = extractAgentBlock(reply);
  if (extracted.kind === "absent") return { kind: "absent", ref };
  if (extracted.kind === "malformed") {
    return { kind: "malformed", ref, reason: extracted.reason };
  }
  const validated = registry.validate({
    id: "host.agent-output",
    version: "1.0.0",
    value: extracted.value,
    structuralReasonCode: "trail.output_invalido",
  });
  return validated.kind === "valid"
    ? { kind: "valid", ref, value: validated.value }
    : { kind: "invalid", ref, diagnostics: validated.diagnostics };
}

/**
 * Read every agent output the run recorded.
 *
 * Recorded blocks are read back through the contract that admitted them, so a
 * derived view reads typed data and a file that no longer satisfies the
 * contract fails closed instead of reading as nothing recorded.
 */
async function observeAgentOutputs(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly readable: boolean;
  readonly values: readonly AgentOutputV1[];
}> {
  const root = `${runRoot(configuration)}/agent-output`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") return { readable: true, values: [] };
  if (entry.kind !== "directory") return { readable: false, values: [] };
  try {
    const values: AgentOutputV1[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) return { readable: false, values: [] };
      const path = `${root}/${name}`;
      const file = await ports.durableFileSystem.inspect(path);
      if (file.kind !== "file") return { readable: false, values: [] };
      const validated = registry.validate({
        id: "host.agent-output",
        version: "1.0.0",
        value: JSON.parse(
          await ports.durableFileSystem.readText(path),
        ) as unknown,
        structuralReasonCode: "trail.output_invalido",
      });
      if (
        validated.kind !== "valid" ||
        `${validated.value.agent}.json` !== name
      ) {
        return { readable: false, values: [] };
      }
      values.push(validated.value);
    }
    values.sort((left, right) =>
      left.agent.localeCompare(right.agent, "en-US"),
    );
    return { readable: true, values };
  } catch {
    return { readable: false, values: [] };
  }
}

async function observePolicy(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{ readonly readable: boolean; readonly mode: GateMode }> {
  const path = ".brain/config.json";
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return { readable: false, mode: "enforce" };
  try {
    const validated = registry.validate({
      id: "state.project-config",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (validated.kind !== "valid") {
      return { readable: false, mode: "enforce" };
    }
    return {
      readable: true,
      mode: validated.value.policyMode === "strict" ? "enforce" : "warn",
    };
  } catch {
    return { readable: false, mode: "enforce" };
  }
}

async function observeEvidence(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly readable: boolean;
  readonly values: readonly EvidenceV1[];
  readonly invalidIds: readonly string[];
}> {
  const root = `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/evidence`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") {
    return { readable: true, values: [], invalidIds: [] };
  }
  if (entry.kind !== "directory") {
    return { readable: false, values: [], invalidIds: [] };
  }
  try {
    const values: EvidenceV1[] = [];
    const invalidIds: string[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) {
        return { readable: false, values: [], invalidIds: [] };
      }
      const path = `${root}/${name}`;
      const file = await ports.durableFileSystem.inspect(path);
      if (file.kind !== "file") {
        return { readable: false, values: [], invalidIds: [] };
      }
      const validated = registry.validate({
        id: "state.evidence",
        version: "1.0.0",
        value: JSON.parse(
          await ports.durableFileSystem.readText(path),
        ) as unknown,
        structuralReasonCode: "runtime.state_corrupt",
      });
      if (validated.kind !== "valid") {
        return { readable: false, values: [], invalidIds: [] };
      }
      const value = validated.value;
      values.push(value);
      const source = await ports.durableFileSystem.inspect(value.ref);
      if (
        source.kind !== "file" ||
        verifyEvidence(
          value,
          await ports.durableFileSystem.readText(value.ref),
          ports.digests,
        ) !== "valid"
      ) {
        invalidIds.push(value.evidenceId);
      }
    }
    values.sort((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId, "en-US"),
    );
    invalidIds.sort((left, right) => left.localeCompare(right, "en-US"));
    return { readable: true, values, invalidIds };
  } catch {
    return { readable: false, values: [], invalidIds: [] };
  }
}

async function observeReferencedFiles(
  invocation: Invocation,
  ports: RuntimePorts,
): Promise<
  readonly {
    readonly ref: string;
    readonly content: string;
    readonly sha256: string;
  }[]
> {
  const requested = [
    invocation.flags.get("--artifact"),
    invocation.flags.get("--evidence"),
    ...(invocation.command.path.join(" ") === "evidence record"
      ? [invocation.positionals[0]]
      : []),
  ].filter((value): value is string => typeof value === "string");
  const observed: {
    ref: string;
    content: string;
    sha256: string;
  }[] = [];
  for (const ref of [...new Set(requested)]) {
    try {
      const entry = await ports.durableFileSystem.inspect(ref);
      if (entry.kind !== "file") continue;
      observed.push({
        ref,
        content: await ports.durableFileSystem.readText(ref),
        sha256: entry.sha256,
      });
    } catch {
      // Unsafe or unreadable references stay absent and fail closed later.
    }
  }
  return observed.sort((left, right) =>
    left.ref.localeCompare(right.ref, "en-US"),
  );
}

async function observeApprovals(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly readable: boolean;
  readonly values: readonly ApprovalV1[];
}> {
  const root = `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/approvals`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") return { readable: true, values: [] };
  if (entry.kind !== "directory") return { readable: false, values: [] };
  try {
    const values: ApprovalV1[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) return { readable: false, values: [] };
      const path = `${root}/${name}`;
      const file = await ports.durableFileSystem.inspect(path);
      if (file.kind !== "file") return { readable: false, values: [] };
      const validated = registry.validate({
        id: "state.approval",
        version: "1.0.0",
        value: JSON.parse(
          await ports.durableFileSystem.readText(path),
        ) as unknown,
        structuralReasonCode: "runtime.state_corrupt",
      });
      if (validated.kind !== "valid") return { readable: false, values: [] };
      values.push(validated.value);
    }
    values.sort((left, right) =>
      left.approvalId.localeCompare(right.approvalId, "en-US"),
    );
    return { readable: true, values };
  } catch {
    return { readable: false, values: [] };
  }
}

async function activeFeature(ports: RuntimePorts): Promise<string | null> {
  const entry = await ports.durableFileSystem.inspect(ACTIVE_FEATURE_PATH);
  if (entry.kind !== "file") return null;
  const value = (await ports.durableFileSystem.readText(ACTIVE_FEATURE_PATH))
    .split("\n")[0]
    ?.trim();
  return value === undefined || value === "" ? null : value;
}

async function hasActiveObjective(
  feature: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<boolean> {
  const entry = await ports.durableFileSystem.inspect(
    featurePaths(feature).state,
  );
  if (entry.kind !== "file") return false;
  try {
    const validated = registry.validate({
      id: "state.feature",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(featurePaths(feature).state),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return (
      validated.kind === "valid" &&
      validated.value.objective.status === "active"
    );
  } catch {
    return false;
  }
}

async function activeTokenBudget(
  feature: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<number | null> {
  const path = featurePaths(feature).state;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return null;
  try {
    const validated = registry.validate({
      id: "state.feature",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return validated.kind === "valid"
      ? (validated.value.objective.budget?.tokens ?? null)
      : null;
  } catch {
    return null;
  }
}

async function activeRunId(
  feature: string,
  ports: RuntimePorts,
): Promise<string | null> {
  const path = activeRunPath(feature);
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return null;
  const value = (await ports.durableFileSystem.readText(path))
    .split("\n")[0]
    ?.trim();
  return value === undefined || value === "" ? null : value;
}

export function activeRunPath(feature: string): string {
  return `.brain/02-features/${feature}/active-run`;
}

async function observePrd(
  feature: string,
  ports: RuntimePorts,
): Promise<{
  readonly digest: string;
  readonly document: PrdDocumentObservation;
  readonly readable: boolean;
}> {
  const path = `.brain/02-features/${feature}/00-prd.md`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind === "missing") {
    return {
      digest: EMPTY_DIGEST,
      document: inspectPrdDocument(null),
      readable: true,
    };
  }
  if (entry.kind !== "file") {
    return {
      digest: EMPTY_DIGEST,
      document: inspectPrdDocument(null),
      readable: false,
    };
  }
  try {
    return {
      digest: entry.sha256,
      document: inspectPrdDocument(
        await ports.durableFileSystem.readText(path),
      ),
      readable: true,
    };
  } catch {
    return {
      digest: entry.sha256,
      document: inspectPrdDocument(null),
      readable: false,
    };
  }
}

async function fileDigest(path: string, ports: RuntimePorts): Promise<string> {
  const entry = await ports.durableFileSystem.inspect(path);
  return entry.kind === "file" ? entry.sha256 : EMPTY_DIGEST;
}

async function observeRun(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly workflow: WorkflowObservation;
  readonly events: readonly EventV1[];
  readonly persistedSnapshot: SnapshotV1 | null;
  readonly replayedSnapshot: SnapshotV1 | null;
}> {
  const root = `.brain/02-features/${configuration.feature}/runs/${configuration.runId}`;
  const eventsPath = `${root}/events.jsonl`;
  const snapshotPath = `${root}/state.json`;
  const events = await ports.durableFileSystem.inspect(eventsPath);
  const snapshot = await ports.durableFileSystem.inspect(snapshotPath);
  if (events.kind === "missing" && snapshot.kind === "missing") {
    return {
      workflow: { kind: "absent", operations: [] },
      events: [],
      persistedSnapshot: null,
      replayedSnapshot: null,
    };
  }
  if (events.kind !== "file" || snapshot.kind !== "file") {
    return corruptRun();
  }
  try {
    const parsed = JSON.parse(
      await ports.durableFileSystem.readText(snapshotPath),
    ) as unknown;
    const validated = registry.validate({
      id: "state.snapshot",
      version: "1.0.0",
      value: parsed,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (validated.kind !== "valid") return corruptRun();
    const state = validated.value;
    // The run replays from the lineage it committed, exactly as every later
    // append does. Re-observing the working tree here would make the two
    // disagree the moment a phase wrote the file it exists to produce.
    const replayConfiguration: WorkflowReducerConfiguration = {
      projectId: state.projectId,
      feature: configuration.feature,
      runId: state.runId,
      lineage: state.lineage,
    };
    const services = {
      digests: ports.digests,
      isProxy: () => false,
      isPromise: () => false,
      schemaRegistry: registry,
    };
    const verified = verifyEventStream(
      await ports.durableFileSystem.readText(eventsPath),
      services,
    );
    const replay = replayEventStream(
      verified,
      workflowReducerRegistry(replayConfiguration),
      services,
    );
    return {
      workflow: { kind: "present", state: replay.state },
      events: verified.events,
      persistedSnapshot: state,
      replayedSnapshot: replay.snapshot,
    };
  } catch {
    return corruptRun();
  }
}

function corruptRun(): {
  readonly workflow: WorkflowObservation;
  readonly events: readonly EventV1[];
  readonly persistedSnapshot: null;
  readonly replayedSnapshot: null;
} {
  return {
    workflow: { kind: "corrupt" },
    events: [],
    persistedSnapshot: null,
    replayedSnapshot: null,
  };
}

function managed(path: GitPath): boolean {
  return (
    path.kind === "text" &&
    (path.value === ".brain" || path.value.startsWith(".brain/"))
  );
}

async function observeGitContext(
  ports: RuntimePorts,
): Promise<{ readonly clean: boolean; readonly commit: string | null }> {
  const observation = await ports.git.observe();
  if (
    observation.kind === "git_absent" ||
    observation.kind === "not_a_repository"
  ) {
    return { clean: true, commit: null };
  }
  if (observation.kind !== "observed") return { clean: false, commit: null };
  const head = observation.repository.head;
  return {
    clean: observation.repository.changes.every(
      ({ path, renamedFrom }) =>
        managed(path) && (renamedFrom === null || managed(renamedFrom)),
    ),
    commit: head.kind === "unborn" ? null : head.commit,
  };
}
