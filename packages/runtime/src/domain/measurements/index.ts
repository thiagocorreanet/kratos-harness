import type { PhaseMeasurementV1 } from "@kratos/contracts";

import type { SchemaRegistry } from "../schema/index.js";
import { RUN_PHASES, type RunPhase } from "../workflow/index.js";

export type ContributorCheckpoint = NonNullable<
  PhaseMeasurementV1["contributorCheckpoints"]
>[number];

type WithNormalizedMeasurementState<T> = T extends PhaseMeasurementV1
  ? T & {
      contributingSessionIds: [string, ...string[]];
      contributorCheckpoints: ContributorCheckpoint[];
    }
  : never;

/** Normalized runtime record. The wire contract also accepts legacy omission. */
export type PhaseMeasurement =
  WithNormalizedMeasurementState<PhaseMeasurementV1>;

export const MAX_PHASE_MEASUREMENT_CONTRIBUTORS = 256;

export interface StartPhaseMeasurementInput {
  readonly feature: string;
  readonly runId: string;
  readonly phase: RunPhase;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly now: string;
  readonly totalGrossTokens: number;
  readonly assignmentDigest: string;
  readonly resolvedAssignment: PhaseMeasurement["resolvedAssignment"];
}

export interface SamplePhaseMeasurementInput {
  readonly record: PhaseMeasurement;
  readonly totalGrossTokens: number;
  readonly contributingSessionId?: string;
  readonly now: string;
}

export interface ReconcileContributorCheckpointInput {
  readonly records: readonly PhaseMeasurement[];
  readonly feature: string;
  readonly runId: string;
  readonly phase: RunPhase;
  readonly sessionId: string;
  readonly cumulativeGrossTokens: number;
  readonly occurredAt: string;
  readonly claimContributor: boolean;
  readonly expectedRunGrossTokens: number;
}

export interface RecoverPhaseMeasurementsInput {
  readonly records: readonly PhaseMeasurement[];
  readonly recoveries: readonly {
    readonly feature: string;
    readonly runId: string;
    readonly phase: RunPhase;
    readonly totalGrossTokens: number | null;
    readonly now: string;
    readonly accepted: RecoverPhaseMeasurementInput["accepted"];
  }[];
}

export type PhaseMeasurementOwnerResolution =
  | {
      readonly kind: "owned";
      readonly record: PhaseMeasurement;
      readonly claimContributor: boolean;
    }
  | { readonly kind: "absent" }
  | { readonly kind: "ambiguous" };

export interface CompletePhaseMeasurementInput extends SamplePhaseMeasurementInput {
  readonly observedIdentity: PhaseMeasurement["observedIdentity"];
}

export interface InterruptPhaseMeasurementInput extends SamplePhaseMeasurementInput {
  readonly closeReason: "session_interrupted" | "recovered_interrupted";
}

export interface RecoverPhaseMeasurementInput extends SamplePhaseMeasurementInput {
  readonly accepted: {
    readonly occurredAt: string;
    readonly observedIdentity: PhaseMeasurement["observedIdentity"];
  } | null;
}

export interface ObservePhaseMeasurementIdentityInput {
  readonly record: PhaseMeasurement;
  readonly observedIdentity: PhaseMeasurement["observedIdentity"];
  readonly now: string;
}

function grossTokens(baseline: number, total: number): number {
  return Math.max(0, total - baseline);
}

function durationMs(startedAt: string, endedAt: string): number {
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  if (duration < 0) throw new Error("Phase measurement chronology is invalid");
  return duration;
}

export function startPhaseMeasurement(
  input: StartPhaseMeasurementInput,
): PhaseMeasurement {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    feature: input.feature,
    runId: input.runId,
    phase: input.phase,
    sessionId: input.sessionId,
    contributingSessionIds: [input.sessionId],
    contributorCheckpoints: [],
    correlationId: input.correlationId,
    status: "running",
    startedAt: input.now,
    endedAt: null,
    durationMs: null,
    baselineGrossTokens: input.totalGrossTokens,
    finalGrossTokens: null,
    grossTokens: 0,
    assignmentDigest: input.assignmentDigest,
    resolvedAssignment: input.resolvedAssignment,
    observedIdentity: { model: null, effort: null },
    closeReason: null,
    updatedAt: input.now,
  };
}

