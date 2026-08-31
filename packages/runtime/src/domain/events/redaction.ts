import {
  EventIntegrityError,
  type CurrentEventDraft,
  type EventServices,
  type ReadableEvent,
} from "./model.js";
import type { EventV1_2 } from "@kratos/contracts";
import { GATE_IDS } from "../gates/index.js";
import { assertEventSemanticPolicy } from "./semantics.js";

const DRAFT_KEYS = [
  "contractVersion",
  "stateContract",
  "eventId",
  "eventType",
  "occurredAt",
  "operation",
  "policyVersion",
  "priorRevision",
  "resultingRevision",
  "reasonCode",
  "effect",
  "artifactRefs",
  "evidenceRefs",
  "observedIdentity",
  "gateFailures",
] as const;

const IDENTITY_KEYS = ["host", "model", "effort"] as const;
const ASSIGNMENT_KEYS = ["phase", "role", "model", "effort"] as const;
const MAX_REFERENCE_COUNT = 256;

type DataRecord = Record<PropertyKey, unknown>;
type GateFailureV1_2 = EventV1_2["gateFailures"][number];

function invalidEvent(): never {
  throw new EventIntegrityError("invalid_event");
}

function requirePlainRecord(
  value: unknown,
  isProxy: EventServices["isProxy"],
): DataRecord {
  if (typeof value !== "object" || value === null) invalidEvent();
  if (isProxy(value)) invalidEvent();
  if (Object.getPrototypeOf(value) !== Object.prototype) invalidEvent();
  return value as DataRecord;
}

function requireExactKeys(
  value: DataRecord,
  expectedKeys: readonly string[],
): void {
  const actualKeys = Object.getOwnPropertyNames(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    invalidEvent();
  }
}

function requireDataValue(value: DataRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) invalidEvent();
  return descriptor.value;
}

function requireString(value: DataRecord, key: string): string {
  const result = requireDataValue(value, key);
  if (typeof result !== "string") invalidEvent();
  return result;
}

function requireRevision(value: DataRecord, key: string): number {
  const result = requireDataValue(value, key);
  if (typeof result !== "number" || !Number.isSafeInteger(result))
    invalidEvent();
  return result;
}

function copyReferences(
  value: unknown,
  isProxy: EventServices["isProxy"],
  maxCount = MAX_REFERENCE_COUNT,
): string[] {
  if (typeof value !== "object" || value === null) invalidEvent();
  if (isProxy(value)) invalidEvent();
  if (!Array.isArray(value)) invalidEvent();
  const keys = Object.getOwnPropertyNames(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value > maxCount
  ) {
    invalidEvent();
  }
  const length = lengthDescriptor.value;
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    keys.length !== length + 1 ||
    keys[keys.length - 1] !== "length"
  ) {
    invalidEvent();
  }

  const copied: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      invalidEvent();
    }
    copied.push(descriptor.value);
  }
  return copied;
}

function copyGateFailure(
  value: unknown,
  isProxy: EventServices["isProxy"],
): GateFailureV1_2 {
  const failure = requirePlainRecord(value, isProxy);
  requireExactKeys(failure, [
    "gateId",
    "reasonCode",
    "mode",
    "priority",
    "evidenceRefs",
    "detail",
  ]);
  const detail = requireDataValue(failure, "detail");
  if (typeof detail !== "string" && detail !== null) invalidEvent();
  return {
    gateId: requireString(failure, "gateId") as GateFailureV1_2["gateId"],
    reasonCode: requireString(
      failure,
      "reasonCode",
    ) as GateFailureV1_2["reasonCode"],
    mode: requireString(failure, "mode") as GateFailureV1_2["mode"],
    priority: requireRevision(failure, "priority"),
    evidenceRefs: copyReferences(
      requireDataValue(failure, "evidenceRefs"),
      isProxy,
      16,
    ) as GateFailureV1_2["evidenceRefs"],
    detail,
  };
}

