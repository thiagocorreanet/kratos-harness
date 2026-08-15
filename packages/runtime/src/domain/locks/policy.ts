import type { LockLeaseV1 } from "@kratos/contracts";

import {
  classifyLeaseTime,
  lockPaths,
  parseOwner,
  validateTtl,
} from "./scope.js";
import type { LeaseBinding, LockLifecycleAction } from "./lifecycle.js";
import { LeasePolicyError, type LeaseResource } from "./model.js";

export type LeasePolicyBinding = Pick<LeaseBinding, "action" | "lease">;

const contractTimestamp =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u;

export type ExpectedLeaseIdentity = Pick<
  LockLeaseV1,
  "resource" | "owner" | "leaseId" | "fencingToken" | "stateRevision"
>;

export interface LeasePolicyDecisionTransition {
  readonly kind: "transition";
  readonly action: LockLifecycleAction;
  readonly lease: LockLeaseV1;
}

export type LeasePolicyDecision =
  | LeasePolicyDecisionTransition
  | { readonly kind: "conflict" }
  | { readonly kind: "takeover_required" };

interface BaseInput {
  readonly now: Date;
  readonly current: LeasePolicyBinding | null;
  readonly stateRevision: number;
}

export interface DecideAcquireInput extends BaseInput {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly leaseId: string;
  readonly ttlMs: number;
}

export interface DecideRenewInput extends BaseInput {
  readonly current: LeasePolicyBinding;
  readonly expectedIdentity: ExpectedLeaseIdentity;
  readonly ttlMs: number;
}

export interface DecideReleaseInput extends BaseInput {
  readonly current: LeasePolicyBinding;
  readonly expectedIdentity: ExpectedLeaseIdentity;
}

export interface DecideTakeoverInput extends BaseInput {
  readonly current: LeasePolicyBinding;
  readonly expectedIdentity: ExpectedLeaseIdentity;
  readonly owner: string;
  readonly leaseId: string;
  readonly ttlMs: number;
}

function invalidInput(): never {
  throw new LeasePolicyError("invalid_input");
}

function validNow(now: Date): string {
  const time = now.getTime();
  if (!Number.isFinite(time)) invalidInput();
  const timestamp = now.toISOString();
  if (!contractTimestamp.test(timestamp)) invalidInput();
  return timestamp;
}

function validateLeaseId(leaseId: string): void {
  lockPaths(`run:${leaseId}`);
}

function validRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalidInput();
  return value;
}

function exactIdentity(
  lease: LockLeaseV1,
  expected: ExpectedLeaseIdentity,
): boolean {
  return (
    lease.resource === expected.resource &&
    lease.owner === expected.owner &&
    lease.leaseId === expected.leaseId &&
    lease.fencingToken === expected.fencingToken &&
    lease.stateRevision === expected.stateRevision
  );
}

function nextExpiry(now: Date, ttlMs: number): string {
  const time = now.getTime() + validateTtl(ttlMs);
  const expiresAt = new Date(time);
  return validNow(expiresAt);
}

function nextFencingToken(token: number): number {
  if (!Number.isSafeInteger(token) || token >= Number.MAX_SAFE_INTEGER)
    throw new LeasePolicyError("invalid_transition");
  return token + 1;
}

function transition(
  action: LockLifecycleAction,
  lease: LockLeaseV1,
): LeasePolicyDecisionTransition {
  return Object.freeze({
    kind: "transition",
    action,
    lease: Object.freeze({ ...lease }),
  });
}

function conflict(): LeasePolicyDecision {
  return Object.freeze({ kind: "conflict" });
}

function takeoverRequired(): LeasePolicyDecision {
  return Object.freeze({ kind: "takeover_required" });
}

function currentState(
  current: LeasePolicyBinding,
  now: Date,
): ReturnType<typeof classifyLeaseTime> {
  return classifyLeaseTime(now, new Date(current.lease.expiresAt));
}

export function decideAcquire(input: DecideAcquireInput): LeasePolicyDecision {
  const acquiredAt = validNow(input.now);
  const stateRevision = validRevision(input.stateRevision);
  lockPaths(input.resource);
  parseOwner(input.owner);
  validateLeaseId(input.leaseId);
  validateTtl(input.ttlMs);
  if (input.current !== null) {
    if (input.current.action === "release") {
      if (input.current.lease.resource !== input.resource)
        throw new LeasePolicyError("invalid_transition");
      return transition("acquire", {
        ...input.current.lease,
        owner: input.owner,
        leaseId: input.leaseId,
        acquiredAt,
        expiresAt: nextExpiry(input.now, input.ttlMs),
        fencingToken: nextFencingToken(input.current.lease.fencingToken),
        stateRevision,
      });
    }
    return currentState(input.current, input.now) === "takeover_eligible"
      ? takeoverRequired()
      : conflict();
  }
  return transition("acquire", {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    resource: input.resource,
    owner: input.owner,
    leaseId: input.leaseId,
    acquiredAt,
    expiresAt: nextExpiry(input.now, input.ttlMs),
    fencingToken: 1,
    stateRevision,
  });
}

export function decideRenew(input: DecideRenewInput): LeasePolicyDecision {
  validNow(input.now);
  const stateRevision = validRevision(input.stateRevision);
  if (!exactIdentity(input.current.lease, input.expectedIdentity))
    return conflict();
  if (
    input.current.action !== "acquire" &&
    input.current.action !== "renew" &&
    input.current.action !== "takeover"
  )
    return conflict();
  if (currentState(input.current, input.now) !== "writable") return conflict();
  return transition("renew", {
    ...input.current.lease,
    expiresAt: nextExpiry(input.now, input.ttlMs),
    stateRevision,
  });
}

export function decideRelease(input: DecideReleaseInput): LeasePolicyDecision {
  const releasedAt = validNow(input.now);
  const stateRevision = validRevision(input.stateRevision);
  if (!exactIdentity(input.current.lease, input.expectedIdentity))
    return conflict();
  if (
    input.current.action !== "acquire" &&
    input.current.action !== "renew" &&
    input.current.action !== "takeover"
  )
    return conflict();
  if (currentState(input.current, input.now) !== "writable") return conflict();
  return transition("release", {
    ...input.current.lease,
    expiresAt: releasedAt,
    stateRevision,
  });
}

export function decideTakeover(
  input: DecideTakeoverInput,
): LeasePolicyDecision {
  const acquiredAt = validNow(input.now);
  const stateRevision = validRevision(input.stateRevision);
  parseOwner(input.owner);
  validateLeaseId(input.leaseId);
  validateTtl(input.ttlMs);
  if (!exactIdentity(input.current.lease, input.expectedIdentity))
    return conflict();
  if (
    input.current.action !== "acquire" &&
    input.current.action !== "renew" &&
    input.current.action !== "takeover"
  )
    return conflict();
  if (currentState(input.current, input.now) !== "takeover_eligible")
    return conflict();
  return transition("takeover", {
    ...input.current.lease,
    owner: input.owner,
    leaseId: input.leaseId,
    acquiredAt,
    expiresAt: nextExpiry(input.now, input.ttlMs),
    fencingToken: nextFencingToken(input.current.lease.fencingToken),
    stateRevision,
  });
}
