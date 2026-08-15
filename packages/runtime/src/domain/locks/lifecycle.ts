import type { EventV1, LockLeaseV1 } from "@kratos/contracts";

import {
  sealEvent,
  verifyEventStream,
  type EventDraftV1,
  type EventServices,
} from "../events/index.js";
import { canonicalizeJson, type SchemaRegistry } from "../schema/index.js";
import { parseOwner, lockPaths } from "./scope.js";

export type LockLifecycleAction = "acquire" | "renew" | "release" | "takeover";

const operationPattern =
  /^lock\.(acquire|renew|release|takeover)\.t(0|[1-9][0-9]*)\.d([a-f0-9]{64})$/u;

export type LockLifecycleServices = EventServices;

export interface PrepareLeaseTransitionInput {
  readonly action: LockLifecycleAction;
  readonly priorEvents: string;
  readonly lease: LockLeaseV1;
  readonly leaseRef: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface PreparedLeaseTransition {
  readonly event: EventV1;
  readonly lease: LockLeaseV1;
  readonly leaseText: string;
  readonly eventsText: string;
}

export interface LeaseBinding {
  readonly action: LockLifecycleAction;
  readonly event: EventV1;
  readonly events: readonly EventV1[];
  readonly lease: LockLeaseV1;
}

export class LeaseIntegrityError extends Error {
  public constructor() {
    super("Lease state integrity validation failed");
    this.name = "LeaseIntegrityError";
  }
}

function integrityFailure(): never {
  throw new LeaseIntegrityError();
}

function validateLease(
  value: unknown,
  schemaRegistry: SchemaRegistry,
): LockLeaseV1 {
  const result = schemaRegistry.validate({
    id: "state.lock",
    version: "1.0.0",
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (result.kind !== "valid") integrityFailure();
  try {
    lockPaths(result.value.resource);
    parseOwner(result.value.owner);
    return snapshot(result.value);
  } catch {
    return integrityFailure();
  }
}

function deeplyFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deeplyFreeze(child);
  return Object.freeze(value);
}

function snapshot<Value>(value: Value): Value {
  return deeplyFreeze(JSON.parse(canonicalizeJson(value)) as Value);
}

export function validateTokenTransition(
  action: LockLifecycleAction,
  priorToken: number,
  nextToken: number,
): void {
  const expected =
    action === "acquire" || action === "takeover" ? priorToken + 1 : priorToken;
  if (
    !Number.isSafeInteger(priorToken) ||
    !Number.isSafeInteger(nextToken) ||
    !Number.isSafeInteger(expected) ||
    priorToken < 0 ||
    nextToken < 0 ||
    nextToken !== expected
  ) {
    integrityFailure();
  }
}

export function parseLockOperation(operation: string): {
  readonly action: LockLifecycleAction;
  readonly token: number;
  readonly digest: string;
} {
  const match = operationPattern.exec(operation);
  if (match === null) integrityFailure();
  // The closed regular expression always captures all three groups.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const action = match[1]! as LockLifecycleAction;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const tokenText = match[2]!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const digest = match[3]!;
  const token = Number(tokenText);
  if (!Number.isSafeInteger(token)) integrityFailure();
  return Object.freeze({
    action,
    token,
    digest,
  });
}

function validateActionOrder(
  action: LockLifecycleAction,
  previous: LockLifecycleAction | null,
): void {
  const activeEpoch =
    previous === "acquire" || previous === "renew" || previous === "takeover";
  const allowed =
    previous === null
      ? action === "acquire"
      : action === "acquire"
        ? previous === "release"
        : activeEpoch;
  if (!allowed) integrityFailure();
}

function validateLifecycleEvents(
  events: readonly EventV1[],
  leaseRef: string,
): LockLifecycleAction {
  let previousAction: LockLifecycleAction | null = null;
  let previousToken = 0;
  let finalAction: LockLifecycleAction | null = null;
  for (const event of events) {
    const parsed = parseLockOperation(event.operation);
    validateActionOrder(parsed.action, previousAction);
    validateTokenTransition(parsed.action, previousToken, parsed.token);
    if (
      event.eventType !==
        (parsed.action === "takeover" ? "recovery" : "operation") ||
      event.policyVersion !== "locks-v1" ||
      event.reasonCode !== "trail.ok" ||
      event.effect !== "state" ||
      event.artifactRefs.length !== 1 ||
      event.artifactRefs[0] !== leaseRef ||
      event.evidenceRefs.length !== 0
    ) {
      integrityFailure();
    }
    previousAction = parsed.action;
    previousToken = parsed.token;
    finalAction = parsed.action;
  }
  if (finalAction === null) integrityFailure();
  return finalAction;
}

function lastEvent(events: readonly EventV1[]): EventV1 {
  // Callers validate non-emptiness before requesting the final event.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return events[events.length - 1]!;
}

function verifiedPrior(
  text: string,
  services: LockLifecycleServices,
): ReturnType<typeof verifyEventStream> {
  try {
    return verifyEventStream(text, services);
  } catch {
    return integrityFailure();
  }
}

export function prepareLeaseTransition(
  input: PrepareLeaseTransitionInput,
  services: LockLifecycleServices,
): PreparedLeaseTransition {
  let lease: LockLeaseV1;
  try {
    lease = validateLease(input.lease, services.schemaRegistry);
  } catch {
    return integrityFailure();
  }
  const expectedLeaseRef = lockPaths(lease.resource).lease;
  if (input.leaseRef !== expectedLeaseRef) integrityFailure();
  const prior = verifiedPrior(input.priorEvents, services);
  if (prior.events.length !== 0)
    validateLifecycleEvents(prior.events, expectedLeaseRef);
  const previous =
    prior.events.length === 0
      ? null
      : parseLockOperation(lastEvent(prior.events).operation);
  const previousAction = previous?.action ?? null;
  const previousToken = previous?.token ?? 0;
  validateActionOrder(input.action, previousAction);
  validateTokenTransition(input.action, previousToken, lease.fencingToken);
  const leaseText = canonicalizeJson(lease);
  const digest = services.digests.sha256(leaseText);
  const draft: EventDraftV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: input.eventId,
    eventType: input.action === "takeover" ? "recovery" : "operation",
    occurredAt: input.occurredAt,
    operation: `lock.${input.action}.t${String(lease.fencingToken)}.d${digest}`,
    policyVersion: "locks-v1",
    priorRevision: prior.cursor.revision,
    resultingRevision: prior.cursor.revision + 1,
    reasonCode: "trail.ok",
    effect: "state",
    artifactRefs: [input.leaseRef],
    evidenceRefs: [],
    observedIdentity: input.observedIdentity,
  };
  let sealed: EventV1;
  try {
    sealed = sealEvent(draft, prior.cursor, services);
  } catch {
    return integrityFailure();
  }
  const event = snapshot(sealed);
  const eventsText = `${prior.canonical}${canonicalizeJson(event)}\n`;
  return Object.freeze({
    event,
    lease,
    leaseText,
    eventsText,
  });
}

export function verifyLeaseBinding(
  eventsText: string,
  leaseText: string,
  services: LockLifecycleServices,
): LeaseBinding {
  const stream = verifiedPrior(eventsText, services);
  let parsedLease: unknown;
  try {
    parsedLease = JSON.parse(leaseText) as unknown;
  } catch {
    return integrityFailure();
  }
  let lease: LockLeaseV1;
  try {
    lease = validateLease(parsedLease, services.schemaRegistry);
    if (canonicalizeJson(lease) !== leaseText) integrityFailure();
  } catch {
    return integrityFailure();
  }
  const expectedLeaseRef = lockPaths(lease.resource).lease;
  const finalAction = validateLifecycleEvents(stream.events, expectedLeaseRef);
  const event = snapshot(lastEvent(stream.events));
  const operation = parseLockOperation(event.operation);
  if (
    operation.digest !== services.digests.sha256(leaseText) ||
    operation.token !== lease.fencingToken
  ) {
    integrityFailure();
  }
  const events = snapshot(stream.events);
  return Object.freeze({
    action: finalAction,
    event,
    events,
    lease,
  });
}
