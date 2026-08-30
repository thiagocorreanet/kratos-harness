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
  return {
    kind: "observed",
    observation: { ...observation, context },
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
  NonNullable<CommandObservation & { kind: "host-operation" }>["context"]
> {
  const feature = await firstLine(".brain/02-features/active", ports);
  if (feature === null) return null;
  const runId = await firstLine(
    `.brain/02-features/${feature}/active-run`,
    ports,
  );
  if (runId === null) return null;
  const budget = await tokenBudget(feature, ports, registry);
  const usagePath = `.brain/02-features/${feature}/runs/${runId}/usage.json`;
  const usageEntry = await ports.durableFileSystem.inspect(usagePath);
  const usage = await stateRecord(
    usagePath,
    "state.run-usage",
    usageEntry,
    ports,
    registry,
  );
  const gatesPath = `.brain/02-features/${feature}/runs/${runId}/gates.json`;
  const gatesEntry = await ports.durableFileSystem.inspect(gatesPath);
  const gates = await stateRecord(
    gatesPath,
    "state.gates",
    gatesEntry,
    ports,
    registry,
  );
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
    feature,
    runId,
    budget,
    usage: usage ?? initialRunUsage(runId, hook.occurredAt),
    usageExpected: precondition(usageEntry),
    gates: gates ?? emptyGates(runId, hook.occurredAt),
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
    measurements,
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
): Promise<number | null> {
  const path = `.brain/02-features/${feature}/state.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return null;
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
      ? (prepared.value.objective.budget?.tokens ?? null)
      : null;
  } catch {
    return null;
  }
}

type StateRecord<I extends "state.run-usage" | "state.gates"> =
  I extends "state.run-usage" ? RunUsageV1 : GateFactsV1;

async function stateRecord<I extends "state.run-usage" | "state.gates">(
  path: string,
  id: I,
  entry: Awaited<ReturnType<RuntimePorts["durableFileSystem"]["inspect"]>>,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<StateRecord<I> | null> {
  if (entry.kind !== "file") return null;
  try {
    const prepared = registry.validate({
      id,
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return (
      prepared.kind === "valid" ? prepared.value : null
    ) as StateRecord<I> | null;
  } catch {
    return null;
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