export function samplePhaseMeasurement(
  input: SamplePhaseMeasurementInput,
): PhaseMeasurement {
  const record =
    input.contributingSessionId === undefined
      ? input.record
      : addPhaseMeasurementContributor(
          input.record,
          input.contributingSessionId,
        );
  if (record.status !== "running") {
    const latestGrossTokens = Math.max(
      record.finalGrossTokens,
      input.totalGrossTokens,
    );
    return {
      ...record,
      finalGrossTokens: latestGrossTokens,
      grossTokens: grossTokens(record.baselineGrossTokens, latestGrossTokens),
      updatedAt: input.now,
    };
  }
  return {
    ...record,
    grossTokens: grossTokens(
      record.baselineGrossTokens,
      input.totalGrossTokens,
    ),
    updatedAt: input.now,
  };
}

export function addPhaseMeasurementContributor(
  record: PhaseMeasurement,
  sessionId: string,
): PhaseMeasurement {
  return {
    ...record,
    contributingSessionIds: contributorIds(record, sessionId),
  };
}

/** Resolve one session by event time across durable owners and one candidate. */
export function resolvePhaseMeasurementOwner(
  records: readonly PhaseMeasurement[],
  sessionId: string,
  occurredAt: string,
  additionalCandidate?: PhaseMeasurement,
): PhaseMeasurementOwnerResolution {
  const owners = records.filter((record) =>
    record.contributingSessionIds.includes(sessionId),
  );
  const candidates =
    additionalCandidate === undefined || owners.includes(additionalCandidate)
      ? owners
      : [...owners, additionalCandidate];
  if (candidates.length === 0) return { kind: "absent" };
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
    return { kind: "ambiguous" };
  }
  const containing = intervals.filter(
    ({ started, ended }) =>
      started !== null &&
      started <= occurred &&
      (ended === undefined || (ended !== null && occurred <= ended)),
  );
  if (containing.length > 1) return { kind: "ambiguous" };
  let selected = containing[0];
  if (selected === undefined) {
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
    const latest = applicable.filter(
      ({ started }) => started === latestStarted,
    );
    if (latest.length !== 1) return { kind: "ambiguous" };
    selected = latest[0];
  }
  if (selected === undefined) return { kind: "ambiguous" };
  return {
    kind: "owned",
    record: selected.record,
    claimContributor:
      !selected.record.contributingSessionIds.includes(sessionId),
  };
}

/**
 * Reallocate one session's cumulative checkpoints without guessing at opaque
 * legacy gross-token residuals.
 */
