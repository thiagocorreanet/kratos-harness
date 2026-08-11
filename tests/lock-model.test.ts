import {
  CLAIM_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  LEASE_RENEWAL_THRESHOLD_MS,
  LEASE_SKEW_MS,
  classifyLeaseTime,
  lockPaths,
  parseOwner,
  validateTtl,
} from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

describe("lock domain boundaries", () => {
  it.each([
    ["project", ".brain/locks/project"],
    ["run:a", ".brain/locks/runs/YQ"],
    ["run:ab", ".brain/locks/runs/YWI"],
    ["run:run-01", ".brain/locks/runs/cnVuLTAx"],
    ["run:group:run-01", ".brain/locks/runs/Z3JvdXA6cnVuLTAx"],
  ] as const)("maps %s without exposing contract separators", (resource, root) => {
    expect(lockPaths(resource)).toEqual({
      root,
      lease: `${root}/lease.json`,
      events: `${root}/events.jsonl`,
      claim: `${root}/claim`,
      claimRecord: `${root}/claim/claim.json`,
      admissionClaim: ".brain/locks/.admission/claim",
      admissionRecord: ".brain/locks/.admission/claim/claim.json",
    });
  });

  it.each(["run:", "run:a/b", "run:a\\b", "Project", ".admission"])(
    "rejects invalid resource %s",
    (resource) => expect(() => lockPaths(resource)).toThrow("Lock input is invalid"),
  );

  it("closes owner and duration policy", () => {
    expect(parseOwner("codex:session-01")).toEqual({
      host: "codex",
      sessionId: "session-01",
      value: "codex:session-01",
    });
    expect(() => parseOwner("codex:session:01")).toThrow("Lock input is invalid");
    expect(() => parseOwner("codex!:session-01")).toThrow("Lock input is invalid");
    expect(() => parseOwner("codex:session!01")).toThrow("Lock input is invalid");
    expect(validateTtl(5_000)).toBe(5_000);
    expect(validateTtl(300_000)).toBe(300_000);
    expect(() => validateTtl(5_000.5)).toThrow("Lock input is invalid");
    expect(() => validateTtl(4_999)).toThrow("Lock input is invalid");
    expect(() => validateTtl(300_001)).toThrow("Lock input is invalid");
    expect({
      CLAIM_TTL_MS,
      DEFAULT_LEASE_TTL_MS,
      LEASE_RENEWAL_THRESHOLD_MS,
      LEASE_SKEW_MS,
    }).toEqual({
      CLAIM_TTL_MS: 30_000,
      DEFAULT_LEASE_TTL_MS: 30_000,
      LEASE_RENEWAL_THRESHOLD_MS: 10_000,
      LEASE_SKEW_MS: 5_000,
    });
  });

  it.each([
    ["2026-08-11T00:00:29.999Z", "writable"],
    ["2026-08-11T00:00:30.000Z", "skew"],
    ["2026-08-11T00:00:34.999Z", "skew"],
    ["2026-08-11T00:00:35.000Z", "takeover_eligible"],
  ] as const)("classifies %s as %s", (now, expected) => {
    expect(
      classifyLeaseTime(
        new Date(now),
        new Date("2026-08-11T00:00:30.000Z"),
      ),
    ).toBe(expected);
  });

  it("rejects invalid lease times", () => {
    expect(() => classifyLeaseTime(new Date("invalid"), new Date())).toThrow(
      "Lock input is invalid",
    );
    expect(() => classifyLeaseTime(new Date(), new Date("invalid"))).toThrow(
      "Lock input is invalid",
    );
  });
});
