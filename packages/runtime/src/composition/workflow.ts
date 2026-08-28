import type {
  AgentOutputV1,
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  ApprovalV1,
  EventV1,
  EvidenceV1,
  GapRecordV1,
  ProjectConfigV1_1,
  SnapshotV1,
} from "@kratos/contracts";
import { CONTRACT_VERSIONS, type PhaseHandoffV1_1 } from "@kratos/contracts";

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
  digestPhaseAssignment,
  resolvePhaseAssignmentDetailed,
} from "../domain/model-roles/index.js";
import { classifyConfiguration } from "../domain/project/index.js";
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
import {
  evaluateGates,
  type GateDecision,
  type GateMode,
} from "../domain/gates/index.js";
import {
  inspectPrdDocument,
  type PrdDocumentObservation,
} from "../domain/feature-documents/index.js";
import { inspectTaskDocument } from "../domain/acceptance-criteria/index.js";
import {
  buildAcceptanceVerdict,
  buildCriteriaSnapshot,
  compareCriteriaSnapshot,
  decideAcceptanceVerdict,
  findLegacyPlanBaselineIndex,
} from "../domain/acceptance-criteria/index.js";
import {
  auditSnapshot,
  buildEvidenceBundle,
  planSnapshotRepair,
  renderStaticDashboard,
} from "../domain/observability/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { configurationValidator } from "./schema.js";

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
  const eventId = anchored.ids.next();
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
  const acceptanceCriteria = await observeAcceptanceCriteria(
    configuration,
    run.events,
    eventId,
    occurredAt,
    agentOutput,
    evidence,
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
  const verdictByCriterion = new Map(
    acceptanceCriteria.verdicts.map((verdict) => [
      verdict.criterionId,
      verdict,
    ]),
  );
  const acceptanceCriterionStates = acceptanceCriteria.currentDeclarations.map(
    (declaration) => {
      const verdict = verdictByCriterion.get(declaration.criterionId);
      const evidenceRecord =
        verdict === undefined
          ? undefined
          : evidence.values.find(
              ({ evidenceId }) => evidenceId === verdict.evidenceId,
            );
      return {
        criterionId: declaration.criterionId,
        state: verdict?.outcome ?? "unreported",
        checked: declaration.checked,
        evidenceValid:
          acceptanceCriteria.snapshotRef === verdict?.criteriaSnapshotRef &&
          acceptanceCriteria.snapshotDigest ===
            verdict.criteriaSnapshotDigest &&
          evidenceRecord?.ref === verdict.evidenceRef &&
          evidenceRecord.sha256 === verdict.evidenceDigest &&
          !evidence.invalidIds.includes(verdict.evidenceId),
      } as const;
    },
  );
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
      acceptanceCriteria.readable &&
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
    acceptanceCriteria: acceptanceCriterionStates,
  });
  const phaseAssignment = await observePhaseAssignment({
    phase,
    runId,
    revision: run.workflow.kind === "present" ? run.workflow.state.revision : 0,
    feature: configuration.feature,
    status:
      run.workflow.kind === "present" ? run.workflow.state.status : "idle",
    objectiveDigest,
    gateDecision,
    openGaps,
    launcherHost:
      typeof invocation.flags.get("--host") === "string"
        ? (invocation.flags.get("--host") as string)
        : anchored.environment.get("KRATOS_HOST"),
    ports: anchored,
    registry,
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
      phaseAssignment,
      correlationId:
        typeof correlation === "string" ? correlation : anchored.ids.next(),
      eventId,
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
      acceptanceCriteria,
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

async function observeAcceptanceCriteria(
  configuration: RunReference,
  events: readonly EventV1[],
  eventId: string,
  occurredAt: string,
  agentOutput: AgentOutputObservation,
  evidence: {
    readonly values: readonly EvidenceV1[];
    readonly invalidIds: readonly string[];
  },
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  Extract<
    CommandObservation,
    { readonly kind: "workflow" }
  >["acceptanceCriteria"]
> {
  const documentRef = `.brain/02-features/${configuration.feature}/02-tasks.md`;
  let documentContent: string | null = null;
  let documentDigest: string | null = null;
  let readable = true;
  const entry = await ports.durableFileSystem.inspect(documentRef);
  if (entry.kind === "file") {
    try {
      documentContent = await ports.durableFileSystem.readText(documentRef);
      documentDigest = entry.sha256;
    } catch {
      readable = false;
    }
  } else if (entry.kind !== "missing") {
    readable = false;
  }
  const document = inspectTaskDocument(documentContent);
  const currentDeclarations =
    document.kind === "valid"
      ? document.declarations.map((declaration) => ({
          criterionId: declaration.criterionId,
          workUnit: declaration.workUnit,
          task: declaration.task,
          kind: declaration.criterionKind,
          ordinal: declaration.ordinal,
          declarationDigest: ports.digests.sha256(
            declaration.normalizedDeclaration,
          ),
          checked: declaration.checked,
        }))
      : [];

  let snapshot: AcceptanceCriteriaSnapshotV1 | null = null;
  let snapshotRef: string | null = null;
  let snapshotDigest: string | null = null;
  const verdicts: AcceptanceVerdictV1[] = [];
  for (const event of events) {
    let eventSnapshotBinding: { ref: string; digest: string } | null = null;
    for (const recordedRef of event.artifactRefs) {
      const anchored = parseArtifactDigestRef(recordedRef);
      if (
        anchored !== null &&
        event.artifactRefs.includes(anchored.artifactRef)
      ) {
        continue;
      }
      const ref = anchored?.artifactRef ?? recordedRef;
      const snapshotMatch = /\/acceptance\/criteria\/([^/]+)\.json$/u.exec(ref);
      const verdictMatch =
        /\/acceptance\/verdicts\/([^/]+)\/(AC-\d+\.\d+\.E?\d+)\.json$/u.exec(
          ref,
        );
      if (snapshotMatch === null && verdictMatch === null) continue;
      try {
        const artifact = await ports.durableFileSystem.inspect(ref);
        if (artifact.kind !== "file") {
          readable = false;
          continue;
        }
        const expectedDigest =
          anchored?.digest ??
          event.artifactRefs
            .map(parseArtifactDigestRef)
            .find((candidate) => candidate?.artifactRef === ref)?.digest;
        if (expectedDigest !== artifact.sha256) {
          readable = false;
          continue;
        }
        const parsed = JSON.parse(
          await ports.durableFileSystem.readText(ref),
        ) as unknown;
        if (snapshotMatch !== null) {
          const validated = registry.validate({
            id: "state.acceptance-criteria-snapshot",
            version: "1.0.0",
            value: parsed,
            structuralReasonCode: "runtime.state_corrupt",
          });
          if (
            validated.kind !== "valid" ||
            validated.value.runId !== configuration.runId ||
            validated.value.eventId !== event.eventId ||
            snapshotMatch[1] !== event.eventId
          ) {
            readable = false;
            continue;
          }
          snapshot = validated.value;
          snapshotRef = ref;
          snapshotDigest = artifact.sha256;
        } else if (verdictMatch !== null) {
          const validated = registry.validate({
            id: "state.acceptance-verdict",
            version: "1.0.0",
            value: parsed,
            structuralReasonCode: "runtime.state_corrupt",
          });
          if (
            validated.kind !== "valid" ||
            validated.value.runId !== configuration.runId ||
            validated.value.eventId !== event.eventId ||
            verdictMatch[1] !== event.eventId ||
            verdictMatch[2] !== validated.value.criterionId
          ) {
            readable = false;
            continue;
          }
          const binding = {
            ref: validated.value.criteriaSnapshotRef,
            digest: validated.value.criteriaSnapshotDigest,
          };
          if (
            eventSnapshotBinding !== null &&
            (eventSnapshotBinding.ref !== binding.ref ||
              eventSnapshotBinding.digest !== binding.digest)
          ) {
            readable = false;
            continue;
          }
          eventSnapshotBinding = binding;
          verdicts.push(validated.value);
        }
      } catch {
        readable = false;
      }
    }
    if (
      eventSnapshotBinding !== null &&
      (snapshotRef !== eventSnapshotBinding.ref ||
        snapshotDigest !== eventSnapshotBinding.digest)
    ) {
      try {
        const snapshotMatch = /\/acceptance\/criteria\/([^/]+)\.json$/u.exec(
          eventSnapshotBinding.ref,
        );
        const artifact = await ports.durableFileSystem.inspect(
          eventSnapshotBinding.ref,
        );
        if (
          snapshotMatch === null ||
          artifact.kind !== "file" ||
          artifact.sha256 !== eventSnapshotBinding.digest
        ) {
          readable = false;
          continue;
        }
        const validated = registry.validate({
          id: "state.acceptance-criteria-snapshot",
          version: "1.0.0",
          value: JSON.parse(
            await ports.durableFileSystem.readText(eventSnapshotBinding.ref),
          ) as unknown,
          structuralReasonCode: "runtime.state_corrupt",
        });
        if (
          validated.kind !== "valid" ||
          validated.value.runId !== configuration.runId ||
          validated.value.eventId !== snapshotMatch[1]
        ) {
          readable = false;
          continue;
        }
        snapshot = validated.value;
        snapshotRef = eventSnapshotBinding.ref;
        snapshotDigest = eventSnapshotBinding.digest;
      } catch {
        readable = false;
      }
    }
  }
  let appendSnapshot: AcceptanceCriteriaSnapshotV1 | null = null;
  let appendSnapshotRef: string | null = null;
  let appendSnapshotDigest: string | null = null;
  if (snapshot !== null && snapshotRef !== null && documentDigest !== null) {
    const latestOutcomes = new Map(
      verdicts.map(({ criterionId, outcome }) => [criterionId, outcome]),
    );
    const change = compareCriteriaSnapshot({
      phase: "acceptance",
      frozen: snapshot.declarations,
      current: currentDeclarations,
      latestOutcomes,
    });
    if (change.kind === "append") {
      const declarations = frozenDeclarationTuple(currentDeclarations);
      if (declarations !== null) {
        appendSnapshotRef = `${runRoot(configuration)}/acceptance/criteria/${eventId}.json`;
        appendSnapshot = buildCriteriaSnapshot({
          runId: configuration.runId,
          eventId,
          sourceRef: documentRef,
          sourceDigest: documentDigest,
          recordedAt: occurredAt,
          previousSnapshotRef: snapshotRef,
          declarations,
        });
        appendSnapshotDigest = ports.digests.sha256(
          `${JSON.stringify(appendSnapshot, null, 2)}\n`,
        );
      }
    }
  }
  const baselineEvents = [...events]
    .reverse()
    .filter(
      (event) =>
        event.eventType === "transition" &&
        event.reasonCode === "run.transition.accepted" &&
        event.artifactRefs.includes(documentRef),
    );
  const baselineRequired = baselineEvents.length > 0;
  let bootstrapSnapshot: AcceptanceCriteriaSnapshotV1 | null = null;
  let bootstrapSnapshotRef: string | null = null;
  let bootstrapSnapshotDigest: string | null = null;
  if (
    snapshot === null &&
    baselineEvents.length > 0 &&
    documentDigest !== null &&
    currentDeclarations.length > 0 &&
    currentDeclarations.every(({ checked }) => !checked)
  ) {
    const baselineCandidates: {
      event: EventV1;
      lineage: {
        readonly artifactRef?: unknown;
        readonly artifactDigest?: unknown;
        readonly phase?: unknown;
        readonly producerCommand?: unknown;
      };
    }[] = [];
    for (const event of baselineEvents) {
      try {
        const lineageRef = `${runRoot(configuration)}/lineage/${event.eventId}.json`;
        const lineageEntry = await ports.durableFileSystem.inspect(lineageRef);
        if (lineageEntry.kind !== "file") continue;
        const lineage = JSON.parse(
          await ports.durableFileSystem.readText(lineageRef),
        ) as {
          readonly artifactRef?: unknown;
          readonly artifactDigest?: unknown;
          readonly phase?: unknown;
          readonly producerCommand?: unknown;
        };
        baselineCandidates.push({ event, lineage });
      } catch {
        continue;
      }
    }
    if (
      findLegacyPlanBaselineIndex({
        documentRef,
        documentDigest,
        candidates: baselineCandidates,
      }) !== -1
    ) {
      const declarations = frozenDeclarationTuple(currentDeclarations);
      if (declarations !== null) {
        bootstrapSnapshotRef = `${runRoot(configuration)}/acceptance/criteria/${eventId}.json`;
        bootstrapSnapshot = buildCriteriaSnapshot({
          runId: configuration.runId,
          eventId,
          sourceRef: documentRef,
          sourceDigest: documentDigest,
          recordedAt: occurredAt,
          previousSnapshotRef: null,
          declarations,
        });
        bootstrapSnapshotDigest = ports.digests.sha256(
          `${JSON.stringify(bootstrapSnapshot, null, 2)}\n`,
        );
      }
    }
  }

  let initialSnapshot: AcceptanceCriteriaSnapshotV1 | null = null;
  let initialSnapshotRef: string | null = null;
  let initialSnapshotDigest: string | null = null;
  const initialDeclarations = frozenDeclarationTuple(currentDeclarations);
  if (
    initialDeclarations !== null &&
    documentDigest !== null &&
    currentDeclarations.every(({ checked }) => !checked)
  ) {
    initialSnapshotRef = `${runRoot(configuration)}/acceptance/criteria/${eventId}.json`;
    initialSnapshot = buildCriteriaSnapshot({
      runId: configuration.runId,
      eventId,
      sourceRef: documentRef,
      sourceDigest: documentDigest,
      recordedAt: occurredAt,
      previousSnapshotRef: null,
      declarations: initialDeclarations,
    });
    initialSnapshotDigest = ports.digests.sha256(
      `${JSON.stringify(initialSnapshot, null, 2)}\n`,
    );
  }

  const preparedVerdicts: {
    value: AcceptanceVerdictV1;
    ref: string;
    digest: string;
  }[] = [];
  const baselineSnapshot = snapshot ?? bootstrapSnapshot;
  const baselineSnapshotRef = snapshotRef ?? bootstrapSnapshotRef;
  const baselineSnapshotDigest = snapshotDigest ?? bootstrapSnapshotDigest;
  if (
    agentOutput.kind === "valid" &&
    agentOutput.value.agent === "acceptance" &&
    baselineSnapshot !== null &&
    baselineSnapshotRef !== null &&
    baselineSnapshotDigest !== null
  ) {
    const latestOutcomes = new Map(
      verdicts.map(({ criterionId, outcome }) => [criterionId, outcome]),
    );
    const change = compareCriteriaSnapshot({
      phase: "acceptance",
      frozen: baselineSnapshot.declarations,
      current: currentDeclarations,
      latestOutcomes,
    });
    const selectedSnapshot =
      change.kind === "append" ? appendSnapshot : baselineSnapshot;
    const selectedSnapshotRef =
      change.kind === "append" ? appendSnapshotRef : baselineSnapshotRef;
    const selectedSnapshotDigest =
      change.kind === "append" ? appendSnapshotDigest : baselineSnapshotDigest;
    const decision = decideAcceptanceVerdict({
      declarations: currentDeclarations,
      globalVerdict: agentOutput.value.payload.verdict,
      criteria: agentOutput.value.payload.criteria,
      evidence: evidence.values,
      invalidEvidenceIds: evidence.invalidIds,
    });
    if (
      change.kind !== "refused" &&
      decision.kind === "accepted" &&
      selectedSnapshot !== null &&
      selectedSnapshotRef !== null &&
      selectedSnapshotDigest !== null
    ) {
      for (const criterion of decision.criteria) {
        const value = buildAcceptanceVerdict({
          runId: configuration.runId,
          eventId,
          criterionId: criterion.criterionId,
          outcome: criterion.outcome,
          criteriaSnapshotRef: selectedSnapshotRef,
          criteriaSnapshotDigest: selectedSnapshotDigest,
          evidenceId: criterion.evidenceId,
          evidenceRef: criterion.evidenceRef,
          evidenceDigest: criterion.evidenceDigest,
          recordedAt: occurredAt,
        });
        const ref = `${runRoot(configuration)}/acceptance/verdicts/${eventId}/${criterion.criterionId}.json`;
        preparedVerdicts.push({
          value,
          ref,
          digest: ports.digests.sha256(`${JSON.stringify(value, null, 2)}\n`),
        });
      }
    }
  }
  return {
    readable,
    documentRef,
    documentContent,
    documentDigest,
    document,
    currentDeclarations,
    snapshot,
    snapshotRef,
    snapshotDigest,
    verdicts,
    appendSnapshot,
    appendSnapshotRef,
    appendSnapshotDigest,
    bootstrapSnapshot,
    bootstrapSnapshotRef,
    bootstrapSnapshotDigest,
    baselineRequired,
    initialSnapshot,
    initialSnapshotRef,
    initialSnapshotDigest,
    preparedVerdicts,
  };
}

function parseArtifactDigestRef(
  ref: string,
): { artifactRef: string; digest: string } | null {
  const match = /^(.*)#sha256=([a-f0-9]{64})$/u.exec(ref);
  return match === null
    ? null
    : { artifactRef: match[1] ?? "", digest: match[2] ?? "" };
}

function frozenDeclarationTuple(
  declarations: Extract<
    CommandObservation,
    { readonly kind: "workflow" }
  >["acceptanceCriteria"]["currentDeclarations"],
): AcceptanceCriteriaSnapshotV1["declarations"] | null {
  const frozen = declarations.map(
    ({ criterionId, workUnit, task, kind, ordinal, declarationDigest }) => ({
      criterionId,
      workUnit,
      task,
      kind,
      ordinal,
      declarationDigest,
    }),
  );
  const [first, ...rest] = frozen;
  return first === undefined ? null : [first, ...rest];
}

type PhaseAssignmentReason =
  | "model.role_missing"
  | "model.host_missing"
  | "model.resolution_unavailable"
  | "model.effort_unsupported"
  | "model.independence_violation"
  | "model.config_migration_required"
  | "guard.config_missing"
  | "guard.config_corrupt"
  | "contract.state_version_invalid"
  | "contract.state_version_unsupported"
  | "model.assignment_stale";

type PhaseAssignmentSubject = string;

type PhaseAssignmentObservation =
  | { readonly kind: "resolved"; readonly value: PhaseHandoffV1_1 }
  | PhaseAssignmentRefusal;

interface PhaseAssignmentRefusal {
  readonly kind: "refused";
  readonly reasonCode: PhaseAssignmentReason;
  readonly subject: PhaseAssignmentSubject;
}

async function observePhaseAssignment(input: {
  readonly phase: (typeof RUN_PHASES)[number];
  readonly runId: string;
  readonly revision: number;
  readonly feature: string;
  readonly status: PhaseHandoffV1_1["status"];
  readonly objectiveDigest: string;
  readonly gateDecision: GateDecision;
  readonly openGaps: number;
  readonly launcherHost: string | undefined;
  readonly ports: RuntimePorts;
  readonly registry: SchemaRegistry;
}): Promise<PhaseAssignmentObservation> {
  const launcher = configurationHost(input.launcherHost);
  if (launcher.kind === "refused") {
    return refusedAssignment("model.host_missing", launcher.subject);
  }
  const host = launcher.host;

  const configuration = await observeConfigurationSnapshot(
    input.ports,
    input.registry,
  );
  if (configuration.kind === "refused") return configuration;

  const catalog = await input.ports.modelRouting.observe(host);
  if (catalog === null) {
    return refusedAssignment("model.resolution_unavailable", host);
  }
  const resolved = resolvePhaseAssignmentDetailed({
    phase: input.phase,
    host,
    configuration: configuration.value,
    catalog,
  });
  if (resolved.kind === "refused") {
    return refusedAssignment(
      resolved.reasonCode,
      resolved.subject.role ?? resolved.subject.host,
    );
  }

  const selectedBeforeReplay = await activeRunId(input.feature, input.ports);
  if (selectedBeforeReplay !== input.runId) {
    return refusedAssignment("model.assignment_stale", "selection");
  }
  const currentRun = await observeRun(
    { feature: input.feature, runId: selectedBeforeReplay },
    input.ports,
    input.registry,
  );
  const selectedAfterReplay = await activeRunId(input.feature, input.ports);
  if (
    currentRun.workflow.kind !== "present" ||
    selectedAfterReplay !== selectedBeforeReplay ||
    currentRun.workflow.state.feature !== input.feature ||
    currentRun.workflow.state.runId !== input.runId ||
    currentRun.workflow.state.revision !== input.revision ||
    (currentRun.workflow.state.currentStep ?? "acceptance") !== input.phase
  ) {
    return refusedAssignment("model.assignment_stale", "run");
  }
  // This is deliberately the final await: a read-only handoff can only bind
  // the exact configuration bytes observed immediately before construction.
  const currentConfiguration = await observeConfigurationSnapshot(
    input.ports,
    input.registry,
  );
  if (currentConfiguration.kind === "refused") return currentConfiguration;
  if (currentConfiguration.digest !== configuration.digest) {
    return refusedAssignment("model.assignment_stale", "configuration");
  }

  const value: PhaseHandoffV1_1 = {
    contractVersion: CONTRACT_VERSIONS["host.phase-handoff"],
    hostContract: CONTRACT_VERSIONS["host.phase-handoff"],
    runId: input.runId,
    revision: input.revision,
    phase: input.phase,
    host,
    assignment: resolved.assignment,
    assignmentDigest: digestPhaseAssignment(
      {
        configDigest: configuration.digest,
        runId: input.runId,
        revision: input.revision,
        host,
        assignment: resolved.assignment,
      },
      (canonical) => input.ports.digests.sha256(canonical),
    ),
    feature: input.feature,
    objectiveDigest: input.objectiveDigest,
    status: input.status,
    gateOutcome: input.gateDecision.outcome,
    blockers: input.gateDecision.failures.map(({ gateId }) => gateId),
    openGaps: input.openGaps,
    nextAction:
      input.gateDecision.outcome === "block"
        ? "Resolve the reported gate blockers and rerun kratos doctor."
        : input.phase === "acceptance"
          ? "Review the evidence bundle, record final approval, and run kratos done."
          : `Complete the ${input.phase} phase and run kratos continue.`,
  };
  return { kind: "resolved", value };
}

function configurationHost(launcherHost: string | undefined):
  | { readonly kind: "resolved"; readonly host: "claude" | "codex" }
  | {
      readonly kind: "refused";
      readonly subject: "launcher:absent" | "launcher:unsupported";
    } {
  if (launcherHost === "claude-code") {
    return { kind: "resolved", host: "claude" };
  }
  if (launcherHost === "codex") return { kind: "resolved", host: "codex" };
  return {
    kind: "refused",
    subject:
      launcherHost === undefined ? "launcher:absent" : "launcher:unsupported",
  };
}

async function observeConfigurationSnapshot(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "valid";
      readonly value: ProjectConfigV1_1;
      readonly digest: string;
    }
  | PhaseAssignmentRefusal
> {
  const path = ".brain/config.json";
  try {
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind === "missing") {
      return refusedAssignment("guard.config_missing", "configuration");
    }
    if (entry.kind !== "file") {
      return refusedAssignment("guard.config_corrupt", "configuration");
    }
    const text = await ports.durableFileSystem.readText(path);
    const configuration = classifyConfiguration(
      { kind: "file", text },
      configurationValidator(registry),
    );
    if (configuration.kind !== "valid") {
      return refusedAssignment(configuration.reasonCode, "configuration");
    }
    return {
      kind: "valid",
      value: configuration.value,
      digest: ports.digests.sha256(text),
    };
  } catch {
    return refusedAssignment("guard.config_missing", "configuration");
  }
}

function refusedAssignment(
  reasonCode: PhaseAssignmentReason,
  subject: PhaseAssignmentSubject,
): PhaseAssignmentRefusal {
  return { kind: "refused", reasonCode, subject };
}

async function observePolicy(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{ readonly readable: boolean; readonly mode: GateMode }> {
  const path = ".brain/config.json";
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return { readable: false, mode: "enforce" };
  try {
    const classified = classifyConfiguration(
      {
        kind: "file",
        text: await ports.durableFileSystem.readText(path),
      },
      configurationValidator(registry),
    );
    if (classified.kind !== "valid") {
      return { readable: false, mode: "enforce" };
    }
    return {
      readable: true,
      mode: classified.value.policyMode === "strict" ? "enforce" : "warn",
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