function copyGateFailures(
  value: unknown,
  isProxy: EventServices["isProxy"],
): GateFailureV1_2[] {
  if (typeof value !== "object" || value === null) invalidEvent();
  if (isProxy(value) || !Array.isArray(value)) invalidEvent();
  const keys = Object.getOwnPropertyNames(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value > GATE_IDS.length ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    keys.length !== lengthDescriptor.value + 1 ||
    keys[keys.length - 1] !== "length"
  ) {
    invalidEvent();
  }
  const copied: GateFailureV1_2[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) invalidEvent();
    copied.push(copyGateFailure(descriptor.value, isProxy));
  }
  return copied;
}

function copyObservedIdentity(
  value: unknown,
  isProxy: EventServices["isProxy"],
): {
  host: string;
  model: string | null;
  effort: string | null;
} {
  const identity = requirePlainRecord(value, isProxy);
  requireExactKeys(identity, IDENTITY_KEYS);
  const host = requireString(identity, "host");
  const model = requireDataValue(identity, "model");
  const effort = requireDataValue(identity, "effort");
  if (typeof model !== "string" && model !== null) invalidEvent();
  if (typeof effort !== "string" && effort !== null) invalidEvent();
  return { host, model, effort };
}

function copyResolvedAssignment(
  value: unknown,
  isProxy: EventServices["isProxy"],
): NonNullable<CurrentEventDraft["resolvedAssignment"]> {
  const assignment = requirePlainRecord(value, isProxy);
  requireExactKeys(assignment, ASSIGNMENT_KEYS);
  return {
    phase: requireString(assignment, "phase") as NonNullable<
      CurrentEventDraft["resolvedAssignment"]
    >["phase"],
    role: requireString(assignment, "role") as NonNullable<
      CurrentEventDraft["resolvedAssignment"]
    >["role"],
    model: requireString(assignment, "model"),
    effort: requireString(assignment, "effort"),
  };
}

export function assertEventPolicy(event: ReadableEvent): void {
  try {
    assertEventSemanticPolicy(event);
  } catch {
    invalidEvent();
  }
}

export function snapshotEventDraft(
  value: unknown,
  isProxy: EventServices["isProxy"],
): CurrentEventDraft {
  try {
    const draft = requirePlainRecord(value, isProxy);
    const resolvedAssignment = Object.hasOwn(draft, "resolvedAssignment")
      ? copyResolvedAssignment(
          requireDataValue(draft, "resolvedAssignment"),
          isProxy,
        )
      : undefined;
    requireExactKeys(
      draft,
      resolvedAssignment === undefined
        ? DRAFT_KEYS
        : [...DRAFT_KEYS, "resolvedAssignment"],
    );
    const snapshot: CurrentEventDraft = {
      contractVersion: requireString(draft, "contractVersion"),
      stateContract: requireString(draft, "stateContract"),
      eventId: requireString(draft, "eventId"),
      eventType: requireString(
        draft,
        "eventType",
      ) as CurrentEventDraft["eventType"],
      occurredAt: requireString(draft, "occurredAt"),
      operation: requireString(draft, "operation"),
      policyVersion: requireString(draft, "policyVersion"),
      priorRevision: requireRevision(draft, "priorRevision"),
      resultingRevision: requireRevision(draft, "resultingRevision"),
      reasonCode: requireString(draft, "reasonCode"),
      effect: requireString(draft, "effect") as CurrentEventDraft["effect"],
      artifactRefs: copyReferences(
        requireDataValue(draft, "artifactRefs"),
        isProxy,
      ),
      evidenceRefs: copyReferences(
        requireDataValue(draft, "evidenceRefs"),
        isProxy,
      ),
      observedIdentity: copyObservedIdentity(
        requireDataValue(draft, "observedIdentity"),
        isProxy,
      ),
      gateFailures: copyGateFailures(
        requireDataValue(draft, "gateFailures"),
        isProxy,
      ),
      ...(resolvedAssignment === undefined ? {} : { resolvedAssignment }),
    } as CurrentEventDraft;
    assertEventPolicy({
      ...snapshot,
      previousHash: null,
      eventHash: "0".repeat(64),
    });
    return snapshot;
  } catch {
    return invalidEvent();
  }
}
