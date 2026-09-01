import {
  candidateNormalizationKey,
  captureCandidate,
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
      "ISO timestamps with offsets",
      "Build failed at 2026-08-28T12:00:00.000+03:00",
      "Build failed at 2026-08-28T12:01:00.000-05:00",
    ],
    [
      "UUIDs",
      "request 123e4567-e89b-12d3-a456-426614174000 failed",
      "request 123e4567-e89b-12d3-a456-426614174001 failed",
    ],
    [
      "UUID v7s",
      "request 018f8f1e-57f7-7c32-8a5d-96b5e20a5a17 failed",
      "request 018f8f1e-57f8-7c32-8a5d-96b5e20a5a18 failed",
    ],
    [
      "temporary path nonces",
      "failed in /tmp/kratos-test-123456/output",
      "failed in /tmp/kratos-test-654321/output",
    ],
    [
      "mixed temporary path nonces",
      "failed in /tmp/kratos-test-a1B2c3/output",
      "failed in /tmp/kratos-test-z9Y8x7/output",
    ],
    [
      "common mixed mkdtemp nonces",
      "failed in /tmp/kratos-test-ab12cd/output",
      "failed in /tmp/kratos-test-xy34z5/output",
    ],
    [
      "marked hexadecimal temporary path nonces",
      "failed in /tmp/kratos-cache-deadbeef/output",
      "failed in /tmp/kratos-cache-cafebabe/output",
    ],
    [
      "line and column locations",
      "src/a.ts:12:34 failed",
      "src/a.ts:99:1 failed",
    ],
    [
      "Windows line and column locations",
      String.raw`C:\work\src\a.ts:12:34 failed`,
      String.raw`C:\work\src\a.ts:99:1 failed`,
    ],
    [
      "Windows temporary path nonces",
      String.raw`failed in C:\Users\runner\AppData\Local\Temp\kratos-test-123456\output`,
      String.raw`failed in C:\Users\runner\AppData\Local\Temp\kratos-test-654321\output`,
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
    [
      "stable temporary path suffixes",
      "failed in /tmp/kratos-test-stable/output",
      "failed in /tmp/kratos-test-fixedx/output",
    ],
    [
      "substantive numbered temporary paths",
      "failed in /tmp/kratos-release-v1beta/output",
      "failed in /tmp/kratos-release-v2beta/output",
    ],
    [
      "semantic six-character temporary paths",
      "failed in /tmp/kratos-release-v12bet/output",
      "failed in /tmp/kratos-release-v13bet/output",
    ],
    ["non-location colon numbers", "ports 10:20", "ports 11:21"],
    ["non-location coordinate numbers", "limit 10:20:30", "limit 10:21:31"],
    ["relative paths", "src/a.ts failed", "src/b.ts failed"],
    ["commands", "npm test failed", "npm run build failed"],
    ["test names", "test adds users failed", "test removes users failed"],
    [
      "Windows drive-qualified source paths",
      String.raw`C:\work\src\a.ts failed`,
      String.raw`D:\work\src\a.ts failed`,
    ],
    [
      "Windows path case",
      String.raw`C:\work\src\A.ts failed`,
      String.raw`C:\work\src\a.ts failed`,
    ],
    [
      "Windows substantive numbered paths",
      String.raw`C:\work\release-v1\output failed`,
      String.raw`C:\work\release-v2\output failed`,
    ],
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

  it("deduplicates ANSI-only failures after the capture sanitization pipeline", () => {
    const digest = (text: string): string => `digest:${text}`;
    const one = failureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: sanitizeDiagnostic(
          "\u001b[31mBuild failed\u001b[0m",
          "/project",
        ),
        observedAt: first,
      },
      digest,
    );
    const two = failureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: sanitizeDiagnostic("Build failed", "/project"),
        observedAt: later,
      },
      digest,
    );

    expect(one.candidateId).toBe(two.candidateId);
  });

  it.each([
    ["accented", "é".repeat(1025), "é".repeat(1024)],
    ["emoji", "😀".repeat(513), "😀".repeat(512)],
  ])("bounds %s diagnostics by UTF-8 bytes", (_name, value, expected) => {
    const diagnostic = sanitizeDiagnostic(value, "/project");

    expect(diagnostic).toBe(expected);
    expect(Buffer.byteLength(diagnostic, "utf8")).toBeLessThanOrEqual(2048);
    expect(diagnostic).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  it("upgrades and increments a matching readable legacy candidate", () => {
    const digest = (text: string): string => `digest:${text}`;
    const decision = captureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: "Build failed at 2026-08-28T12:01:00.000+03:00",
        observedAt: later,
      },
      [
        {
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          candidateId: "a".repeat(64),
          toolFamily: "shell",
          failureClass: "nonzero_exit",
          exitCode: 1,
          diagnostic: "Build failed at 2026-08-28T12:00:00.000+03:00",
          firstObservedAt: first,
        },
      ],
      digest,
    );

    expect(decision).toMatchObject({
      write: true,
      candidate: {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        candidateId: "a".repeat(64),
        observationCount: 2,
        firstObservedAt: first,
        lastObservedAt: later,
      },
    });
  });

  it("increments a current candidate while preserving the observation extrema", () => {
    const digest = (text: string): string => `digest:${text}`;
    const decision = captureCandidate(
      {
        toolFamily: "shell",
        failureClass: "nonzero_exit",
        exitCode: 1,
        diagnostic: "Build failed",
        observedAt: "2026-08-29T00:00:00Z",
      },
      [
        {
          contractVersion: "1.1.0",
          stateContract: "1.1.0",
          candidateId: "a".repeat(64),
          toolFamily: "shell",
          failureClass: "nonzero_exit",
          exitCode: 1,
          diagnostic: "Build failed",
          observationCount: 2,
          firstObservedAt: "2026-08-28T00:00:00Z",
          lastObservedAt: "2026-08-30T00:00:00Z",
        },
      ],
      digest,
    );

    expect(decision.candidate).toMatchObject({
      observationCount: 3,
      firstObservedAt: "2026-08-28T00:00:00Z",
      lastObservedAt: "2026-08-30T00:00:00Z",
    });
  });
});