export function reconcileContributorCheckpoint(
  input: ReconcileContributorCheckpointInput,
): readonly PhaseMeasurement[] {
  assertValidMeasurementSet(input.records);
  const runRecords = input.records.filter(
    (record) =>
      record.feature === input.feature && record.runId === input.runId,
  );
  const target = runRecords.find((record) => record.phase === input.phase);
  const occurredAt = timestampOrderKey(input.occurredAt);
  const targetStartedAt =
    target === undefined ? null : timestampOrderKey(target.startedAt);
  if (
    target === undefined ||
    occurredAt === null ||
    targetStartedAt === null ||
    occurredAt < targetStartedAt ||
    !isCount(input.cumulativeGrossTokens) ||
    !isCount(input.expectedRunGrossTokens)
  ) {
    throw new Error("Phase measurement checkpoint state is invalid");
  }

  const oldAllocations = checkpointAllocations(runRecords);
  const residualByPhase = new Map<RunPhase, number>();
  for (const record of runRecords) {
    const residual = record.grossTokens - (oldAllocations.get(record) ?? 0);
    if (!isCount(residual)) {
      throw new Error("Phase measurement checkpoint residual is invalid");
    }
    residualByPhase.set(record.phase, residual);
  }

  const claimed = input.claimContributor
    ? addPhaseMeasurementContributor(target, input.sessionId)
    : target;
  const previous = claimed.contributorCheckpoints.find(
    ({ sessionId }) => sessionId === input.sessionId,
  );
  const nextTarget =
    previous !== undefined &&
    previous.cumulativeGrossTokens >= input.cumulativeGrossTokens
      ? claimed
      : {
          ...claimed,
          contributorCheckpoints: [
            ...claimed.contributorCheckpoints.filter(
              ({ sessionId }) => sessionId !== input.sessionId,
            ),
            {
              sessionId: input.sessionId,
              cumulativeGrossTokens: input.cumulativeGrossTokens,
              occurredAt: input.occurredAt,
            },
          ].sort((left, right) =>
            left.sessionId.localeCompare(right.sessionId, "en-US"),
          ),
          updatedAt: latestTimestamp(claimed.updatedAt, input.occurredAt),
        };
  if (!hasValidCheckpointState(nextTarget)) {
    throw new Error("Phase measurement checkpoint state is invalid");
  }

  const staged = input.records.map((record) =>
    record === target ? nextTarget : record,
  );
  const stagedRun = staged.filter(
    (record) =>
      record.feature === input.feature && record.runId === input.runId,
  );
  const newAllocations = checkpointAllocations(stagedRun);
  const reconciledByPhase = new Map<RunPhase, PhaseMeasurement>();
  for (const record of stagedRun) {
    const grossTokens =
      (residualByPhase.get(record.phase) ?? 0) +
      (newAllocations.get(record) ?? 0);
    if (!isCount(grossTokens)) {
      throw new Error("Phase measurement checkpoint residual is invalid");
    }
    const reconciled =
      record.status === "running"
        ? { ...record, grossTokens }
        : {
            ...record,
            grossTokens,
            finalGrossTokens: record.baselineGrossTokens + grossTokens,
          };
    if (!hasValidMeasurementSemantics(reconciled)) {
      throw new Error("Phase measurement checkpoint state is invalid");
    }
    reconciledByPhase.set(record.phase, reconciled);
  }

  const earliestBaseline = earliestRunBaseline(stagedRun);
  const measurableGrossTokens = input.expectedRunGrossTokens - earliestBaseline;
  const reconciledGrossTokens = [...reconciledByPhase.values()].reduce(
    (sum, record) => sum + record.grossTokens,
    0,
  );
  if (
    !isCount(measurableGrossTokens) ||
    reconciledGrossTokens !== measurableGrossTokens
  ) {
    throw new Error("Phase measurement checkpoint conservation is unprovable");
  }

  const reconciled = staged.map((record) =>
    record.feature === input.feature && record.runId === input.runId
      ? (reconciledByPhase.get(record.phase) ?? record)
      : record,
  );
  assertValidMeasurementSet(reconciled);
  return reconciled;
}

export function completePhaseMeasurement(
  input: CompletePhaseMeasurementInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  const latestGrossTokens = input.totalGrossTokens;
  return {
    ...input.record,
    status: "completed",
    endedAt: input.now,
    durationMs: durationMs(input.record.startedAt, input.now),
    finalGrossTokens: latestGrossTokens,
    grossTokens: grossTokens(
      input.record.baselineGrossTokens,
      latestGrossTokens,
    ),
    observedIdentity: input.observedIdentity,
    closeReason: "phase_completed",
    updatedAt: input.now,
  };
}

export function interruptPhaseMeasurement(
  input: InterruptPhaseMeasurementInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  const latestGrossTokens = input.totalGrossTokens;
  return {
    ...input.record,
    status: "interrupted",
    endedAt: input.now,
    durationMs: durationMs(input.record.startedAt, input.now),
    finalGrossTokens: latestGrossTokens,
    grossTokens: grossTokens(
      input.record.baselineGrossTokens,
      latestGrossTokens,
    ),
    closeReason: input.closeReason,
    updatedAt: input.now,
  };
}

