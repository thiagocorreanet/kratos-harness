import type {
  GateFactsV1,
  HostOperationMessageV1,
  HookObservationV1,
  PhaseLifecycleV1,
  RunUsageV1,
} from "@kratos/contracts";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { WriteFilePrecondition } from "../domain/effects.js";
import { classifyHostContract } from "../domain/host/index.js";
import {
  failureCandidate,
  initialRunUsage,
  sanitizeDiagnostic,
} from "../domain/hooks/index.js";
import { MAX_PHASE_MEASUREMENT_CONTRIBUTORS } from "../domain/measurements/index.js";
import {
  resultFor,
  usageFailure,
  type Result,
} from "../domain/result/index.js";
import {
  prepareContract,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import type { Observed } from "./init.js";
import {
  corruptPhaseMeasurementEventStreamResult,
  observePhaseMeasurementLog,
  observePhaseMeasurementRecovery,
  type PhaseMeasurementLogObservation,
} from "./measurements.js";
import { anchorPorts, resolveCommandRoot } from "./root.js";
import { observeWorkflow } from "./workflow.js";

export async function observeHostOperation(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return { kind: "failure", result: root.result };
  const anchored = anchorPorts(root.target, ports);
  const input = await anchored.standardInput.read();
  if (input === null || input.trim().length === 0) {
    return failure(
      "The hook command requires one JSON message on standard input.",
    );
  }

  const document = parse(input);
  const contractFailure = classifyHostContract(document);
  if (contractFailure !== null) {
    return { kind: "failure", result: contractFailure };
  }
  const prepared = prepareContract(registry, {
    id: "host.operation-message",
    version: "1.0.0",
    value: document,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    return failure("The host operation message does not satisfy its schema.");
  }

  const artifact =
    prepared.value.kind === "hook"
      ? await observeMatchingHookArtifact(prepared.value, anchored, registry)
      : { hook: null, lifecycle: null };
  const observation: CommandObservation = {
    kind: "host-operation",
    message: prepared.value,
    hook: artifact.hook,
    lifecycle: artifact.lifecycle,
    context: null,
    phaseStart: null,
  };
  if (observation.hook === null && observation.lifecycle === null) {
    return { kind: "observed", observation, ports: anchored };
  }
  const measurements = await observePhaseMeasurementLog(anchored, registry);
  if (measurements === null) return invalidMeasurementLog();
  if (observation.lifecycle !== null) {
    const trustedFlags = new Map(invocation.flags);
    if (prepared.value.kind === "hook") {
      trustedFlags.set("--host", prepared.value.payload.host);
    }
    const workflow = await observeWorkflow(
      { ...invocation, flags: trustedFlags },
      anchored,
      registry,
    );
    if (workflow.kind === "failure") return workflow;
    if (
      workflow.observation.kind !== "workflow" ||
      workflow.observation.workflow.kind !== "present" ||
      workflow.observation.workflow.state.currentStep === null
    ) {
      return failure("The phase lifecycle has no active workflow phase.");
    }
    if (workflow.observation.phaseAssignment.kind === "refused") {
      return {
        kind: "failure",
        result: resultFor(workflow.observation.phaseAssignment.reasonCode, {
          why: ["The phase lifecycle assignment could not be resolved."],
          evidence: [
            { kind: "observation", ref: "model-routing/phase-lifecycle" },
          ],
        }),
      };
    }
    const feature = workflow.observation.configuration.feature;
    const runId = workflow.observation.configuration.runId;
    const phase = workflow.observation.workflow.state.currentStep;
    const recoveries = [];
    for (const record of workflow.observation.measurements.records) {
      if (
        record.status !== "running" ||
        (record.feature === feature &&
          record.runId === runId &&
          record.phase === phase)
      ) {
        continue;
      }
      const recovery = await observePhaseMeasurementRecovery(
        record,
        observation.lifecycle.occurredAt,
        anchored,
        registry,
      );
      if (recovery.kind === "corrupt") {
        return {
          kind: "failure",
          result: corruptPhaseMeasurementEventStreamResult(
            recovery.evidenceRef,
          ),
        };
      }
      recoveries.push({
        feature: record.feature,
        runId: record.runId,
        phase: record.phase,
        totalGrossTokens: recovery.totalGrossTokens,
        accepted: recovery.accepted,
      });
    }
    return {
      kind: "observed",
      observation: {
        ...observation,
        phaseStart: {
          feature,
          runId,
          phase,
          assignment: workflow.observation.phaseAssignment.value,
          usage: workflow.observation.usage,
          recoveries,
          measurements: workflow.observation.measurements,
        },
      },
      ports: anchored,
    };
  }
  if (observation.hook === null) {
    return { kind: "observed", observation, ports: anchored };
  }
  const context = await observeHookContext(
    observation.hook,
    anchored,
    registry,
    measurements,
  );
  if (context.kind === "failure") return context;
  return {
    kind: "observed",
    observation: { ...observation, context: context.value },
    ports: anchored,
  };
}

async function observeMatchingHookArtifact(
  message: Extract<HostOperationMessageV1, { readonly kind: "hook" }>,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<{
  readonly hook: HookObservationV1 | null;
  readonly lifecycle: PhaseLifecycleV1 | null;
}> {
  if (message.payload.hook === "phase.start") {
    const lifecycle = await observePhaseLifecycleArtifact(
      message,
      ports,
      registry,
    );
    return {
      hook: null,
      lifecycle:
        message.payload.phase === "before" &&
        lifecycle?.correlationId === message.correlationId &&
        lifecycle.occurredAt === message.occurredAt
          ? lifecycle
          : null,
    };
  }
  const hook = await observeHookArtifact(message, ports, registry);
  if (hook?.kind !== message.payload.hook) {
    return { hook: null, lifecycle: null };
  }
  const expectedPhase = hook.kind === "tool.before" ? "before" : "after";
  return {
    hook: message.payload.phase === expectedPhase ? hook : null,
    lifecycle: null,
  };
}

async function observePhaseLifecycleArtifact(
  message: Extract<HostOperationMessageV1, { readonly kind: "hook" }>,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseLifecycleV1 | null> {
  const { ref, sha256 } = message.payload.artifact;
  const entry = await ports.durableFileSystem.inspect(ref);
  if (entry.kind !== "file" || entry.sha256 !== sha256) return null;
  try {
    const value = JSON.parse(
      await ports.durableFileSystem.readText(ref),
    ) as unknown;
    const prepared = registry.validate({
      id: "host.phase-lifecycle",
      version: "1.0.0",
      value,
      structuralReasonCode: "trail.output_invalido",
    });
    return prepared.kind === "valid" ? prepared.value : null;
  } catch {
    return null;
  }
}

async function observeHookArtifact(
  message: Extract<HostOperationMessageV1, { readonly kind: "hook" }>,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<HookObservationV1 | null> {
  const { ref, sha256 } = message.payload.artifact;
  const entry = await ports.durableFileSystem.inspect(ref);
  if (entry.kind !== "file" || entry.sha256 !== sha256) return null;
  try {
    const value = JSON.parse(
      await ports.durableFileSystem.readText(ref),
    ) as unknown;
    const prepared = registry.validate({
      id: "host.hook-observation",
      version: "1.0.0",
      value,
      structuralReasonCode: "trail.output_invalido",
    });
    return prepared.kind === "valid" ? prepared.value : null;
  } catch {
    return null;
  }
}

async function observeHookContext(
  hook: HookObservationV1,
  ports: RuntimePorts,
  registry: SchemaRegistry,
  measurements: PhaseMeasurementLogObservation,
): Promise<
  | {
      readonly kind: "context";
      readonly value: Extract<
        CommandObservation,
        { readonly kind: "host-operation" }
      >["context"];
    }
  | Extract<Observed, { readonly kind: "failure" }>
> {
  const activeFeature = await firstLine(".brain/02-features/active", ports);
  const activeRunId =
    activeFeature === null
      ? null
      : await firstLine(
          `.brain/02-features/${activeFeature}/active-run`,
          ports,
        );
  const target = measurementTarget(
    hook,
    measurements,
    activeFeature,
    activeRunId,
  );
  if (target.kind === "corrupt") {
    return corruptHookState(".brain/03-memory/task_log.jsonl", target.why);
  }
  const feature =
    target.kind === "owned" || target.kind === "claim"
      ? target.record.feature
      : activeFeature;
  const runId =
    target.kind === "owned" || target.kind === "claim"
      ? target.record.runId
      : activeRunId;
  if (feature === null || runId === null) {
    return { kind: "context", value: null };
  }
  const selectedMeasurement =
    target.kind === "owned" || target.kind === "claim";
  const inactiveOwner =
    selectedMeasurement &&
    (target.record.feature !== activeFeature ||
      target.record.runId !== activeRunId);
  const budgetPath = `.brain/02-features/${feature}/state.json`;
  const budgetObservation = await tokenBudget(feature, ports, registry);
  if (
    selectedMeasurement &&
    (budgetObservation.kind === "invalid" ||
      (inactiveOwner && budgetObservation.kind === "missing"))
  ) {
    return corruptHookState(
      budgetPath,
      "The measured session owner has no valid feature state.",
    );
  }
  const usagePath = `.brain/02-features/${feature}/runs/${runId}/usage.json`;
  const usageEntry = await ports.durableFileSystem.inspect(usagePath);
  const usageObservation = await stateRecord(
    usagePath,
    "state.run-usage",
    usageEntry,
    ports,
    registry,
  );
  if (
    selectedMeasurement &&
    (usageObservation.kind === "invalid" ||
      (usageObservation.kind === "valid" &&
        usageObservation.value.runId !== runId) ||
      (inactiveOwner && usageObservation.kind === "missing"))
  ) {
    return corruptHookState(
      usagePath,
      "The measured session owner has no valid run usage state.",
    );
  }
  const gatesPath = `.brain/02-features/${feature}/runs/${runId}/gates.json`;
  const gatesEntry = await ports.durableFileSystem.inspect(gatesPath);
  const gatesObservation = await stateRecord(
    gatesPath,
    "state.gates",
    gatesEntry,
    ports,
    registry,
  );
  if (
    selectedMeasurement &&
    (gatesObservation.kind === "invalid" ||
      (gatesObservation.kind === "valid" &&
        gatesObservation.value.runId !== runId))
  ) {
    return corruptHookState(
      gatesPath,
      "The measured session owner has no valid gate state.",
    );
  }
  const cachePath = hookCachePath(hook.sessionId);
  const cache = await readCache(cachePath, ports);
  const transientRoot = `.brain/03-memory/.cache/hooks/${hook.sessionId}`;
  const transientFiles = await filesIn(transientRoot, ports);
  const telemetryPath = `.brain/03-memory/telemetry/${hook.sessionId}.json`;
  const candidate =
    hook.kind === "tool.failed"
      ? failureCandidate(
          {
            toolFamily: hook.toolFamily,
            failureClass: hook.failureClass,
            exitCode: hook.exitCode,
            diagnostic: sanitizeDiagnostic(
              hook.diagnostic,
              ports.environment.workingDirectory(),
            ),
            observedAt: hook.occurredAt,
          },
          (canonical) => ports.digests.sha256(canonical),
        )
      : null;
  return {
    kind: "context",
    value: {
      feature,
      runId,
      budget:
        budgetObservation.kind === "valid" ? budgetObservation.value : null,
      usage:
        usageObservation.kind === "valid"
          ? usageObservation.value
          : initialRunUsage(runId, hook.occurredAt),
      usageExpected: precondition(usageEntry),
      gates:
        gatesObservation.kind === "valid"
          ? gatesObservation.value
          : emptyGates(runId, hook.occurredAt),
      gatesExpected: precondition(gatesEntry),
      candidate,
      candidateExists:
        candidate !== null &&
        (
          await ports.durableFileSystem.inspect(
            `.brain/03-memory/candidates/${candidate.candidateId}.json`,
          )
        ).kind === "file",
      cache,
      telemetryExists:
        (await ports.durableFileSystem.inspect(telemetryPath)).kind === "file",
      transientFiles,
      measurementTarget:
        target.kind === "owned" || target.kind === "claim"
          ? {
              phase: target.record.phase,
              claimSession: target.kind === "claim",
            }
          : null,
      measurements,
    },
  };
}

type MeasuredRecord = PhaseMeasurementLogObservation["records"][number];

type MeasurementTarget =
  | { readonly kind: "none" }
  | { readonly kind: "owned"; readonly record: MeasuredRecord }
  | { readonly kind: "claim"; readonly record: MeasuredRecord }
  | { readonly kind: "corrupt"; readonly why: string };

function measurementTarget(
  hook: HookObservationV1,
  measurements: PhaseMeasurementLogObservation,
  activeFeature: string | null,
  activeRunId: string | null,
): MeasurementTarget {
  if (hook.kind === "tool.before") return { kind: "none" };
  const owners = measurements.records.filter((record) =>
    record.contributingSessionIds.includes(hook.sessionId),
  );
  if (owners.length > 0) return ownedMeasurementAt(hook.occurredAt, owners);
  const cumulativeGrossTokens =
    "usage" in hook ? (hook.usage?.cumulativeGrossTokens ?? null) : null;
  if (cumulativeGrossTokens === null) return { kind: "none" };
  if (activeFeature === null || activeRunId === null) {
    return {
      kind: "corrupt",
      why: "The accepted hook sample has no active phase measurement owner.",
    };
  }
  const eligible = measurements.records.filter(
    (record) =>
      record.feature === activeFeature &&
      record.runId === activeRunId &&
      record.status === "running",
  );
  const eligibleOwner = eligible[0];
  if (eligibleOwner === undefined) {
    return {
      kind: "corrupt",
      why: "The accepted hook sample has no running phase measurement owner.",
    };
  }
  if (eligible.length > 1) {
    return {
      kind: "corrupt",
      why: "The accepted hook sample has multiple running phase measurement owners.",
    };
  }
  if (
    eligibleOwner.contributingSessionIds.length >=
    MAX_PHASE_MEASUREMENT_CONTRIBUTORS
  ) {
    return {
      kind: "corrupt",
      why: "The running phase measurement cannot accept another contributor.",
    };
  }
  return { kind: "claim", record: eligibleOwner };
}

function ownedMeasurementAt(
  occurredAt: string,
  candidates: readonly MeasuredRecord[],
): MeasurementTarget {
  const occurred = timestampOrderKey(occurredAt);
  const intervals = candidates.map((record) => ({
    record,
    started: timestampOrderKey(record.startedAt),
    ended:
      record.status === "running"
        ? undefined
        : timestampOrderKey(record.endedAt),
  }));
  if (
    occurred === null ||
    intervals.some(({ started, ended }) => started === null || ended === null)
  ) {
    return ambiguousMeasuredSession();
  }
  const containing = intervals.filter(
    ({ started, ended }) =>
      started !== null &&
      started <= occurred &&
      (ended === undefined || (ended !== null && occurred <= ended)),
  );
  if (containing.length === 1) {
    const selected = containing[0];
    return selected === undefined
      ? ambiguousMeasuredSession()
      : { kind: "owned", record: selected.record };
  }
  if (containing.length > 1) return ambiguousMeasuredSession();

  const applicable = intervals.filter(
    ({ started }) => started !== null && started <= occurred,
  );
  const latestStarted = applicable.reduce<string | null>(
    (latest, { started }) =>
      started !== null && (latest === null || started > latest)
        ? started
        : latest,
    null,
  );
  const latest = applicable.filter(({ started }) => started === latestStarted);
  const selected = latest[0];
  return latest.length === 1 && selected !== undefined
    ? { kind: "owned", record: selected.record }
    : ambiguousMeasuredSession();
}

function timestampOrderKey(timestamp: string): string | null {
  const match =
    /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?Z$/.exec(
      timestamp,
    );
  if (match === null || !Number.isFinite(Date.parse(timestamp))) return null;
  const seconds = match[1];
  if (seconds === undefined) return null;
  return `${seconds}.${(match[2] ?? "").padEnd(9, "0")}`;
}

function ambiguousMeasuredSession(): MeasurementTarget {
  return {
    kind: "corrupt",
    why: "The hook session contributes to multiple phase measurements without a unique execution interval.",
  };
}

async function filesIn(
  root: string,
  ports: RuntimePorts,
): Promise<readonly string[]> {
  const entry = await ports.durableFileSystem.inspect(root);
  if (entry.kind !== "directory") return [];
  const files: string[] = [];
  for (const name of await ports.durableFileSystem.list(root)) {
    const path = `${root}/${name}`;
    if ((await ports.durableFileSystem.inspect(path)).kind === "file") {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en-US"));
}

function precondition(
  entry: Awaited<ReturnType<RuntimePorts["durableFileSystem"]["inspect"]>>,
): WriteFilePrecondition {
  return entry.kind === "file"
    ? { kind: "file", size: entry.size, sha256: entry.sha256 }
    : { kind: "missing" };
}

async function firstLine(
  path: string,
  ports: RuntimePorts,
): Promise<string | null> {
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return null;
  const value = (await ports.durableFileSystem.readText(path))
    .split("\n")[0]
    ?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

async function tokenBudget(
  feature: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<StateObservation<number | null>> {
  const path = `.brain/02-features/${feature}/state.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return { kind: "missing" };
  try {
    const prepared = registry.validate({
      id: "state.feature",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return prepared.kind === "valid"
      ? {
          kind: "valid",
          value: prepared.value.objective.budget?.tokens ?? null,
        }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

type StateRecord<I extends "state.run-usage" | "state.gates"> =
  I extends "state.run-usage" ? RunUsageV1 : GateFactsV1;

type StateObservation<T> =
  | { readonly kind: "valid"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" };

async function stateRecord<I extends "state.run-usage" | "state.gates">(
  path: string,
  id: I,
  entry: Awaited<ReturnType<RuntimePorts["durableFileSystem"]["inspect"]>>,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<StateObservation<StateRecord<I>>> {
  if (entry.kind !== "file") return { kind: "missing" };
  try {
    const prepared = registry.validate({
      id,
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return prepared.kind === "valid"
      ? { kind: "valid", value: prepared.value as StateRecord<I> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function emptyGates(runId: string, now: string): GateFactsV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    runId,
    openGaps: 0,
    openGapIds: [],
    stopLoss: { tripped: false, exhausted: false },
    partitionRequired: false,
    partitionApproved: true,
    derivedAt: now,
  };
}

export function hookCachePath(sessionId: string): string {
  return `.brain/03-memory/.cache/hooks/${sessionId}/telemetry.json`;
}

async function readCache(
  path: string,
  ports: RuntimePorts,
): Promise<{
  readonly startedAt: string;
  readonly grossTokens: number;
  readonly toolFailures: number;
} | null> {
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return null;
  try {
    const value = JSON.parse(await ports.durableFileSystem.readText(path)) as {
      startedAt?: unknown;
      grossTokens?: unknown;
      toolFailures?: unknown;
    };
    return typeof value.startedAt === "string" &&
      Number.isSafeInteger(value.grossTokens) &&
      Number.isSafeInteger(value.toolFailures)
      ? {
          startedAt: value.startedAt,
          grossTokens: value.grossTokens as number,
          toolFailures: value.toolFailures as number,
        }
      : null;
  } catch {
    return null;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function failure(why: string): {
  readonly kind: "failure";
  readonly result: Result;
} {
  return { kind: "failure", result: usageFailure(why) };
}

function invalidMeasurementLog(): Extract<Observed, { kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor("metrics.log_invalid", {
      why: ["The local phase measurement log could not be validated."],
      evidence: [{ kind: "artifact", ref: ".brain/03-memory/task_log.jsonl" }],
    }),
  };
}

function corruptHookState(
  ref: string,
  why: string,
): Extract<Observed, { kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor("runtime.state_corrupt", {
      why: [why],
      evidence: [{ kind: "artifact", ref }],
    }),
  };
}
