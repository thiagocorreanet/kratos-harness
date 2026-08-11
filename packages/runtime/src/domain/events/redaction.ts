import {
  EventIntegrityError,
  type EventDraftV1,
  type EventServices,
} from "./model.js";

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
] as const;

const IDENTITY_KEYS = ["host", "model"] as const;
const MAX_REFERENCE_COUNT = 256;

type DataRecord = Record<PropertyKey, unknown>;

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
    lengthDescriptor.value > MAX_REFERENCE_COUNT
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

function copyObservedIdentity(
  value: unknown,
  isProxy: EventServices["isProxy"],
): {
  host: string;
  model: string | null;
} {
  const identity = requirePlainRecord(value, isProxy);
  requireExactKeys(identity, IDENTITY_KEYS);
  const host = requireString(identity, "host");
  const model = requireDataValue(identity, "model");
  if (typeof model !== "string" && model !== null) invalidEvent();
  return { host, model };
}

export function snapshotEventDraft(
  value: unknown,
  isProxy: EventServices["isProxy"],
): EventDraftV1 {
  try {
    const draft = requirePlainRecord(value, isProxy);
    requireExactKeys(draft, DRAFT_KEYS);
    return {
      contractVersion: requireString(draft, "contractVersion"),
      stateContract: requireString(draft, "stateContract"),
      eventId: requireString(draft, "eventId"),
      eventType: requireString(draft, "eventType") as EventDraftV1["eventType"],
      occurredAt: requireString(draft, "occurredAt"),
      operation: requireString(draft, "operation"),
      policyVersion: requireString(draft, "policyVersion"),
      priorRevision: requireRevision(draft, "priorRevision"),
      resultingRevision: requireRevision(draft, "resultingRevision"),
      reasonCode: requireString(draft, "reasonCode"),
      effect: requireString(draft, "effect") as EventDraftV1["effect"],
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
    } as EventDraftV1;
  } catch {
    return invalidEvent();
  }
}