/** Close one record left open across a process boundary. */
export function recoverPhaseMeasurement(
  input: RecoverPhaseMeasurementInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  if (input.accepted === null) {
    return interruptPhaseMeasurement({
      record: input.record,
      totalGrossTokens: input.totalGrossTokens,
      now: input.now,
      closeReason: "recovered_interrupted",
    });
  }
  const completed = completePhaseMeasurement({
    record: input.record,
    totalGrossTokens: input.totalGrossTokens,
    now: input.accepted.occurredAt,
    observedIdentity: input.accepted.observedIdentity,
  });
  if (completed.status !== "completed") {
    throw new Error("Phase measurement recovery did not close the record");
  }
  return {
    ...completed,
    closeReason: "recovered_completed",
    updatedAt: input.now,
  };
}

/** Reconcile run-level conservation before closing any stale measurements. */
export function recoverPhaseMeasurements(
  input: RecoverPhaseMeasurementsInput,
): readonly PhaseMeasurement[] {
  assertValidMeasurementSet(input.records);
  const recoveryKeys = new Set<string>();
  const recoveriesByRun = new Map<
    string,
    RecoverPhaseMeasurementsInput["recoveries"][number][]
  >();
  for (const recovery of input.recoveries) {
    const key = measurementKey(recovery);
    const record = input.records.find(
      (candidate) => measurementKey(candidate) === key,
    );
    if (
      recoveryKeys.has(key) ||
      record?.status !== "running" ||
      (recovery.totalGrossTokens !== null &&
        !isCount(recovery.totalGrossTokens))
    ) {
      throw new Error("Phase measurement recovery state is invalid");
    }
    recoveryKeys.add(key);
    const run = runKey(recovery);
    const values = recoveriesByRun.get(run) ?? [];
    values.push(recovery);
    recoveriesByRun.set(run, values);
  }

  const reconciled = new Map(
    input.records.map((record) => [measurementKey(record), record] as const),
  );
  for (const [key, recoveries] of recoveriesByRun) {
    const runRecords = [...reconciled.values()].filter(
      (record) => runKey(record) === key,
    );
    const earliestBaseline = earliestRunBaseline(runRecords);
    const attributedGrossTokens = runRecords.reduce(
      (sum, record) => sum + record.grossTokens,
      0,
    );
    const attributedRunTotal = earliestBaseline + attributedGrossTokens;
    if (!isCount(attributedRunTotal)) {
      throw new Error("Phase measurement recovery conservation is invalid");
    }
    const observedTotals = [
      ...new Set(
        recoveries.flatMap(({ totalGrossTokens }) =>
          totalGrossTokens === null ? [] : [totalGrossTokens],
        ),
      ),
    ];
    if (observedTotals.length > 1) {
      throw new Error("Phase measurement recovery conservation is invalid");
    }
    const observedRunTotal = observedTotals[0] ?? attributedRunTotal;
    if (observedRunTotal < attributedRunTotal) {
      throw new Error("Phase measurement recovery conservation is invalid");
    }
    const eligible = runRecords.filter(({ status }) => status === "running");
    const owner = eligible[0];
    if (eligible.length !== 1 || owner === undefined) {
      throw new Error("Phase measurement recovery conservation is invalid");
    }
    const residual = observedRunTotal - attributedRunTotal;
    if (residual > 0) {
      const grossTokens = owner.grossTokens + residual;
      if (!isCount(grossTokens)) {
        throw new Error("Phase measurement recovery conservation is invalid");
      }
      reconciled.set(measurementKey(owner), { ...owner, grossTokens });
    }
    for (const recovery of recoveries) {
      const recoveryKey = measurementKey(recovery);
      const record = reconciled.get(recoveryKey);
      if (record === undefined) {
        throw new Error("Phase measurement recovery state is invalid");
      }
      reconciled.set(
        recoveryKey,
        recoverPhaseMeasurement({
          record,
          totalGrossTokens: record.baselineGrossTokens + record.grossTokens,
          now: recovery.now,
          accepted: recovery.accepted,
        }),
      );
    }
  }
  const records = input.records.map(
    (record) => reconciled.get(measurementKey(record)) ?? record,
  );
  assertValidMeasurementSet(records);
  return records;
}

