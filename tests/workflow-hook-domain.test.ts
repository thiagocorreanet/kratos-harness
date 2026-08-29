import {
  candidateNormalizationKey,
  failureCandidate,
  initialRunUsage,
  recordUsageSample,
  sanitizeDiagnostic,
  unlockStopLoss,
} from "@kratos/runtime/domain/hooks";
import { describe, expect, it } from "vitest";

const first = "2026-08-28T12:00:00Z";
const later = "2026-08-28T12:01:00Z";

describe("workflow hook domain", () => {
  it.each([
    ["ANSI escapes", "\u001b[31mBuild failed\u001b[0m", "Build failed"],
    ["whitespace", "Build\n\t failed", "Build    failed"],
    [
      "ISO timestamps",
      "Build failed at 2026-08-28T12:00:00.000Z",
      "Build failed at 2026-08-28T12:01:00.000Z",
    ],
    [
      "UUIDs",
      "request 123e4567-e89b-12d3-a456-426614174000 failed",
      "request 123e4567-e89b-12d3-a456-426614174001 failed",
    ],
    [
      "temporary path nonces",
      "failed in /tmp/kratos-test-123456/output",
      "failed in /tmp/kratos-test-654321/output",
    ],
    [
      "line and column locations",
      "src/a.ts:12:34 failed",
      "src/a.ts:99:1 failed",
    ],
  ])("deduplicates volatile %s", (_name, oneDiagnostic, twoDiagnostic) => {
    const digest = (text: string): string => `digest:${text}`;
    const one = candidateNormalizationKey(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: oneDiagnostic,
        observedAt: first,
      },
      digest,
    );
    const two = candidateNormalizationKey(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: twoDiagnostic,
        observedAt: later,
      },
      digest,
    );

    expect(two).toBe(one);
  });

  it.each([
    ["case", "Build failed", "build failed"],
    ["substantive numbers", "exit 1", "exit 2"],
    ["non-location colon numbers", "ports 10:20", "ports 11:21"],
    ["non-location coordinate numbers", "limit 10:20:30", "limit 10:21:31"],
    ["relative paths", "src/a.ts failed", "src/b.ts failed"],
    ["commands", "npm test failed", "npm run build failed"],
    ["test names", "test adds users failed", "test removes users failed"],
  ])("keeps %s distinct", (_name, oneDiagnostic, twoDiagnostic) => {
    const digest = (text: string): string => `digest:${text}`;
    const one = candidateNormalizationKey(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: oneDiagnostic,
        observedAt: first,
      },
      digest,
    );
    const two = candidateNormalizationKey(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: twoDiagnostic,
        observedAt: later,
      },
      digest,
    );

    expect(two).not.toBe(one);
  });

  it("accumulates monotonic session deltas and latches the budget", () => {
    const empty = initialRunUsage("run-1", first);
    const sampled = recordUsageSample(empty, {
      sessionId: "session-a",
      cumulativeGrossTokens: 80,
      budget: 100,
      now: first,
    });
    const exhausted = recordUsageSample(sampled.usage, {
      sessionId: "session-b",
      cumulativeGrossTokens: 20,
      budget: 100,
      now: later,
    });
    const retried = recordUsageSample(exhausted.usage, {
      sessionId: "session-b",
      cumulativeGrossTokens: 20,
      budget: 100,
      now: later,
    });

    expect(exhausted.stopLoss).toEqual({ tripped: false, exhausted: true });
    expect(exhausted.usage.totalGrossTokens).toBe(100);
    expect(retried.usage).toEqual(exhausted.usage);
    expect(retried.stopLoss).toEqual(exhausted.stopLoss);
  });

  it("never subtracts a regressing session counter", () => {
    const sampled = recordUsageSample(initialRunUsage("run-1", first), {
      sessionId: "session-a",
      cumulativeGrossTokens: 80,
      budget: 100,
      now: first,
    });
    const regressed = recordUsageSample(sampled.usage, {
      sessionId: "session-a",
      cumulativeGrossTokens: 10,
      budget: 100,
      now: later,
    });
    expect(regressed.usage).toEqual(sampled.usage);
  });

  it("latches a measurement fault when a configured budget has no sample", () => {
    const result = recordUsageSample(initialRunUsage("run-1", first), {
      sessionId: "session-a",
      cumulativeGrossTokens: null,
      budget: 100,
      now: later,
    });
    expect(result.stopLoss).toEqual({ tripped: true, exhausted: false });
    expect(result.usage.measurementFaultAt).toBe(later);
  });

  it("clears the latch only by starting an explicit new epoch", () => {
    const exhausted = recordUsageSample(initialRunUsage("run-1", first), {
      sessionId: "session-a",
      cumulativeGrossTokens: 100,
      budget: 100,
      now: first,
    });
    const unlocked = unlockStopLoss(exhausted.usage, later);
    expect(unlocked.epoch).toEqual({
      number: 2,
      baselineGrossTokens: 100,
      exhaustedAt: null,
    });
    expect(unlocked.measurementFaultAt).toBeNull();
    expect(unlocked.totalGrossTokens).toBe(100);
  });

  it("sanitizes and fingerprints identical failures without session identity", () => {
    const diagnostic = sanitizeDiagnostic(
      "failed at /workspace/project/file.ts\r\nAuthorization: Bearer secret-token\u0007",
      "/workspace/project",
    );
    expect(diagnostic).toBe(
      "failed at <project>/file.ts\nAuthorization: Bearer <redacted>",
    );

    const digest = (text: string): string => `digest:${text}`;
    const one = failureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic,
        observedAt: first,
      },
      digest,
    );
    const two = failureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic,
        observedAt: later,
      },
      digest,
    );
    expect(two.candidateId).toBe(one.candidateId);
    expect(two.firstObservedAt).not.toBe(one.firstObservedAt);
  });
});
