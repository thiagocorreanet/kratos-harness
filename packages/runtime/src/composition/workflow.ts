import type {
  ApprovalV1,
  EventV1,
  EvidenceV1,
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
import { evaluateGates, type GateMode } from "../domain/gates/index.js";
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
  const lineage =
    feature === null
      ? { prdDigest: EMPTY_DIGEST, specDigest: EMPTY_DIGEST }
      : await observeLineage(feature, anchored);
  const projectId = `project-${anchored.digests
    .sha256(anchored.environment.workingDirectory())
    .slice(0, 32)}`;
  const configuration: WorkflowReducerConfiguration = {
    projectId,
    feature: feature ?? "unselected",
    runId,
    lineage,
  };
  const run =
    feature === null
      ? {
          workflow: { kind: "absent", operations: [] } as const,
          events: [],
          persistedSnapshot: null,
          replayedSnapshot: null,
        }
      : await observeRun(configuration, anchored, registry);
  const approvals = await observeApprovals(configuration, anchored, registry);
  const correlation = invocation.flags.get("--correlation-id");
  const host = invocation.flags.get("--host");
  const model = invocation.flags.get("--model");
  const occurredAt = anchored.clock.now().toISOString();
  const git = await observeGitContext(anchored);
  const policy = await observePolicy(anchored, registry);
  const evidence = await observeEvidence(configuration, anchored, registry);
  const gateFacts = await observeGateFacts(configuration, anchored);
  const referencedFiles = await observeReferencedFiles(invocation, anchored);
  const artifactLineage = await observeArtifactLineage(configuration, anchored);
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
          prdDigest: lineage.prdDigest,
          specDigest: lineage.specDigest,
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
      artifactLineage.readable &&
      run.workflow.kind !== "corrupt",
    stopLoss: gateFacts.stopLoss,
    prdDigest: lineage.prdDigest === EMPTY_DIGEST ? null : lineage.prdDigest,
    specDigest: lineage.specDigest === EMPTY_DIGEST ? null : lineage.specDigest,
    approvals: validApprovals,
    openGaps: gateFacts.openGaps,
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
      referencedFiles,
      gateDecision,
      policyMode: policy.mode,
      tokenBudget,
      approvalChallenge: approvalChallenge(
        {
          runId,
          gate: invocation.positionals[0] ?? "final-acceptance",
          prdDigest: lineage.prdDigest,
          specDigest: lineage.specDigest,
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
  configuration: WorkflowReducerConfiguration,
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
    const validation = validateLineageDag(
      values,
      new Set([
        configuration.lineage.prdDigest,
        configuration.lineage.specDigest,
      ]),
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

async function observeGateFacts(
  configuration: WorkflowReducerConfiguration,
  ports: RuntimePorts,
): Promise<ObservedGateFacts> {
  const empty = {
    readable: true,
    stopLoss: { tripped: false, exhausted: false },
    openGaps: 0,
    partitionRequired: false,
    partitionApproved: true,
  } as const;
  const path = `.brain/02-features/${configuration.feature}/runs/${configuration.runId}/gates.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind === "missing") return empty;
  if (entry.kind !== "file") return { ...empty, readable: false };
  try {
    const value = JSON.parse(await ports.durableFileSystem.readText(path)) as {
      contractVersion?: unknown;
      openGaps?: unknown;
      partitionRequired?: unknown;
      partitionApproved?: unknown;
      stopLoss?: { tripped?: unknown; exhausted?: unknown };
    };
    if (
      value.contractVersion !== "1.0.0" ||
      typeof value.openGaps !== "number" ||
      !Number.isSafeInteger(value.openGaps) ||
      value.openGaps < 0 ||
      typeof value.partitionRequired !== "boolean" ||
      typeof value.partitionApproved !== "boolean" ||
      value.stopLoss === undefined ||
      typeof value.stopLoss.tripped !== "boolean" ||
      typeof value.stopLoss.exhausted !== "boolean"
    ) {
      return { ...empty, readable: false };
    }
    return {
      readable: true,
      stopLoss: {
        tripped: value.stopLoss.tripped,
        exhausted: value.stopLoss.exhausted,
      },
      openGaps: value.openGaps,
      partitionRequired: value.partitionRequired,
      partitionApproved: value.partitionApproved,
    };
  } catch {
    return { ...empty, readable: false };
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
  configuration: WorkflowReducerConfiguration,
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
  configuration: WorkflowReducerConfiguration,
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

async function observeLineage(
  feature: string,
  ports: RuntimePorts,
): Promise<RunLineage> {
  return {
    prdDigest: await fileDigest(
      `.brain/02-features/${feature}/00-prd.md`,
      ports,
    ),
    specDigest: await fileDigest(
      `.brain/02-features/${feature}/01-design.md`,
      ports,
    ),
  };
}

async function fileDigest(path: string, ports: RuntimePorts): Promise<string> {
  const entry = await ports.durableFileSystem.inspect(path);
  return entry.kind === "file" ? entry.sha256 : EMPTY_DIGEST;
}

async function observeRun(
  configuration: WorkflowReducerConfiguration,
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