/** Attach only host-observed execution identity while a phase is open. */
export function observePhaseMeasurementIdentity(
  input: ObservePhaseMeasurementIdentityInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  return {
    ...input.record,
    observedIdentity: input.observedIdentity,
    updatedAt: input.now,
  };
}

function phaseOrder(phase: RunPhase): number {
  return RUN_PHASES.indexOf(phase);
}

export function samePhaseMeasurementAssignment(
  left: PhaseMeasurement["resolvedAssignment"],
  right: PhaseMeasurement["resolvedAssignment"],
): boolean {
  return (
    left.host === right.host &&
    left.role === right.role &&
    left.model === right.model &&
    left.effort === right.effort
  );
}

export function upsertPhaseMeasurement(
  records: readonly PhaseMeasurement[],
  next: PhaseMeasurement,
): readonly PhaseMeasurement[] {
  if (!hasValidContributorOwnership(next)) {
    throw new Error("Phase measurement contributor ownership is invalid");
  }
  if (!hasValidCheckpointState(next)) {
    throw new Error("Phase measurement checkpoint state is invalid");
  }
  const existing = records.find(
    (record) => record.runId === next.runId && record.phase === next.phase,
  );
  if (
    existing?.status === "running" &&
    !samePhaseMeasurementAssignment(
      existing.resolvedAssignment,
      next.resolvedAssignment,
    )
  ) {
    throw new Error(
      "Phase measurement assignment conflicts with the open record",
    );
  }
  const updated = [
    ...records.filter(
      (record) => record.runId !== next.runId || record.phase !== next.phase,
    ),
    next,
  ].sort(
    (left, right) =>
      left.runId.localeCompare(right.runId) ||
      phaseOrder(left.phase) - phaseOrder(right.phase),
  );
  assertValidMeasurementSet(updated);
  return updated;
}

function stateContract(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { readonly stateContract?: unknown }).stateContract;
}

function contributorIds(
  record: PhaseMeasurement,
  additional: string | undefined,
): PhaseMeasurement["contributingSessionIds"] {
  const values =
    additional === undefined
      ? record.contributingSessionIds
      : [...new Set([...record.contributingSessionIds, additional])].sort(
          (left, right) => left.localeCompare(right, "en-US"),
        );
  const first = values[0];
  if (first === undefined) {
    throw new Error("Phase measurement contributor ownership is invalid");
  }
  if (values.length > MAX_PHASE_MEASUREMENT_CONTRIBUTORS) {
    throw new Error("Phase measurement contributor ownership is invalid");
  }
  return [first, ...values.slice(1)];
}

function hasValidContributorOwnership(record: PhaseMeasurement): boolean {
  const canonical = [...new Set(record.contributingSessionIds)].sort(
    (left, right) => left.localeCompare(right, "en-US"),
  );
  return (
    canonical.length > 0 &&
    canonical.length <= MAX_PHASE_MEASUREMENT_CONTRIBUTORS &&
    canonical.includes(record.sessionId) &&
    canonical.length === record.contributingSessionIds.length &&
    canonical.every(
      (sessionId, index) => sessionId === record.contributingSessionIds[index],
    )
  );
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasValidCheckpointState(record: PhaseMeasurement): boolean {
  const checkpoints = record.contributorCheckpoints;
  const canonical = [...checkpoints].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId, "en-US"),
  );
  const startedAt = timestampOrderKey(record.startedAt);
  return (
    checkpoints.length <= MAX_PHASE_MEASUREMENT_CONTRIBUTORS &&
    startedAt !== null &&
    new Set(checkpoints.map(({ sessionId }) => sessionId)).size ===
      checkpoints.length &&
    canonical.every((checkpoint, index) => checkpoint === checkpoints[index]) &&
    checkpoints.every((checkpoint) => {
      const occurredAt = timestampOrderKey(checkpoint.occurredAt);
      return (
        Object.keys(checkpoint).sort().join("\u0000") ===
          "cumulativeGrossTokens\u0000occurredAt\u0000sessionId" &&
        ID_PATTERN.test(checkpoint.sessionId) &&
        isCount(checkpoint.cumulativeGrossTokens) &&
        occurredAt !== null &&
        occurredAt >= startedAt &&
        record.contributingSessionIds.includes(checkpoint.sessionId)
      );
    })
  );
}

