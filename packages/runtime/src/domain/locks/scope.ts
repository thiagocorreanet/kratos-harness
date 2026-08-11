import {
  LEASE_SKEW_MS,
  MAX_LEASE_TTL_MS,
  MIN_LEASE_TTL_MS,
  LeasePolicyError,
  type LeaseTimeState,
} from "./model.js";

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ownerPart = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;
const base64url = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeRunId(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : null;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : null;
    encoded += base64url[first >> 2]!;
    encoded += base64url[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!;
    if (second !== null)
      encoded += base64url[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!;
    if (third !== null) encoded += base64url[third & 0x3f]!;
  }
  return encoded;
}

export interface LockPaths {
  readonly root: string;
  readonly lease: string;
  readonly events: string;
  readonly claim: string;
  readonly claimRecord: string;
  readonly admissionClaim: string;
  readonly admissionRecord: string;
}

export function lockPaths(input: string): LockPaths {
  const root =
    input === "project"
      ? ".brain/locks/project"
      : input.startsWith("run:") && id.test(input.slice(4))
        ? `.brain/locks/runs/${encodeRunId(input.slice(4))}`
        : null;
  if (root === null) throw new LeasePolicyError("invalid_input");
  return {
    root,
    lease: `${root}/lease.json`,
    events: `${root}/events.jsonl`,
    claim: `${root}/claim`,
    claimRecord: `${root}/claim/claim.json`,
    admissionClaim: ".brain/locks/.admission/claim",
    admissionRecord: ".brain/locks/.admission/claim/claim.json",
  };
}

export function parseOwner(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2 || !ownerPart.test(parts[0] ?? "") || !ownerPart.test(parts[1] ?? ""))
    throw new LeasePolicyError("invalid_input");
  return { host: parts[0]!, sessionId: parts[1]!, value } as const;
}

export function validateTtl(ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_LEASE_TTL_MS || ttlMs > MAX_LEASE_TTL_MS)
    throw new LeasePolicyError("invalid_input");
  return ttlMs;
}

export function classifyLeaseTime(now: Date, expiresAt: Date): LeaseTimeState {
  const current = now.getTime();
  const expiry = expiresAt.getTime();
  if (!Number.isFinite(current) || !Number.isFinite(expiry))
    throw new LeasePolicyError("invalid_input");
  if (current < expiry) return "writable";
  return current < expiry + LEASE_SKEW_MS ? "skew" : "takeover_eligible";
}
