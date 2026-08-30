import type { EventV1 } from "@kratos/contracts";
import {
  deriveBudget,
  deriveStackProfileCheck,
  deriveStats,
  diagnose,
  explainReason,
} from "@kratos/runtime/domain/diagnostics";
import { describe, expect, it } from "vitest";

const baseEvent = {
  artifactRefs: ["artifact-a"],
  evidenceRefs: ["evidence-a"],
  reasonCode: "run.transition.accepted",
} as EventV1;

describe("read-only diagnostics", () => {
  it("derives stable event statistics without writing state", () => {
    expect(
      deriveStats([
        baseEvent,
        { ...baseEvent, reasonCode: "run.transition.rejected" },
        { ...baseEvent, reasonCode: "run.resumed" },
      ]),
    ).toEqual({
      events: 3,
      acceptedTransitions: 1,
      rejectedTransitions: 1,
      resumes: 1,
      artifactRefs: 1,
      evidenceRefs: 1,
    });
  });

  it("reports bounded and unbounded budgets honestly", () => {
    expect(deriveBudget(100, 40)).toEqual({
      allocated: 100,
      used: 40,
      remaining: 60,
      exhausted: false,
    });
    expect(deriveBudget(null, 40)).toEqual({
      allocated: null,
      used: 40,
      remaining: null,
      exhausted: false,
    });
    expect(deriveBudget(100, null)).toEqual({
      allocated: 100,
      used: null,
      remaining: null,
      exhausted: false,
    });
  });

  it("aggregates doctor checks independently of input order", () => {
    const checks = [
      { name: "state", status: "pass" as const, evidenceRef: null },
      { name: "locks", status: "warn" as const, evidenceRef: ".brain/locks" },
    ];
    expect(diagnose(checks)).toEqual(diagnose([...checks].reverse()));
    expect(diagnose(checks).health).toBe("degraded");
    expect(
      diagnose([
        { name: "gate", status: "block", evidenceRef: ".brain/gates.json" },
      ]).health,
    ).toBe("blocked");
  });

  it.each([
    [
      "matching authoritative bytes",
      {
        authoritativeState: { kind: "valid" },
        exists: true,
        regularFile: true,
        readable: true,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: { size: 10, sha256: "generated" },
        unresolvedKeys: [],
      },
      "pass",
      [],
    ],
    [
      "unresolved typed answers",
      {
        authoritativeState: { kind: "valid" },
        exists: true,
        regularFile: true,
        readable: true,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: { size: 10, sha256: "generated" },
        unresolvedKeys: [
          "projectProfile.commands.test",
          "projectProfile.paths.tests",
        ],
      },
      "warn",
      [
        "Resolve projectProfile.commands.test in the typed initialization answers, then rerun `kratos init`.",
        "Resolve projectProfile.paths.tests in the typed initialization answers, then rerun `kratos init`.",
      ],
    ],
    [
      "a missing generated document",
      {
        authoritativeState: { kind: "valid" },
        exists: false,
        regularFile: false,
        readable: false,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: null,
        unresolvedKeys: [],
      },
      "warn",
      ["The stack profile is missing; rerun `kratos init` to regenerate it."],
    ],
    [
      "a missing document with unresolved typed answers",
      {
        authoritativeState: { kind: "valid" },
        exists: false,
        regularFile: false,
        readable: false,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: null,
        unresolvedKeys: ["projectProfile.commands.test"],
      },
      "warn",
      [
        "The stack profile is missing; rerun `kratos init` to regenerate it.",
        "Resolve projectProfile.commands.test in the typed initialization answers, then rerun `kratos init`.",
      ],
    ],
    [
      "bytes drifted from authoritative state",
      {
        authoritativeState: { kind: "valid" },
        exists: true,
        regularFile: true,
        readable: true,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: { size: 16, sha256: "manually-edited" },
        unresolvedKeys: [],
      },
      "warn",
      [
        "The stack profile differs from authoritative state; rerun `kratos init` to regenerate it.",
      ],
    ],
    [
      "an unreadable destination",
      {
        authoritativeState: { kind: "valid" },
        exists: true,
        regularFile: true,
        readable: false,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: null,
        unresolvedKeys: [],
      },
      "fail",
      ["The stack profile destination is unreadable."],
    ],
    [
      "a non-file destination",
      {
        authoritativeState: { kind: "valid" },
        exists: true,
        regularFile: false,
        readable: false,
        expectedBytes: { size: 10, sha256: "generated" },
        actualBytes: null,
        unresolvedKeys: [],
      },
      "fail",
      ["The stack profile destination is not a regular file."],
    ],
    [
      "invalid authoritative state",
      {
        authoritativeState: {
          kind: "invalid",
          reasonCode: "guard.config_corrupt",
        },
        exists: true,
        regularFile: true,
        readable: true,
        expectedBytes: null,
        actualBytes: { size: 10, sha256: "generated" },
        unresolvedKeys: [],
      },
      "fail",
      ["The authoritative project configuration is invalid."],
    ],
    [
      "authoritative state that requires profile migration",
      {
        authoritativeState: {
          kind: "migration-required",
          reasonCode: "profile.config_migration_required",
        },
        exists: true,
        regularFile: true,
        readable: true,
        expectedBytes: null,
        actualBytes: null,
        unresolvedKeys: [],
      },
      "block",
      ["The project configuration requires explicit migration."],
    ],
  ] as const)(
    "classifies stack-profile readiness for %s",
    (_case, observation, status, details) => {
      expect(deriveStackProfileCheck).toBeTypeOf("function");
      expect(deriveStackProfileCheck(observation)).toEqual({
        name: "stack-profile",
        status,
        evidenceRef: ".brain/01-architecture/stack-profile.md",
        details,
      });
    },
  );

  it("explains catalog reasons and refuses invented ones", () => {
    expect(explainReason("runtime.revision_conflict")).toMatchObject({
      known: true,
      retryable: true,
    });
    expect(explainReason("invented.reason")).toEqual({
      known: false,
      code: "invented.reason",
      description: "The reason code is not registered in this runtime.",
      retryable: null,
      recovery: null,
    });
  });
});