function checkpointAllocations(
  records: readonly PhaseMeasurement[],
): ReadonlyMap<PhaseMeasurement, number> {
  const allocations = new Map<PhaseMeasurement, number>(
    records.map((record) => [record, 0]),
  );
  const bySession = new Map<
    string,
    {
      readonly record: PhaseMeasurement;
      readonly checkpoint: ContributorCheckpoint;
      readonly startedAt: string;
    }[]
  >();
  for (const record of records) {
    const startedAt = timestampOrderKey(record.startedAt);
    if (startedAt === null || !hasValidCheckpointState(record)) {
      throw new Error("Phase measurement checkpoint state is invalid");
    }
    for (const checkpoint of record.contributorCheckpoints) {
      const values = bySession.get(checkpoint.sessionId) ?? [];
      values.push({ record, checkpoint, startedAt });
      bySession.set(checkpoint.sessionId, values);
    }
  }
  for (const values of bySession.values()) {
    values.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    let previousStartedAt: string | null = null;
    let previousCumulative = 0;
    for (const { record, checkpoint, startedAt } of values) {
      if (
        startedAt === previousStartedAt ||
        checkpoint.cumulativeGrossTokens < previousCumulative
      ) {
        throw new Error("Phase measurement checkpoint chronology is invalid");
      }
      const contribution =
        checkpoint.cumulativeGrossTokens - previousCumulative;
      allocations.set(record, (allocations.get(record) ?? 0) + contribution);
      previousStartedAt = startedAt;
      previousCumulative = checkpoint.cumulativeGrossTokens;
    }
  }
  return allocations;
}

function measurementKey(
  record: Pick<PhaseMeasurement, "feature" | "runId" | "phase">,
): string {
  return `${record.feature}\u0000${record.runId}\u0000${record.phase}`;
}

function runKey(record: Pick<PhaseMeasurement, "feature" | "runId">): string {
  return `${record.feature}\u0000${record.runId}`;
}

function chronologicalRunRecords(
  records: readonly PhaseMeasurement[],
): readonly PhaseMeasurement[] {
  return [...records].sort((left, right) => {
    const leftStarted = timestampOrderKey(left.startedAt);
    const rightStarted = timestampOrderKey(right.startedAt);
    if (leftStarted === null || rightStarted === null) {
      throw new Error("Phase measurement baseline chronology is invalid");
    }
    return (
      leftStarted.localeCompare(rightStarted) ||
      phaseOrder(left.phase) - phaseOrder(right.phase)
    );
  });
}

function earliestRunBaseline(records: readonly PhaseMeasurement[]): number {
  const first = chronologicalRunRecords(records)[0];
  if (first === undefined) {
    throw new Error("Phase measurement baseline chronology is invalid");
  }
  return first.baselineGrossTokens;
}

