import type { EventV1, LockLeaseV1 } from "@mestre-yoda/contracts";
import type { PathFingerprint } from "../transactions/index.js";

export const DEFAULT_LEASE_TTL_MS = 30_000;
export const LEASE_RENEWAL_THRESHOLD_MS = 10_000;
export const LEASE_SKEW_MS = 5_000;
export const MIN_LEASE_TTL_MS = 5_000;
export const MAX_LEASE_TTL_MS = 300_000;
export const CLAIM_TTL_MS = 30_000;

export type LeaseResource = "project" | `run:${string}`;
export type LeaseTimeState = "writable" | "skew" | "takeover_eligible";
export type LeaseSuccessKind = "acquired" | "renewed" | "released" | "taken_over";

export interface LeaseIdentity {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly stateRevision: number;
}

export interface LeaseGuard extends LeaseIdentity {
  readonly leaseFingerprint: PathFingerprint;
  readonly eventsFingerprint: PathFingerprint;
}

export interface LeaseObservation {
  readonly kind: "empty" | "active" | "released" | "skew" | "takeover_eligible";
  readonly lease: LockLeaseV1 | null;
  readonly guard: LeaseGuard | null;
}

export interface AcquireLeaseRequest {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly ttlMs: number;
  readonly stateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface RenewLeaseRequest {
  readonly observed: LeaseGuard;
  readonly ttlMs: number;
  readonly resultingStateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface ReleaseLeaseRequest {
  readonly observed: LeaseGuard;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface TakeoverLeaseRequest {
  readonly observed: LeaseGuard;
  readonly owner: string;
  readonly ttlMs: number;
  readonly stateRevision: number;
  readonly observedIdentity: EventV1["observedIdentity"];
}

export interface LeaseConflict {
  readonly owner: string;
  readonly resource: LeaseResource;
  readonly expiresAt: string;
  readonly retryable: true;
  readonly recovery: "wait_or_takeover";
}

export type LeaseOutcome =
  | {
      readonly kind: LeaseSuccessKind;
      readonly lease: LockLeaseV1;
      readonly guard: LeaseGuard;
      readonly event: EventV1;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "conflict"; readonly conflict: LeaseConflict }
  | {
      readonly kind:
        | "recovery_required"
        | "revision_conflict"
        | "corrupt"
        | "internal_failure";
      readonly evidence: readonly string[];
    };

export class LeasePolicyError extends Error {
  public constructor(public readonly kind: "invalid_input" | "invalid_transition") {
    super("Lock input is invalid");
    this.name = "LeasePolicyError";
  }
}
