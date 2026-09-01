import type {
  AdapterMessageV1_1,
  CurrentPhaseHandoff,
  ReadableAgentOutput,
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  ApprovalV1,
  ReadableEvent,
  EvidenceV1,
  GapRecordV1,
  ProjectConfigV1_4,
  ReadableRepairLoopStop,
  ReadableRepairResolution,
  RepairRestartV1,
  SnapshotV1,
} from "@kratos/contracts";
import { CONTRACT_VERSIONS } from "@kratos/contracts";

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
import { resultFor, type Result } from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import {
  RUN_PHASES,
  workflowReducerRegistry,
  type PhaseExecutionObservation,
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
  approvalModeFor,
  evaluateGates,
  resolveGateModes,
  type GateDecision,
  type GateMode,
  type GateModes,
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
import {
  profileStack,
  renderStackProfile,
  unresolvedProjectProfileKeys,
} from "../domain/init/index.js";
import type { StackProfileReadinessObservation } from "../domain/diagnostics/index.js";
import {
  buildRepairLoopStop,
  buildRepairResolution,
  buildRepairRestartTicket,
  decideRepairLoop,
  type RepairLoopDecision,
  type RepairLoopStopArtifact,
} from "../domain/repair-loop/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { observeModelCatalog } from "./model-routing.js";
import {
  observePhaseMeasurementLog,
  observeValidatedRunUsage,
} from "./measurements.js";
import { configurationValidator } from "./schema.js";
import { observePhaseMemoryBinding } from "./memory.js";

const EMPTY_DIGEST =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_GATE_DECISION: GateDecision = Object.freeze({
  outcome: "pass",
  primary: null,
  failures: Object.freeze([]),
  gateModes: resolveGateModes("strict", {}),
  criteria: Object.freeze([]),
});

/**
 * Where a run's files live. The helpers that only read those paths take this
 * rather than the reducer configuration, so nothing can reach a lineage that
 * is not theirs to read.
 */
interface RunReference {
  readonly feature: string;
  readonly runId: string;
}

interface ObservedRepairResolution {
  readonly operation: string;
  readonly artifact: ReadableRepairResolution;
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
  const phaseResultRequest = await observePhaseResultRequest(
    invocation,
    anchored,
    registry,
  );
  if (phaseResultRequest.kind === "failure") return phaseResultRequest;
  const feature = await activeFeature(anchored);
  const objectiveActive =
    feature !== null && (await hasActiveObjective(feature, anchored, registry));
  const objectiveDigest =
    feature === null
      ? EMPTY_DIGEST
      : await fileDigest(featurePaths(feature).state, anchored);
  const objectiveTokenBudget =
    feature === null
      ? null
      : await activeTokenBudget(feature, anchored, registry);
  const projectConfiguration = await observeConfigurationSnapshot(
    anchored,
    registry,
  );
  const acceptanceAttemptCeiling =
    projectConfiguration.kind === "valid"
      ? {
          kind: "resolved" as const,
          value: projectConfiguration.value.acceptanceAttemptCeiling,
        }
      : projectConfiguration;
  const activeRun =
    feature === null ? null : await activeRunId(feature, anchored);
  const selectedSourceRun = invocation.flags.get("--run");
  const resolvingRepair =
    invocation.command.path.join(" ") === "repair resolve" &&
    typeof selectedSourceRun === "string";
  const requestedRun = invocation.flags.get("--run-id");
  const runId =
    (resolvingRepair ? selectedSourceRun : activeRun) ??
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
          repairResolutionHistory: [],
          persistedSnapshot: null,
          replayedSnapshot: null,
        }
      : await observeRun(location, anchored, registry);
  const tokenBudget =
    run.workflow.kind === "present"
      ? run.workflow.state.tokenCeiling
      : objectiveTokenBudget;
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
  const phase =
    run.workflow.kind === "present"
      ? (run.workflow.state.currentStep ?? "acceptance")
      : "prd";
  if (phaseResultRequest.kind === "host-reported") {
    const earlyAssignment = await observePhaseAssignment({
      phase,
      runId,
      revision:
        run.workflow.kind === "present" ? run.workflow.state.revision : 0,
      feature: configuration.feature,
      status:
        run.workflow.kind === "present" ? run.workflow.state.status : "idle",
      objectiveDigest,
      gateDecision: EMPTY_GATE_DECISION,
      openGaps: 0,
      acceptance: acceptanceHandoffContext(run.workflow, [], []),
      launcherHost:
        typeof invocation.flags.get("--host") === "string"
          ? (invocation.flags.get("--host") as string)
          : anchored.environment.get("KRATOS_HOST"),
      ports: anchored,
      registry,
    });
    const earlyExecution = phaseExecutionFor(
      phaseResultRequest,
      earlyAssignment,
    );
    if (earlyExecution.kind === "failure") return earlyExecution;
  }
  const approvals = await observeApprovals(configuration, anchored, registry);
  const correlation = invocation.flags.get("--correlation-id");
  const host = invocation.flags.get("--host");
  const model = invocation.flags.get("--model");
  const occurredAt = anchored.clock.now().toISOString();
  const measurements = await observePhaseMeasurementLog(anchored, registry);
  if (measurements === null) {
    return {
      kind: "failure",
      result: resultFor("metrics.log_invalid", {
        why: ["The local phase measurement log could not be validated."],
        evidence: [
          { kind: "artifact", ref: ".brain/03-memory/task_log.jsonl" },
        ],
      }),
    };
  }
  const observedUsage = await observeValidatedRunUsage(
    configuration.feature,
    runId,
    occurredAt,
    anchored,
    registry,
  );
  const usage = observedUsage.usage;
  const eventId = anchored.ids.next();
  const git = await observeGitContext(anchored);
  const policy = await observePolicy(anchored, registry);
  const evidence = await observeEvidence(configuration, anchored, registry);
  const gateFacts = await observeGateFacts(configuration, anchored, registry);
  const gaps = await observeGaps(configuration, anchored, registry);
  const gapProposal = await observeGapProposal(invocation, anchored, registry);
  const agentOutput = await observeAgentReply(
    invocation,
    anchored,
    registry,
    phaseResultRequest.kind === "host-reported"
      ? phaseResultRequest.payload.sha256
      : null,
  );
  const agentOutputs = await observeAgentOutputs(
    configuration,
    anchored,
    registry,
  );
  const acceptanceCriteria = await observeAcceptanceCriteria(
    configuration,
    run.events,
    run.workflow,
    eventId,
    occurredAt,
    agentOutput,
    evidence,
    anchored,
    registry,
  );
  const repairLoopFaults = await observeRepairLoopFaults(
    run.workflow,
    anchored,
    registry,
  );
  const preparedRepairResolution = prepareRepairResolution(
    invocation,
    run.workflow,
    configuration,
    eventId,
    occurredAt,
    anchored,
  );
  const referencedFiles = await observeReferencedFiles(invocation, anchored);
  const artifactLineage = await observeArtifactLineage(
    configuration,
    configuration.lineage,
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
          policyMode: approvalModeFor(
            approval.gate,
            policy.defaultMode,
            policy.gateModes,
          ),
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
    gateModes: policy.gateModes,
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
      repairLoopFaults.readable &&
      run.workflow.kind !== "corrupt",
    stopLoss: {
      ...gateFacts.stopLoss,
      repeatedRejections:
        run.workflow.kind === "present"
          ? run.workflow.state.activeRepairStops.map(
              ({ criterionId, attempt, classification, artifactRef }) => ({
                criterionId,
                attempt,
                classification,
                artifactRef,
              }),
            )
          : [],
    },
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
  const phaseAssignment = resolvingRepair
    ? refusedAssignment("model.assignment_stale", "repair-resolution")
    : await observePhaseAssignment({
        phase,
        runId,
        revision:
          run.workflow.kind === "present" ? run.workflow.state.revision : 0,
        feature: configuration.feature,
        status:
          run.workflow.kind === "present" ? run.workflow.state.status : "idle",
        objectiveDigest,
        gateDecision,
        openGaps,
        acceptance: acceptanceHandoffContext(
          run.workflow,
          acceptanceCriteria.currentDeclarations,
          repairLoopFaults.values,
        ),
        launcherHost:
          typeof invocation.flags.get("--host") === "string"
            ? (invocation.flags.get("--host") as string)
            : anchored.environment.get("KRATOS_HOST"),
        ports: anchored,
        registry,
      });
  const currentPhaseMemory = await observePhaseMemoryBinding(
    phase,
    anchored,
    registry,
  );
  const classifiedAgentOutput = classifyMissingMemoryAcknowledgement(
    agentOutput,
    phase,
    phaseAssignment,
    registry,
  );
  const preparedPhaseExecution = phaseExecutionFor(
    phaseResultRequest,
    phaseAssignment,
  );
  if (preparedPhaseExecution.kind === "failure") {
    return preparedPhaseExecution;
  }
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
            budget: { allocated: tokenBudget, used: observedUsage.tokenUsage },
          },
          anchored.digests,
        )
      : null;
  const stackProfile = await observeStackProfile(anchored, registry);
  return {
    kind: "observed",
    observation: {
      kind: "workflow",
      workflow: run.workflow,
      configuration,
      observedLineage,
      phaseAssignment,
      currentPhaseMemory:
        currentPhaseMemory.kind === "value"
          ? currentPhaseMemory.value
          : { kind: "unreadable" },
      phaseExecution: preparedPhaseExecution.value,
      usage,
      tokenUsage: observedUsage.tokenUsage,
      measurements,
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
      agentOutput: classifiedAgentOutput,
      agentOutputs: agentOutputs.values,
      agentOutputsReadable: agentOutputs.readable,
      acceptanceCriteria,
      repairResolution: preparedRepairResolution,
      repairResolutionHistory: run.repairResolutionHistory,
      repairLoopStopsReadable: repairLoopFaults.readable,
      gateFacts,
      openGaps,
      specApproved,
      referencedFiles,
      gateDecision,
      policyMode: policy.mode,
      defaultGateMode: policy.defaultMode,
      acceptanceAttemptCeiling,
      tokenBudget,
      objectiveTokenBudget,
      approvalChallenge: approvalChallenge(
        {
          runId,
          gate: invocation.positionals[0] ?? "final-acceptance",
          prdDigest: observedLineage.prdDigest,
          specDigest: observedLineage.specDigest,
          policyVersion: "workflow-v1",
          policyMode: approvalModeFor(
            invocation.positionals[0] ?? "final-acceptance",
            policy.defaultMode,
            policy.gateModes,
          ),
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
      stackProfile,
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
  recordedLineage: RunLineage,
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
    // Older writers included both the artifact itself and a missing document
    // as parents. Ignore that exact legacy shape while retaining cycle and
    // missing-parent detection for every other edge.
    const validationValues = values.map((value) => {
      const hasLegacySelfReference = value.parentDigests.includes(
        value.artifactDigest,
      );
      return {
        ...value,
        parentDigests: value.parentDigests.filter(
          (parent) =>
            parent !== value.artifactDigest &&
            !(hasLegacySelfReference && parent === EMPTY_DIGEST),
        ),
      };
    });
    // A run validates history against both the roots it sealed and the live
    // documents. A missing document is not a parent, so its placeholder is
    // never admitted as a root for newly forged or corrupted records.
    const validation = validateLineageDag(
      validationValues,
      new Set(
        [
          recordedLineage.prdDigest,
          recordedLineage.specDigest,
          observedLineage.prdDigest,
          observedLineage.specDigest,
        ].filter((digest) => digest !== EMPTY_DIGEST),
      ),
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

type AdapterRequestV1_1 = Extract<
  AdapterMessageV1_1,
  { readonly messageType: "request" }
>;

type PhaseResultRequestObservation =
  | { readonly kind: "direct" }
  | {
      readonly kind: "host-reported";
      readonly host: AdapterRequestV1_1["host"];
      readonly payload: AdapterRequestV1_1["payload"];
      readonly execution: PhaseExecutionObservation;
    }
  | { readonly kind: "failure"; readonly result: Result };

async function observePhaseResultRequest(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseResultRequestObservation> {
  if (invocation.command.path.join(" ") !== "agent record") {
    return { kind: "direct" };
  }
  const document = await ports.standardInput.read();
  if (document === null) return { kind: "direct" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(document) as unknown;
  } catch {
    return phaseResultInputFailure();
  }
  const validated = registry.validate({
    id: "host.adapter-message",
    version: "1.1.0",
    value: parsed,
    structuralReasonCode: "trail.output_invalido",
  });
  if (validated.kind !== "valid") return phaseResultInputFailure();
  const message = validated.value;
  const ref = invocation.positionals[0];
  const correlationId = invocation.flags.get("--correlation-id");
  if (
    message.messageType !== "request" ||
    message.phaseExecution === undefined ||
    message.payloadContract !== "host.agent-output@1.3.0" ||
    ref === undefined ||
    message.payload.ref !== ref ||
    typeof correlationId !== "string" ||
    message.correlationId !== correlationId ||
    message.operation !== `sdd.agent.record:${correlationId}`
  ) {
    return phaseResultInputFailure();
  }
  const entry = await ports.durableFileSystem.inspect(ref);
  if (entry.kind !== "file" || entry.sha256 !== message.payload.sha256) {
    return phaseResultInputFailure();
  }
  return {
    kind: "host-reported",
    host: message.host,
    payload: { ...message.payload },
    execution: {
      ...message.phaseExecution,
      provenance: "host-reported",
    },
  };
}

function phaseResultInputFailure(): Extract<
  PhaseResultRequestObservation,
  { readonly kind: "failure" }
> {
  return {
    kind: "failure",
    result: resultFor("trail.output_invalido", {
      why: ["The host phase-result envelope did not match this command."],
      evidence: [{ kind: "observation", ref: "host.phase-execution/request" }],
    }),
  };
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
  expectedDigest: string | null,
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
    if (
      expectedDigest !== null &&
      ports.digests.sha256(reply) !== expectedDigest
    ) {
      return { kind: "unreadable", ref };
    }
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
    version: "1.3.0",
    value: extracted.value,
    structuralReasonCode: "trail.output_invalido",
  });
  return validated.kind === "valid"
    ? { kind: "valid", ref, value: validated.value }
    : {
        kind: "invalid",
        ref,
        diagnostics: validated.diagnostics,
        value: extracted.value,
      };
}

/**
 * Preserve structural refusal unless the memory field is the only relevant
 * defect. The assigned binding is substituted into a copy and passed through
 * the same current validator; a wrong version, agent, payload, or extra field
 * therefore stays `trail.output_invalido` rather than masquerading as stale
 * phase context.
 */
function classifyMissingMemoryAcknowledgement(
  observation: AgentOutputObservation,
  phase: string,
  assignment: PhaseAssignmentObservation,
  registry: SchemaRegistry,
): AgentOutputObservation {
  if (
    observation.kind !== "invalid" ||
    (phase !== "code" && phase !== "review") ||
    assignment.kind !== "resolved" ||
    assignment.value.memory === null ||
    typeof observation.value !== "object" ||
    observation.value === null ||
    Array.isArray(observation.value)
  ) {
    return observation;
  }
  const candidate = observation.value as Record<string, unknown>;
  const agent = Object.getOwnPropertyDescriptor(candidate, "agent");
  const memory = Object.getOwnPropertyDescriptor(candidate, "memory");
  if (
    agent === undefined ||
    !("value" in agent) ||
    agent.value !== phase ||
    (memory !== undefined && (!("value" in memory) || memory.value !== null))
  ) {
    return observation;
  }
  const validated = registry.validate({
    id: "host.agent-output",
    version: "1.3.0",
    value: { ...candidate, memory: assignment.value.memory },
    structuralReasonCode: "trail.output_invalido",
  });
  return validated.kind === "valid"
    ? { ...observation, missingMemoryAcknowledgement: true }
    : observation;
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
  readonly values: readonly ReadableAgentOutput[];
}> {
  const root = `${runRoot(configuration)}/agent-output`;
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind === "missing") return { readable: true, values: [] };
  if (entry.kind !== "directory") return { readable: false, values: [] };
  try {
    const values: ReadableAgentOutput[] = [];
    for (const name of await ports.durableFileSystem.list(root)) {
      if (!name.endsWith(".json")) return { readable: false, values: [] };
      const path = `${root}/${name}`;
      const file = await ports.durableFileSystem.inspect(path);
      if (file.kind !== "file") return { readable: false, values: [] };
      const parsed = JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown;
      const validated = registry.validate({
        id: "host.agent-output",
        version: hostContractVersion(parsed),
        value: parsed,
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

function hostContractVersion(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "hostContract");
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

async function observeAcceptanceCriteria(
  configuration: RunReference,
  events: readonly ReadableEvent[],
  workflow: WorkflowObservation,
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
      event: ReadableEvent;
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
  let repairLoopDecision: RepairLoopDecision | null = null;
  const preparedRepairStops: {
    value: RepairLoopStopArtifact;
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
      const reportedCriteria = decision.criteria.flatMap((criterion) =>
        criterion.outcome === "not-run"
          ? []
          : [
              {
                criterionId: criterion.criterionId,
                outcome: criterion.outcome,
              },
            ],
      );
      const payload = agentOutput.value.payload;
      const faults =
        "faults" in payload && Array.isArray(payload.faults)
          ? payload.faults
          : [];
      const firstReportedCriterion = decision.criteria[0]?.criterionId;
      const loopDecision: RepairLoopDecision =
        payload.verdict === "rejected" && reportedCriteria.length === 0
          ? {
              kind: "refused",
              reason: "invalid-criterion",
              ...(firstReportedCriterion === undefined
                ? {}
                : { criterionId: firstReportedCriterion }),
            }
          : decideRepairLoop({
              attemptCeiling:
                workflow.kind === "present" &&
                workflow.state.acceptanceAttemptCeiling !== null
                  ? workflow.state.acceptanceAttemptCeiling
                  : 0,
              attempts:
                workflow.kind === "present" ? workflow.state.attempts : [],
              criteria: reportedCriteria,
              faults,
            });
      repairLoopDecision = loopDecision;
      if (loopDecision.kind === "stopped") {
        for (const stop of loopDecision.stops) {
          const stopId = `stop-${ports.digests
            .sha256(
              `${configuration.runId}\n${eventId}\n${stop.criterionId}\n${String(stop.attempt)}`,
            )
            .slice(0, 48)}`;
          const value = buildRepairLoopStop({
            stopId,
            runId: configuration.runId,
            criterionId: stop.criterionId,
            attempt: stop.attempt,
            attemptCeiling:
              workflow.kind === "present" &&
              workflow.state.acceptanceAttemptCeiling !== null
                ? workflow.state.acceptanceAttemptCeiling
                : 0,
            classification: stop.classification,
            diagnosis: stop.diagnosis,
            recordedAt: occurredAt,
          });
          const ref = `${runRoot(configuration)}/acceptance/repair-stops/${eventId}/${stop.criterionId}.json`;
          preparedRepairStops.push({
            value,
            ref,
            digest: ports.digests.sha256(`${JSON.stringify(value, null, 2)}\n`),
          });
        }
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
    repairLoopDecision,
    preparedRepairStops,
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

async function observeRepairLoopFaults(
  workflow: WorkflowObservation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly readable: boolean;
  readonly values: CurrentPhaseHandoff["acceptance"]["faults"];
}> {
  if (workflow.kind !== "present") {
    return { readable: true, values: [] };
  }
  const values: CurrentPhaseHandoff["acceptance"]["faults"] = [];
  try {
    for (const stop of workflow.state.activeRepairStops) {
      const artifact = await readRecoveryArtifact<ReadableRepairLoopStop>(
        "state.repair-loop-stop",
        stop.artifactRef,
        stop.artifactDigest,
        ports,
        registry,
      );
      if (
        artifact?.runId !== workflow.state.runId ||
        artifact.criterionId !== stop.criterionId ||
        artifact.attempt !== stop.attempt ||
        artifact.classification !== stop.classification
      ) {
        return { readable: false, values: [] };
      }
      values.push({
        criterionId: stop.criterionId,
        attempt: stop.attempt,
        classification: stop.classification,
        diagnosis: artifact.diagnosis,
        artifactRef: stop.artifactRef,
        artifactDigest: stop.artifactDigest,
      });
    }
    return { readable: true, values };
  } catch {
    return { readable: false, values: [] };
  }
}

function acceptanceHandoffContext(
  workflow: WorkflowObservation,
  declarations: readonly { readonly criterionId: string }[],
  faults: CurrentPhaseHandoff["acceptance"]["faults"],
): CurrentPhaseHandoff["acceptance"] {
  if (workflow.kind !== "present") {
    return {
      attemptCeiling: null,
      attempts: [],
      faultsRequiredFor: [],
      faults: [...faults],
    };
  }
  const state = workflow.state;
  const byCriterion = new Map(
    state.attempts.map(({ criterionId, attempt }) => [criterionId, attempt]),
  );
  const attempts = declarations.flatMap(({ criterionId }) => {
    const attempt = byCriterion.get(criterionId);
    return attempt === undefined ? [] : [{ criterionId, attempt }];
  });
  const ceiling = state.acceptanceAttemptCeiling;
  const faultsRequiredFor =
    ceiling === null || state.activeRepairStops.length !== 0
      ? []
      : declarations
          .filter(
            ({ criterionId }) =>
              (byCriterion.get(criterionId) ?? 0) + 1 >= ceiling,
          )
          .map(({ criterionId }) => criterionId);
  return {
    attemptCeiling: ceiling,
    attempts,
    faultsRequiredFor,
    faults: [...faults],
  };
}

function prepareRepairResolution(
  invocation: Invocation,
  workflow: WorkflowObservation,
  configuration: RunReference,
  eventId: string,
  occurredAt: string,
  ports: RuntimePorts,
): Extract<
  CommandObservation,
  { readonly kind: "workflow" }
>["repairResolution"] {
  if (
    invocation.command.path.join(" ") !== "repair resolve" ||
    workflow.kind !== "present"
  ) {
    return null;
  }
  const criterionId = invocation.positionals[0];
  const resolvedBy = invocation.flags.get("--resolved-by");
  const observation = invocation.flags.get("--observation");
  const nextRun = invocation.flags.get("--next-run");
  if (
    criterionId === undefined ||
    typeof resolvedBy !== "string" ||
    typeof observation !== "string"
  ) {
    return null;
  }
  const stop = workflow.state.activeRepairStops.find(
    (candidate) => candidate.criterionId === criterionId,
  );
  if (stop === undefined) return null;
  try {
    const resolutionId = `resolution-${eventId}`;
    const ref = `${runRoot(configuration)}/acceptance/repair-resolutions/${eventId}/${criterionId}.json`;
    const value = buildRepairResolution({
      resolutionId,
      runId: configuration.runId,
      criterionId,
      classification: stop.classification,
      stopRef: stop.artifactRef,
      stopDigest: stop.artifactDigest,
      resolvedBy,
      observation,
      resolvedAt: occurredAt,
      nextRunId: typeof nextRun === "string" ? nextRun : null,
    });
    const digest = ports.digests.sha256(`${JSON.stringify(value, null, 2)}\n`);
    if (stop.classification === "code") {
      return { value, ref, digest, restart: null };
    }
    if (typeof nextRun !== "string") return null;
    const retiredCriterionIds = workflow.state.repairStopHistory.map(
      ({ criterionId: stoppedCriterionId }) => stoppedCriterionId,
    );
    const [firstRetiredCriterionId, ...remainingRetiredCriterionIds] =
      retiredCriterionIds;
    if (firstRetiredCriterionId === undefined) return null;
    const restartRef = `${runRoot(configuration)}/acceptance/repair-restarts/${eventId}.json`;
    const restartValue = buildRepairRestartTicket({
      ticketId: `restart-${eventId}`,
      sourceRunId: configuration.runId,
      nextRunId: nextRun,
      resolutionRef: ref,
      resolutionDigest: digest,
      retiredCriterionIds: [
        firstRetiredCriterionId,
        ...remainingRetiredCriterionIds,
      ],
      createdAt: occurredAt,
    });
    return {
      value,
      ref,
      digest,
      restart: {
        value: restartValue,
        ref: restartRef,
        digest: ports.digests.sha256(
          `${JSON.stringify(restartValue, null, 2)}\n`,
        ),
      },
    };
  } catch {
    return null;
  }
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

type ConfigurationRefusalReason =
  | "profile.config_migration_required"
  | "guard.config_missing"
  | "guard.config_corrupt"
  | "contract.state_version_invalid"
  | "contract.state_version_unsupported";

type PhaseAssignmentReason =
  | "model.role_missing"
  | "model.host_missing"
  | "model.resolution_unavailable"
  | "model.effort_unsupported"
  | "model.independence_violation"
  | ConfigurationRefusalReason
  | "model.assignment_stale"
  | "memory.migration_required"
  | "memory.projection_drift"
  | "runtime.state_corrupt";

type PhaseAssignmentSubject = string;

type PhaseAssignmentObservation =
  | { readonly kind: "resolved"; readonly value: CurrentPhaseHandoff }
  | PhaseAssignmentRefusal;

interface PhaseAssignmentRefusal {
  readonly kind: "refused";
  readonly reasonCode: PhaseAssignmentReason;
  readonly subject: PhaseAssignmentSubject;
}

type PreparedPhaseExecution =
  | {
      readonly kind: "resolved";
      readonly value: PhaseExecutionObservation | null;
    }
  | { readonly kind: "failure"; readonly result: Result };

function phaseExecutionFor(
  request: Exclude<PhaseResultRequestObservation, { readonly kind: "failure" }>,
  assignment: PhaseAssignmentObservation,
): PreparedPhaseExecution {
  if (request.kind === "direct") {
    return {
      kind: "resolved",
      value:
        assignment.kind === "resolved"
          ? {
              assignmentDigest: assignment.value.assignmentDigest,
              model: null,
              effort: null,
              provenance: "unknown",
            }
          : null,
    };
  }
  if (assignment.kind === "refused") {
    return phaseExecutionFailure(
      assignment.reasonCode,
      "The current phase assignment could not be resolved.",
    );
  }
  if (
    request.execution.assignmentDigest !== assignment.value.assignmentDigest
  ) {
    return phaseExecutionFailure(
      "model.assignment_stale",
      "The host phase result is bound to an obsolete assignment.",
    );
  }
  if (
    request.host !== assignment.value.host ||
    (request.execution.model !== null &&
      request.execution.model !== assignment.value.assignment.model) ||
    (request.execution.effort !== null &&
      request.execution.effort !== assignment.value.assignment.effort)
  ) {
    return phaseExecutionFailure(
      "model.execution_mismatch",
      "The host execution identity does not match the current assignment.",
    );
  }
  return {
    kind: "resolved",
    value: { ...request.execution },
  };
}

function phaseExecutionFailure(
  reasonCode: PhaseAssignmentReason | "model.execution_mismatch",
  why: string,
): Extract<PreparedPhaseExecution, { readonly kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor(reasonCode, {
      why: [why],
      evidence: [{ kind: "observation", ref: "model-routing/phase-execution" }],
    }),
  };
}

async function observePhaseAssignment(input: {
  readonly phase: (typeof RUN_PHASES)[number];
  readonly runId: string;
  readonly revision: number;
  readonly feature: string;
  readonly status: CurrentPhaseHandoff["status"];
  readonly objectiveDigest: string;
  readonly gateDecision: GateDecision;
  readonly openGaps: number;
  readonly acceptance: CurrentPhaseHandoff["acceptance"];
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

  const catalog = await observeModelCatalog(input.ports.modelRouting, host);
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
  const currentConfiguration = await observeConfigurationSnapshot(
    input.ports,
    input.registry,
  );
  if (currentConfiguration.kind === "refused") return currentConfiguration;
  if (currentConfiguration.digest !== configuration.digest) {
    return refusedAssignment("model.assignment_stale", "configuration");
  }
  const currentCatalog = await observeModelCatalog(
    input.ports.modelRouting,
    host,
  );
  if (currentCatalog === null) {
    return refusedAssignment("model.assignment_stale", "catalog");
  }
  const currentResolution = resolvePhaseAssignmentDetailed({
    phase: input.phase,
    host,
    configuration: currentConfiguration.value,
    catalog: currentCatalog,
  });
  if (
    currentResolution.kind !== "resolved" ||
    currentResolution.assignment.phase !== resolved.assignment.phase ||
    currentResolution.assignment.role !== resolved.assignment.role ||
    currentResolution.assignment.model !== resolved.assignment.model ||
    currentResolution.assignment.effort !== resolved.assignment.effort
  ) {
    return refusedAssignment("model.assignment_stale", "catalog");
  }
  // This is deliberately the final await: resolution uses the catalog snapshot
  // immediately above and binds the exact configuration bytes rechecked here.
  const finalConfiguration = await observeConfigurationSnapshot(
    input.ports,
    input.registry,
  );
  if (finalConfiguration.kind === "refused") return finalConfiguration;
  if (finalConfiguration.digest !== currentConfiguration.digest) {
    return refusedAssignment("model.assignment_stale", "configuration");
  }

  const memory = await observePhaseMemoryBinding(
    input.phase,
    input.ports,
    input.registry,
  );
  if (memory.kind === "refused") {
    return refusedAssignment(memory.reasonCode, ".brain/03-memory/gotchas.md");
  }

  const value = {
    contractVersion: CONTRACT_VERSIONS["host.phase-handoff"],
    hostContract: CONTRACT_VERSIONS["host.phase-handoff"],
    runId: input.runId,
    revision: input.revision,
    phase: input.phase,
    host,
    assignment: currentResolution.assignment,
    assignmentDigest: digestPhaseAssignment(
      {
        configDigest: finalConfiguration.digest,
        runId: input.runId,
        revision: input.revision,
        host,
        assignment: currentResolution.assignment,
        memory: memory.value,
      },
      (canonical) => input.ports.digests.sha256(canonical),
    ),
    feature: input.feature,
    objectiveDigest: input.objectiveDigest,
    status: input.status,
    gateOutcome: input.gateDecision.outcome,
    gateFailures: input.gateDecision.failures.map((failure) => ({
      ...failure,
      evidenceRefs: [...failure.evidenceRefs],
    })),
    blockers: input.gateDecision.failures.map(({ gateId }) => gateId),
    openGaps: input.openGaps,
    nextAction:
      input.gateDecision.outcome === "block"
        ? "Resolve the reported gate blockers and rerun kratos doctor."
        : input.phase === "acceptance"
          ? "Review the evidence bundle, record final approval, and run kratos done."
          : `Complete the ${input.phase} phase and run kratos continue.`,
    acceptance: input.acceptance,
    memory: memory.value,
  } as CurrentPhaseHandoff;
  return { kind: "resolved", value };
}

function configurationHost(launcherHost: string | undefined):
  | {
      readonly kind: "resolved";
      readonly host: "claude" | "codex" | "antigravity";
    }
  | {
      readonly kind: "refused";
      readonly subject: "launcher:absent" | "launcher:unsupported";
    } {
  if (launcherHost === "claude-code") {
    return { kind: "resolved", host: "claude" };
  }
  if (launcherHost === "codex") return { kind: "resolved", host: "codex" };
  if (launcherHost === "antigravity") {
    return { kind: "resolved", host: "antigravity" };
  }
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
      readonly value: ProjectConfigV1_4 & {
        readonly acceptanceAttemptCeiling: number;
      };
      readonly digest: string;
    }
  | {
      readonly kind: "refused";
      readonly reasonCode: ConfigurationRefusalReason;
      readonly subject: "configuration";
    }
> {
  const path = ".brain/config.json";
  try {
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind === "missing") {
      return refusedConfiguration("guard.config_missing");
    }
    if (entry.kind !== "file") {
      return refusedConfiguration("guard.config_corrupt");
    }
    const text = await ports.durableFileSystem.readText(path);
    const configuration = classifyConfiguration(
      { kind: "file", text },
      configurationValidator(registry),
    );
    if (configuration.kind !== "valid") {
      return refusedConfiguration(configuration.reasonCode);
    }
    return {
      kind: "valid",
      value: configuration.value,
      digest: ports.digests.sha256(text),
    };
  } catch {
    return refusedConfiguration("guard.config_missing");
  }
}

async function observeStackProfile(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<StackProfileReadinessObservation> {
  const path = ".brain/01-architecture/stack-profile.md";
  let destination: Pick<
    StackProfileReadinessObservation,
    "exists" | "regularFile" | "readable" | "actualBytes"
  >;
  try {
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind === "missing") {
      destination = {
        exists: false,
        regularFile: false,
        readable: false,
        actualBytes: null,
      };
    } else if (entry.kind !== "file") {
      destination = {
        exists: true,
        regularFile: false,
        readable: false,
        actualBytes: null,
      };
    } else {
      destination = {
        exists: true,
        regularFile: true,
        readable: true,
        actualBytes: { size: entry.size, sha256: entry.sha256 },
      };
    }
  } catch {
    destination = {
      exists: true,
      regularFile: true,
      readable: false,
      actualBytes: null,
    };
  }

  const configuration = await observeConfigurationSnapshot(ports, registry);
  if (configuration.kind !== "valid") {
    return {
      authoritativeState:
        configuration.reasonCode === "profile.config_migration_required"
          ? {
              kind: "migration-required",
              reasonCode: configuration.reasonCode,
            }
          : { kind: "invalid", reasonCode: configuration.reasonCode },
      expectedBytes: null,
      unresolvedKeys: [],
      ...destination,
    };
  }
  let rootEntries: readonly string[];
  try {
    rootEntries = await ports.fileSystem.list(".");
  } catch {
    return {
      authoritativeState: {
        kind: "invalid",
        reasonCode: "runtime.state_corrupt",
      },
      expectedBytes: null,
      unresolvedKeys: [],
      ...destination,
    };
  }
  const rendered = renderStackProfile(
    profileStack({ rootEntries }),
    configuration.value.projectProfile,
    configuration.value.language,
  );
  const renderedBytes = new TextEncoder().encode(rendered);
  return {
    authoritativeState: { kind: "valid" },
    expectedBytes: {
      size: renderedBytes.byteLength,
      sha256: ports.digests.sha256Bytes(renderedBytes),
    },
    unresolvedKeys: unresolvedProjectProfileKeys(
      configuration.value.projectProfile,
    ),
    ...destination,
  };
}

function refusedAssignment(
  reasonCode: PhaseAssignmentReason,
  subject: PhaseAssignmentSubject,
): PhaseAssignmentRefusal {
  return { kind: "refused", reasonCode, subject };
}

function refusedConfiguration(reasonCode: ConfigurationRefusalReason) {
  return {
    kind: "refused" as const,
    reasonCode,
    subject: "configuration" as const,
  };
}

interface ObservedGatePolicy {
  readonly readable: boolean;
  readonly mode: GateMode;
  readonly defaultMode: GateMode;
  readonly gateModes: GateModes;
}

async function observePolicy(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedGatePolicy> {
  const path = ".brain/config.json";
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") {
    return {
      readable: false,
      mode: "enforce",
      defaultMode: "enforce",
      gateModes: resolveGateModes("strict", {}),
    };
  }
  try {
    const classified = classifyConfiguration(
      {
        kind: "file",
        text: await ports.durableFileSystem.readText(path),
      },
      configurationValidator(registry),
    );
    if (classified.kind !== "valid") {
      return {
        readable: false,
        mode: "enforce",
        defaultMode: "enforce",
        gateModes: resolveGateModes("strict", {}),
      };
    }
    return {
      readable: true,
      mode: classified.value.policyMode === "strict" ? "enforce" : "warn",
      defaultMode:
        classified.value.policyMode === "strict" ? "enforce" : "warn",
      gateModes: resolveGateModes(
        classified.value.policyMode,
        classified.value.gateModes,
      ),
    };
  } catch {
    return {
      readable: false,
      mode: "enforce",
      defaultMode: "enforce",
      gateModes: resolveGateModes("strict", {}),
    };
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

async function readRecoveryArtifact<Artifact>(
  id:
    | "state.repair-loop-stop"
    | "state.repair-resolution"
    | "state.repair-restart",
  ref: string,
  digest: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Artifact | null> {
  const entry = await ports.durableFileSystem.inspect(ref);
  if (entry.kind !== "file" || entry.sha256 !== digest) return null;
  const content = await ports.durableFileSystem.readText(ref);
  if (ports.digests.sha256(content) !== digest) return null;
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = (parsed as { readonly stateContract?: unknown })
    .stateContract;
  if (version !== "1.0.0" && version !== "1.1.0") return null;
  const validated = registry.validate({
    id,
    version,
    value: parsed,
    structuralReasonCode: "runtime.state_corrupt",
  });
  return validated.kind === "valid" ? (validated.value as Artifact) : null;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function validSuccessorRun(
  source: RunReference,
  projectId: string,
  event: Extract<ReadableEvent, { readonly stateContract: "1.3.0" | "1.4.0" }>,
  ticket: RepairRestartV1,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<boolean> {
  const target = { feature: source.feature, runId: ticket.nextRunId };
  const root = runRoot(target);
  const eventsPath = `${root}/events.jsonl`;
  const snapshotPath = `${root}/state.json`;
  const eventsEntry = await ports.durableFileSystem.inspect(eventsPath);
  const snapshotEntry = await ports.durableFileSystem.inspect(snapshotPath);
  if (eventsEntry.kind !== "file" || snapshotEntry.kind !== "file") {
    return false;
  }
  const parsedSnapshot = JSON.parse(
    await ports.durableFileSystem.readText(snapshotPath),
  ) as unknown;
  const validatedSnapshot = registry.validate({
    id: "state.snapshot",
    version: "1.0.0",
    value: parsedSnapshot,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (
    validatedSnapshot.kind !== "valid" ||
    validatedSnapshot.value.projectId !== projectId ||
    validatedSnapshot.value.runId !== ticket.nextRunId
  ) {
    return false;
  }
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
    workflowReducerRegistry({
      projectId: validatedSnapshot.value.projectId,
      feature: source.feature,
      runId: ticket.nextRunId,
      lineage: validatedSnapshot.value.lineage,
    }),
    services,
  );
  const first = verified.events[0];
  const restart =
    first?.stateContract === "1.3.0" || first?.stateContract === "1.4.0"
      ? first.startedFromSpec
      : undefined;
  const correlation = event.operation.slice("sdd.repair.resolve:".length);
  return (
    first?.reasonCode === "run.started_from_spec" &&
    first.operation === `sdd.repair.restart:${correlation}` &&
    restart?.sourceRunId === source.runId &&
    restart.restartTicketRef === event.repairResolution?.restartTicketRef &&
    restart.restartTicketDigest ===
      event.repairResolution.restartTicketDigest &&
    sameStrings(restart.retiredCriterionIds, ticket.retiredCriterionIds) &&
    auditSnapshot(validatedSnapshot.value, replay.snapshot, ports.digests)
      .kind === "consistent" &&
    replay.state.startedFromSpec?.sourceRunId === source.runId &&
    replay.state.startedFromSpec.restartTicketRef ===
      restart.restartTicketRef &&
    replay.state.startedFromSpec.restartTicketDigest ===
      restart.restartTicketDigest &&
    sameStrings(replay.state.retiredCriterionIds, ticket.retiredCriterionIds)
  );
}

async function validRecoveryEvidence(
  source: RunReference,
  state: Extract<WorkflowObservation, { readonly kind: "present" }>["state"],
  events: readonly ReadableEvent[],
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<readonly ObservedRepairResolution[] | null> {
  const resolutions = events.filter(
    (
      event,
    ): event is Extract<
      ReadableEvent,
      { readonly stateContract: "1.3.0" | "1.4.0" }
    > =>
      (event.stateContract === "1.3.0" || event.stateContract === "1.4.0") &&
      event.repairResolution !== undefined,
  );
  if (resolutions.length !== state.repairResolutions.length) return null;
  const observed: ObservedRepairResolution[] = [];
  for (const event of resolutions) {
    const binding = event.repairResolution;
    if (binding === undefined) return null;
    const stop = state.repairStopHistory.find(
      ({ criterionId }) => criterionId === binding.criterionId,
    );
    if (
      stop?.classification !== binding.classification ||
      !event.artifactRefs.includes(binding.resolutionRef)
    ) {
      return null;
    }
    const stopArtifact = await readRecoveryArtifact<ReadableRepairLoopStop>(
      "state.repair-loop-stop",
      stop.artifactRef,
      stop.artifactDigest,
      ports,
      registry,
    );
    const resolution = await readRecoveryArtifact<ReadableRepairResolution>(
      "state.repair-resolution",
      binding.resolutionRef,
      binding.resolutionDigest,
      ports,
      registry,
    );
    if (
      stopArtifact?.runId !== source.runId ||
      stopArtifact.criterionId !== stop.criterionId ||
      stopArtifact.attempt !== stop.attempt ||
      stopArtifact.classification !== stop.classification ||
      resolution?.runId !== source.runId ||
      resolution.criterionId !== binding.criterionId ||
      resolution.classification !== binding.classification ||
      resolution.stopRef !== stop.artifactRef ||
      resolution.stopDigest !== stop.artifactDigest ||
      resolution.nextRunId !== binding.nextRunId
    ) {
      return null;
    }
    if (binding.classification === "code") {
      if (
        binding.nextRunId !== null ||
        binding.restartTicketRef !== null ||
        binding.restartTicketDigest !== null
      ) {
        return null;
      }
      observed.push({ operation: event.operation, artifact: resolution });
      continue;
    }
    if (
      binding.nextRunId === null ||
      binding.restartTicketRef === null ||
      binding.restartTicketDigest === null ||
      !event.artifactRefs.includes(binding.restartTicketRef)
    ) {
      return null;
    }
    const ticket = await readRecoveryArtifact<RepairRestartV1>(
      "state.repair-restart",
      binding.restartTicketRef,
      binding.restartTicketDigest,
      ports,
      registry,
    );
    const retired = state.repairStopHistory.map(
      ({ criterionId }) => criterionId,
    );
    if (
      ticket?.sourceRunId !== source.runId ||
      ticket.nextRunId !== binding.nextRunId ||
      ticket.resolutionRef !== binding.resolutionRef ||
      ticket.resolutionDigest !== binding.resolutionDigest ||
      !sameStrings(ticket.retiredCriterionIds, retired) ||
      !(await validSuccessorRun(
        source,
        state.projectId,
        event,
        ticket,
        ports,
        registry,
      ))
    ) {
      return null;
    }
    observed.push({ operation: event.operation, artifact: resolution });
  }
  return observed;
}

async function observeRun(
  configuration: RunReference,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly workflow: WorkflowObservation;
  readonly events: readonly ReadableEvent[];
  readonly repairResolutionHistory: readonly ObservedRepairResolution[];
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
      repairResolutionHistory: [],
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
    const repairResolutionHistory = await validRecoveryEvidence(
      configuration,
      replay.state,
      verified.events,
      ports,
      registry,
    );
    if (repairResolutionHistory === null) {
      return corruptRun();
    }
    return {
      workflow: { kind: "present", state: replay.state },
      events: verified.events,
      repairResolutionHistory,
      persistedSnapshot: state,
      replayedSnapshot: replay.snapshot,
    };
  } catch {
    return corruptRun();
  }
}

export async function observeRunTokenCeiling(
  feature: string,
  runId: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | { readonly kind: "resolved"; readonly value: number | null }
  | { readonly kind: "unreadable" }
> {
  const run = await observeRun({ feature, runId }, ports, registry);
  return run.workflow.kind === "present"
    ? { kind: "resolved", value: run.workflow.state.tokenCeiling }
    : { kind: "unreadable" };
}

function corruptRun(): {
  readonly workflow: WorkflowObservation;
  readonly events: readonly ReadableEvent[];
  readonly repairResolutionHistory: readonly ObservedRepairResolution[];
  readonly persistedSnapshot: null;
  readonly replayedSnapshot: null;
} {
  return {
    workflow: { kind: "corrupt" },
    events: [],
    repairResolutionHistory: [],
    persistedSnapshot: null,
    replayedSnapshot: null,
  };
}

function managed(path: GitPath, worktreePrefix: string): boolean {
  const managedRoot = `${worktreePrefix}.brain`;
  return (
    path.kind === "text" &&
    (path.value === managedRoot || path.value.startsWith(`${managedRoot}/`))
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
        managed(path, observation.repository.worktreePrefix) &&
        (renamedFrom === null ||
          managed(renamedFrom, observation.repository.worktreePrefix)),
    ),
    commit: head.kind === "unborn" ? null : head.commit,
  };
}