function hasValidBaselineChronology(
  records: readonly PhaseMeasurement[],
): boolean {
  const groups = new Map<string, PhaseMeasurement[]>();
  for (const record of records) {
    const group = groups.get(runKey(record)) ?? [];
    group.push(record);
    groups.set(runKey(record), group);
  }
  try {
    for (const group of groups.values()) {
      let previous: number | null = null;
      for (const record of chronologicalRunRecords(group)) {
        if (previous !== null && record.baselineGrossTokens < previous) {
          return false;
        }
        previous = record.baselineGrossTokens;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasValidCheckpointChronology(
  records: readonly PhaseMeasurement[],
): boolean {
  const groups = new Map<string, PhaseMeasurement[]>();
  for (const record of records) {
    const key = `${record.feature}\u0000${record.runId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  try {
    for (const group of groups.values()) checkpointAllocations(group);
    return true;
  } catch {
    return false;
  }
}

function hasValidCheckpointResiduals(
  records: readonly PhaseMeasurement[],
): boolean {
  const groups = new Map<string, PhaseMeasurement[]>();
  for (const record of records) {
    const key = `${record.feature}\u0000${record.runId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  try {
    for (const group of groups.values()) {
      const allocations = checkpointAllocations(group);
      for (const record of group) {
        if (record.grossTokens < (allocations.get(record) ?? 0)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasValidCheckpointOwnership(
  records: readonly PhaseMeasurement[],
): boolean {
  for (const record of records) {
    for (const checkpoint of record.contributorCheckpoints) {
      const resolved = resolvePhaseMeasurementOwner(
        records,
        checkpoint.sessionId,
        checkpoint.occurredAt,
      );
      if (resolved.kind !== "owned" || resolved.record !== record) return false;
    }
  }
  return true;
}

function assertValidMeasurementSet(records: readonly PhaseMeasurement[]): void {
  if (!hasValidBaselineChronology(records)) {
    throw new Error("Phase measurement baseline chronology is invalid");
  }
  if (!hasValidCheckpointChronology(records)) {
    throw new Error("Phase measurement checkpoint chronology is invalid");
  }
  if (!hasValidCheckpointResiduals(records)) {
    throw new Error("Phase measurement checkpoint residual is invalid");
  }
  if (!hasValidCheckpointOwnership(records)) {
    throw new Error("Phase measurement checkpoint ownership is invalid");
  }
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

function latestTimestamp(left: string, right: string): string {
  const leftKey = timestampOrderKey(left);
  const rightKey = timestampOrderKey(right);
  if (leftKey === null || rightKey === null) {
    throw new Error("Phase measurement checkpoint state is invalid");
  }
  return rightKey > leftKey ? right : left;
}

function hasValidMeasurementSemantics(record: PhaseMeasurement): boolean {
  if (
    !hasValidContributorOwnership(record) ||
    !hasValidCheckpointState(record)
  ) {
    return false;
  }
  if (record.status === "running") return true;
  try {
    return (
      record.grossTokens ===
        grossTokens(record.baselineGrossTokens, record.finalGrossTokens) &&
      record.durationMs === durationMs(record.startedAt, record.endedAt)
    );
  } catch {
    return false;
  }
}

export function parsePhaseMeasurementLog(
  text: string,
  registry: SchemaRegistry,
): readonly PhaseMeasurement[] {
  if (text === "") return [];
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw new Error("Phase measurement log is invalid");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line === "")) {
    throw new Error("Phase measurement log is invalid");
  }
  const records = lines.map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Phase measurement log is invalid");
    }
    const validated = registry.validate({
      id: "state.phase-measurement",
      version: stateContract(value),
      value,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (validated.kind === "invalid") {
      throw new Error("Phase measurement log is invalid");
    }
    const normalized = normalizePhaseMeasurement(validated.value);
    if (!hasValidMeasurementSemantics(normalized)) {
      throw new Error("Phase measurement log is invalid");
    }
    return normalized;
  });
  const keys = new Set<string>();
  for (const record of records) {
    const key = `${record.runId}\u0000${record.phase}`;
    if (keys.has(key)) throw new Error("Phase measurement log is invalid");
    keys.add(key);
  }
  try {
    assertValidMeasurementSet(records);
  } catch {
    throw new Error("Phase measurement log is invalid");
  }
  return records;
}

function normalizePhaseMeasurement(
  record: PhaseMeasurementV1,
): PhaseMeasurement {
  return {
    ...record,
    contributingSessionIds: record.contributingSessionIds ?? [record.sessionId],
    contributorCheckpoints: record.contributorCheckpoints ?? [],
  };
}

export function renderPhaseMeasurementLog(
  records: readonly PhaseMeasurement[],
): string {
  if (records.some((record) => !hasValidContributorOwnership(record))) {
    throw new Error("Phase measurement contributor ownership is invalid");
  }
  if (records.some((record) => !hasValidCheckpointState(record))) {
    throw new Error("Phase measurement checkpoint state is invalid");
  }
  assertValidMeasurementSet(records);
  return records.length === 0
    ? ""
    : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export {
  derivePhaseDistributions,
  nearestRank,
  renderTaskMetrics,
  type IntegerDistribution,
  type PhaseDistribution,
  type PhaseDistributions,
  type TaskMetricsReport,
} from "./rollup.js";
