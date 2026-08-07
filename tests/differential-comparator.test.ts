import {
  compareObservations,
  normalizeObservation,
  type DifferentialObservation,
  type DifferentialScenario,
} from "@mestre-yoda/differential";
import { describe, expect, it } from "vitest";

const emptyDigest =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function observation(): DifferentialObservation {
  return {
    process: {
      outcome: "exit",
      exitCode: 0,
      signal: null,
      stdout: { bytes: 0, sha256: emptyDigest },
      stderr: { bytes: 0, sha256: emptyDigest },
    },
    filesystem: { before: [], after: [], mutations: [] },
    structured: [],
    git: null,
  };
}

function scenario(
  expected: DifferentialObservation,
  normalization: DifferentialScenario["normalization"] = [],
): DifferentialScenario {
  return {
    schemaVersion: 1,
    id: "comparator-self-test",
    parityContractIds: ["CLI-VERSION"],
    workspace: { entries: [] },
    invocation: {
      args: [],
      stdin: "",
      environment: {},
      timeoutMs: 1_000,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    },
    capture: { structured: [], git: false },
    normalization,
    disclosure: {
      stdout: "digest",
      stderr: "digest",
      artifacts: "digest",
    },
    expected,
  };
}

describe("differential observation comparison", () => {
  it("reports exact equality", () => {
    const expected = observation();
    expect(
      compareObservations(
        scenario(expected),
        expected,
        structuredClone(expected),
      ),
    ).toEqual({
      scenarioId: "comparator-self-test",
      parityContractIds: ["CLI-VERSION"],
      equal: true,
      mismatches: [],
      normalization: [],
    });
  });

  it("sorts field-level candidate mismatches deterministically", () => {
    const expected = observation();
    const candidate = structuredClone(expected);
    candidate.process.exitCode = 2;
    candidate.filesystem.after = [
      {
        path: "unexpected.txt",
        type: "file",
        mode: "file",
        size: 1,
        sha256:
          "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      },
    ];

    const report = compareObservations(scenario(expected), expected, candidate);
    expect(report.equal).toBe(false);
    expect(
      report.mismatches.map(({ pointer, kind }) => [pointer, kind]),
    ).toEqual([
      ["/candidate/filesystem/after/0", "unexpected"],
      ["/candidate/process/exitCode", "value"],
    ]);
  });

  it("reports digest fields directly without disclosing stream content", () => {
    const expected = observation();
    const candidate = structuredClone(expected);
    candidate.process.stdout.sha256 =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mismatch = compareObservations(
      scenario(expected),
      expected,
      candidate,
    ).mismatches.find(({ pointer }) => pointer.endsWith("/stdout/sha256"));
    expect(mismatch).toMatchObject({
      oracle: emptyDigest,
      candidate:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("does not disclose private structured keys or scalar values in digest mode", () => {
    const expected = observation();
    expected.structured = [
      { id: "result", path: "result.json", value: { privateField: 123 } },
    ];
    const candidate: DifferentialObservation = {
      ...structuredClone(expected),
      structured: [
        { id: "result", path: "result.json", value: { privateField: 456 } },
      ],
    };

    const report = compareObservations(scenario(expected), expected, candidate);
    const serialized = JSON.stringify(report);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]?.pointer).toBe("/candidate/structured/0/value");
    expect(serialized).not.toContain("privateField");
    expect(serialized).not.toContain("123");
    expect(serialized).not.toContain("456");
  });

  it.each([
    ["timeout", "timeout"],
    ["signal", "crash"],
  ] as const)("classifies %s outcomes", (outcome, kind) => {
    const expected = observation();
    const candidate = structuredClone(expected);
    candidate.process.outcome = outcome;
    candidate.process.exitCode = null;
    candidate.process.signal = outcome === "signal" ? "SIGABRT" : null;
    const report = compareObservations(scenario(expected), expected, candidate);
    expect(report.mismatches.some((mismatch) => mismatch.kind === kind)).toBe(
      true,
    );
  });

  it("classifies retained mutations after failure", () => {
    const expected = observation();
    const candidate = structuredClone(expected);
    candidate.process.exitCode = 1;
    candidate.filesystem.mutations = [
      { path: ".brain/state.json", kind: "added" },
    ];
    const report = compareObservations(scenario(expected), expected, candidate);
    expect(
      report.mismatches.some(({ kind }) => kind === "partial_mutation"),
    ).toBe(true);
  });

  it("normalizes only explicitly selected values without mutating input", () => {
    const input = observation();
    input.process.stdout = {
      bytes: 32,
      sha256: emptyDigest,
      content: "/tmp/oracle-root/a\r\n",
    };
    input.structured = [
      {
        id: "result",
        path: "result.json",
        value: {
          timestamp: "2026-08-07T00:00:00Z",
          entries: [{ id: "b" }, { id: "a" }],
          duration: 42,
        },
      },
    ];

    const normalized = normalizeObservation(
      input,
      [
        { operation: "line_endings", pointer: "/process/stdout/content" },
        { operation: "workspace_path", pointer: "/process/stdout/content" },
        {
          operation: "replace_json_value",
          pointer: "/structured/0/value/timestamp",
          token: "<TIMESTAMP>",
        },
        {
          operation: "sort_json_array",
          pointer: "/structured/0/value/entries",
          identityKey: "id",
        },
        {
          operation: "remove_field",
          pointer: "/structured/0/value/duration",
          justification: "Measured process duration is nondeterministic.",
        },
      ],
      "/tmp/oracle-root",
    );

    expect(normalized.process.stdout.content).toBe("<WORKSPACE>/a\n");
    expect(normalized.structured[0]?.value).toEqual({
      timestamp: "<TIMESTAMP>",
      entries: [{ id: "a" }, { id: "b" }],
    });
    expect(input.process.stdout.content).toContain("\r\n");
  });

  it.each([
    "/process/exitCode",
    "/process/outcome",
    "/structured/0/value/status",
    "/structured/0/value/exitCode",
    "/structured/0/value/reasonCode",
    "/filesystem/mutations",
    "/git",
  ])("rejects normalization of protected field %s", (pointer) => {
    expect(() =>
      normalizeObservation(
        observation(),
        [
          {
            operation: "remove_field",
            pointer,
            justification: "This should never be accepted by the harness.",
          },
        ],
        "/tmp/workspace",
      ),
    ).toThrow("Differential normalization targets a protected field");
  });
});
