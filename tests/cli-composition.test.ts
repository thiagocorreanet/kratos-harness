import { KRATOS_VERSION, type CurrentPhaseHandoff } from "@kratos/contracts";
import adapterMessage from "../fixtures/contracts/v1/adapter-message.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { runCli } from "@kratos/runtime";
import {
  createRuntime,
  createSchemaRegistry,
  TransactionFailure,
} from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { planOf } from "@kratos/runtime/domain/effects";
import {
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@kratos/runtime/domain/result";
import type {
  ContractId,
  ContractRequest,
  SchemaRegistry,
} from "@kratos/runtime/domain/schema";
import {
  fixedClock,
  memoryFileSystem,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import type { EvidenceRef } from "@kratos/runtime/domain/result";
import type { DurableFileSystem } from "@kratos/runtime/ports";

function trackingSchemaRegistry(
  registry: SchemaRegistry,
  onValidate: (request: ContractRequest<ContractId>) => void,
): SchemaRegistry {
  const rawValidate = registry.validate.bind(registry) as (
    request: ContractRequest<ContractId>,
  ) => unknown;
  const validate = (request: ContractRequest<ContractId>): unknown => {
    onValidate(request);
    return rawValidate(request);
  };
  return { validate } as SchemaRegistry;
}

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));
  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

const transactionReasons = [
  {
    reasonCode: "guard.outside_allow" as const,
    status: "failure",
    exitCode: 2,
    retryable: true,
    recovery:
      "Move the change inside an allowed scope or obtain an explicit reviewed scope update.",
    evidence: [
      { kind: "artifact", ref: ".brain/request.json" },
    ] satisfies readonly EvidenceRef[],
  },
  {
    reasonCode: "runtime.internal_failure" as const,
    status: "failure",
    exitCode: 2,
    retryable: false,
    recovery:
      "Capture an authorized redacted diagnostic bundle and report the stable reason without blindly retrying.",
    evidence: [
      { kind: "artifact", ref: ".brain/private-payload.json" },
    ] satisfies readonly EvidenceRef[],
  },
  {
    reasonCode: "runtime.recovery_required" as const,
    status: "blocked",
    exitCode: 4,
    retryable: true,
    recovery:
      "Run the explicit transaction recovery operation, verify its event evidence, and then repeat the original request.",
    evidence: [
      {
        kind: "artifact",
        ref: ".brain/transactions/transaction-1/progress.json",
      },
    ] satisfies readonly EvidenceRef[],
  },
  {
    reasonCode: "runtime.revision_conflict" as const,
    status: "blocked",
    exitCode: 5,
    retryable: true,
    recovery:
      "Reload canonical state, recompute the decision from the new revision, and submit a fresh mutation.",
    evidence: [
      { kind: "artifact", ref: ".brain/state.json" },
    ] satisfies readonly EvidenceRef[],
  },
  {
    reasonCode: "runtime.state_corrupt" as const,
    status: "blocked",
    exitCode: 4,
    retryable: true,
    recovery:
      "Preserve the rejected state, run the explicit integrity audit, and retry only after verified repair or rebuild.",
    evidence: [
      { kind: "artifact", ref: ".brain/events.jsonl" },
    ] satisfies readonly EvidenceRef[],
  },
] as const;

describe("composed command line", () => {
  it("serializes a doctor report through the composed dispatcher", async () => {
    const output = recordingOutput();
    const registry = [
      {
        path: ["doctor-report"],
        summary: "Emit a doctor report.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "doctor-report@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: null,
          payload: {
            contractVersion: "1.0.0",
            hostContract: "1.4.0",
            health: "degraded",
            checks: [
              {
                name: "gates",
                status: "warn",
                evidenceRef: ".brain/gates.json",
                details: ["gaps-closed: shadow gate.gaps_abertos"],
              },
            ],
            gateFailures: [
              {
                gateId: "gaps-closed",
                reasonCode: "gate.gaps_abertos",
                priority: 50,
                mode: "shadow",
                evidenceRefs: [".brain/gates.json"],
                detail: null,
              },
            ],
          },
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "doctor-report"],
        createRuntime({ output }),
        registry,
      ),
    ).toBe(0);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      contractVersion: "1.0.0",
      hostContract: "1.4.0",
      health: "degraded",
      gateFailures: [
        expect.objectContaining({
          gateId: "gaps-closed",
          mode: "shadow",
        }),
      ],
    });
  });

  it("serializes a v1.4 phase handoff through the composed dispatcher", async () => {
    const output = recordingOutput();
    const handoff: CurrentPhaseHandoff = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      feature: "feature-1",
      runId: "run-1",
      revision: 1,
      phase: "code",
      host: "claude",
      assignment: {
        phase: "code",
        role: "implementer",
        model: "claude-3-5-sonnet",
        effort: "standard",
      },
      assignmentDigest: "0".repeat(64),
      objectiveDigest: "0".repeat(64),
      status: "active",
      gateOutcome: "pass",
      gateFailures: [],
      blockers: [],
      openGaps: 0,
      nextAction: "continue",
      acceptance: {
        attemptCeiling: null,
        attempts: [],
        faultsRequiredFor: [],
        faults: [],
      },
      memory: {
        ref: ".brain/03-memory/gotchas.md",
        sha256: "0".repeat(64),
        lessonIds: [],
      },
    };
    const registry = [
      {
        path: ["handoff-v1-4"],
        summary: "Emit a current phase handoff.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "phase-handoff@1.4.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: null,
          payload: handoff,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "handoff-v1-4"],
        createRuntime({ output }),
        registry,
      ),
    ).toBe(0);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      gateFailures: [],
    });
  });

  it("delegates the process entry to the composed pipeline", async () => {
    const output = recordingOutput();
    const exitCode = await runCli(["version"], createRuntime({ output }));
    expect(exitCode).toBe(0);
    expect(output.structured_.join("")).toBe(`${KRATOS_VERSION}\n`);
  });

  it("prints usage on stdout with an empty stderr", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: kratos");
    expect(result.stderr).toBe("");
  });

  it("prints exactly the version", async () => {
    expect(await run(["version"])).toEqual({
      exitCode: 0,
      stdout: `${KRATOS_VERSION}\n`,
      stderr: "",
    });
  });

  it("emits one result envelope in JSON mode", async () => {
    const result = await run(["--json", "version"]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "runtime.orientation_ok",
    });
    expect(result.stdout.trimEnd()).not.toContain("\n");
  });

  it("allows JSON escaping after validating raw result fields", async () => {
    const output = recordingOutput();
    const quoted = [
      {
        path: ["quoted"],
        summary: "Return quoted prose.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok", {
            summary: 'A "quoted" summary.',
          }),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "quoted"],
        createRuntime({ output }),
        quoted,
      ),
    ).toBe(0);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      summary: 'A "quoted" summary.',
    });
  });

  it("emits the declared adapter message for the handshake", async () => {
    expect(
      JSON.parse((await run(["--json", "handshake"])).stdout),
    ).toMatchObject({
      operation: "handshake",
      payloadContract: "result@1.0.0",
    });
  });

  it("writes a human failure to stderr and nothing to stdout", async () => {
    const result = await run(["start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Reason: guard.config_missing");
  });

  it("writes a JSON failure to stdout as one envelope", async () => {
    const result = await run(["--json", "start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      reasonCode: "guard.config_missing",
    });
  });

  it("renders malformed globals and command arguments through usage results", async () => {
    expect(await run(["--json", "--expect"])).toMatchObject({
      exitCode: 2,
      stderr: "",
    });
    expect(await run(["--expect", "--json"])).toMatchObject({
      exitCode: 2,
      stderr: "",
    });
    expect((await run(["version", "--unknown"])).stderr).toContain(
      "Reason: trail.uso",
    );
  });

  it("renders an unexpected failure as a sanitized internal failure", async () => {
    const output = recordingOutput();
    const exploding = [
      {
        path: ["boom"],
        summary: "Throw on purpose.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => {
          throw new Error("/home/someone/secret-token");
        },
      },
    ];
    const exitCode = await runCommandLine(
      ["boom"],
      createRuntime({ output }),
      exploding,
    );
    expect(exitCode).toBe(2);
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
    expect(output.human_.join("")).not.toContain("secret-token");
    expect(output.structured_.join("")).toBe("");
  });

  it.each(transactionReasons)(
    "maps $reasonCode through the catalog in human and JSON modes",
    async ({ reasonCode, status, exitCode, retryable, recovery, evidence }) => {
      const registry = [
        {
          path: ["transaction-failure"],
          summary: "Raise a typed transaction failure.",
          flags: [],
          positionals: { min: 0, max: 0 },
          jsonContract: "result@1.0.0" as const,
          prerequisite: "none" as const,
          handler: () => {
            const failure = new TransactionFailure(reasonCode, evidence);
            failure.message =
              "/home/someone/project/.brain private-payload-content";
            throw failure;
          },
        },
      ];

      const humanOutput = recordingOutput();
      const humanExit = await runCommandLine(
        ["transaction-failure"],
        createRuntime({ output: humanOutput }),
        registry,
      );
      const human = humanOutput.human_.join("");
      expect(humanExit).toBe(exitCode);
      expect(humanOutput.structured_.join("")).toBe("");
      expect(human).toContain(`Reason: ${reasonCode}`);
      expect(human).toContain(`Retryable: ${String(retryable)}`);
      expect(human).toContain(`Recovery: ${recovery}`);
      const expectedEvidence =
        reasonCode === "runtime.internal_failure" ? [] : evidence;
      for (const item of expectedEvidence) {
        expect(human).toContain(`Evidence: ${item.kind} ${item.ref}`);
      }
      if (reasonCode === "runtime.internal_failure") {
        expect(human).not.toContain("Evidence:");
      }
      expect(human).not.toContain("/home/someone");
      expect(human).not.toContain("private-payload-content");

      const jsonOutput = recordingOutput();
      const jsonExit = await runCommandLine(
        ["--json", "transaction-failure"],
        createRuntime({ output: jsonOutput }),
        registry,
      );
      const jsonText = jsonOutput.structured_.join("");
      expect(jsonExit).toBe(exitCode);
      expect(jsonOutput.human_.join("")).toBe("");
      expect(JSON.parse(jsonText)).toMatchObject({
        status,
        exitCode,
        reasonCode,
        evidence: expectedEvidence,
        stateChanged: false,
        retryable,
        recovery,
      });
      expect(jsonText).not.toContain("/home/someone");
      expect(jsonText).not.toContain("private-payload-content");
    },
  );

  it("does not classify an error by its name or message", async () => {
    const output = recordingOutput();
    const lookalike = [
      {
        path: ["lookalike"],
        summary: "Raise an untyped lookalike.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => {
          const error = new Error("Managed transaction failed");
          error.name = "TransactionFailure";
          throw error;
        },
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "lookalike"],
        createRuntime({ output }),
        lookalike,
      ),
    ).toBe(2);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
      evidence: [],
    });
  });

  it("renders a missing append reducer without exposing its event", async () => {
    const output = recordingOutput();
    const append = [
      {
        path: ["append"],
        summary: "Attempt an event append.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("trail.ok", {
            evidence: [{ kind: "event" as const, ref: ".brain/events.jsonl" }],
          }),
          plan: planOf({
            kind: "append_event" as const,
            feature: "sample-feature",
            runId: "run-01",
            event: {
              contractVersion: "1.2.0",
              stateContract: "1.2.0",
              eventId: "private-event-id",
              eventType: "operation",
              occurredAt: "2026-08-10T00:01:00Z",
              operation: "runtime.test:step-1",
              policyVersion: "policy-01",
              priorRevision: 0,
              resultingRevision: 1,
              reasonCode: "ok",
              effect: "state",
              artifactRefs: [".brain/features/feature-1.md"],
              evidenceRefs: [".brain/evidence/private-event.json"],
              gateFailures: [],
              observedIdentity: {
                host: "codex",
                model: "gpt-5",
                effort: null,
              },
            },
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "append"],
        createRuntime({ output }),
        append,
      ),
    ).toBe(4);
    const rendered = output.structured_.join("");
    expect(JSON.parse(rendered)).toMatchObject({
      status: "blocked",
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      evidence: [
        {
          kind: "event",
          ref: ".brain/02-features/sample-feature/runs/run-01/events.jsonl",
        },
        {
          kind: "artifact",
          ref: ".brain/02-features/sample-feature/runs/run-01/state.json",
        },
      ],
      stateChanged: false,
      retryable: true,
    });
    expect(rendered).not.toContain("private-event-id");
  });

  it("validates a decision before applying its effect plan", async () => {
    const fileSystem = memoryFileSystem();
    const output = recordingOutput();
    const invalid = [
      {
        path: ["invalid"],
        summary: "Return an invalid result.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("trail.uso"),
          plan: planOf({
            kind: "write_file" as const,
            path: "changed.txt",
            content: "must not be written",
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    const exitCode = await runCommandLine(
      ["invalid"],
      createRuntime({ fileSystem, output }),
      invalid,
    );
    expect(exitCode).toBe(2);
    expect(await fileSystem.stat("changed.txt")).toBeNull();
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
  });

  it("publishes a command-owned failure through the result renderer", async () => {
    const output = recordingOutput();
    const fileSystem = memoryFileSystem();
    const failing = [
      {
        path: ["fail"],
        summary: "Return a failure.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: usageFailure(USAGE_WHY.arity),
          plan: planOf({
            kind: "write_file" as const,
            path: "must-not-change.txt",
            content: "forbidden",
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];
    expect(
      await runCommandLine(
        ["fail"],
        createRuntime({ fileSystem, output }),
        failing,
      ),
    ).toBe(2);
    expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
  });

  it("publishes a valid command-owned failure", async () => {
    const output = recordingOutput();
    const failing = [
      {
        path: ["fail-cleanly"],
        summary: "Return a failure without effects.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: usageFailure(USAGE_WHY.arity),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["fail-cleanly"],
        createRuntime({ output }),
        failing,
      ),
    ).toBe(2);
    expect(output.human_.join("")).toContain("Reason: trail.uso");
  });

  it("rejects state effects when the result denies a state change", async () => {
    const output = recordingOutput();
    const fileSystem = memoryFileSystem();
    const inconsistent = [
      {
        path: ["inconsistent"],
        summary: "Return an inconsistent success.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf({
            kind: "write_file" as const,
            path: "must-not-change.txt",
            content: "forbidden",
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["inconsistent"],
        createRuntime({ fileSystem, output }),
        inconsistent,
      ),
    ).toBe(2);
    expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
  });

  it("rejects handler-owned output effects", async () => {
    const output = recordingOutput();
    const emitting = [
      {
        path: ["emitting"],
        summary: "Emit unmanaged output.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf({
            kind: "emit" as const,
            channel: "structured" as const,
            text: "unmanaged\n",
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "emitting"],
        createRuntime({ output }),
        emitting,
      ),
    ).toBe(2);
    expect(output.structured_.join("")).not.toContain("unmanaged");
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
  });

  it("rejects unsafe handler-owned human output", async () => {
    const output = recordingOutput();
    const unsafe = [
      {
        path: ["unsafe"],
        summary: "Return unsafe human text.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: "/home/customer/private.txt\n",
          payload: null,
        }),
      },
    ];

    expect(
      await runCommandLine(["unsafe"], createRuntime({ output }), unsafe),
    ).toBe(2);
    expect(output.structured_.join("")).not.toContain("/home/customer");
    expect(output.human_.join("")).not.toContain("/home/customer");
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
  });

  it("uses a successful result summary when a command owns no human text", async () => {
    const output = recordingOutput();
    const summarized = [
      {
        path: ["summarized"],
        summary: "Return a summary.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok", {
            summary: "Summary fallback.",
          }),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }),
      },
    ];
    expect(
      await runCommandLine(
        ["summarized"],
        createRuntime({ output }),
        summarized,
      ),
    ).toBe(0);
    expect(output.structured_.join("")).toBe("Summary fallback.\n");
  });

  it("reports the concrete managed-state outcome for successful commands", async () => {
    const runTrailPlan = async (
      plan: ReturnType<typeof planOf>,
      seed: Parameters<typeof memoryTransactionStorage>[0],
      json: boolean,
    ) => {
      const storage = memoryTransactionStorage(seed);
      const output = recordingOutput();
      const registry = [
        {
          path: ["state-outcome"],
          summary: "Report a concrete state outcome.",
          flags: [],
          positionals: { min: 0, max: 0 },
          jsonContract: "result@1.0.0" as const,
          prerequisite: "none" as const,
          handler: () => ({
            result: resultFor("trail.ok", {
              summary: "State outcome recorded.",
              evidence: [
                { kind: "event" as const, ref: ".brain/events.jsonl" },
              ],
            }),
            plan,
            humanStdout: null,
            payload: null,
          }),
        },
      ];
      const exitCode = await runCommandLine(
        json ? ["--json", "state-outcome"] : ["state-outcome"],
        createRuntime({
          clock: fixedClock("2026-08-09T00:00:00.000Z"),
          ids: sequentialIds("transaction"),
          fileSystem: storage.fileSystem,
          durableFileSystem: storage.durableFileSystem,
          digests: storage.digests,
          output,
        }),
        registry,
      );
      return { exitCode, output, storage };
    };

    const satisfiedPlan = planOf({
      kind: "write_file",
      path: ".brain/state.json",
      content: "same",
    });
    const satisfied = await runTrailPlan(
      satisfiedPlan,
      {
        directories: [".brain", ".brain/transactions"],
        files: { ".brain/state.json": "same" },
      },
      true,
    );
    expect(satisfied.exitCode).toBe(0);
    expect(JSON.parse(satisfied.output.structured_.join(""))).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: false,
    });
    expect(satisfied.storage.calls()).not.toContain(
      "create_directory_exclusive",
    );

    const committed = await runTrailPlan(
      satisfiedPlan,
      { directories: [".brain", ".brain/transactions"] },
      true,
    );
    expect(JSON.parse(committed.output.structured_.join(""))).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    const unmanaged = await runTrailPlan(
      planOf(),
      { directories: [".brain", ".brain/transactions"] },
      true,
    );
    expect(JSON.parse(unmanaged.output.structured_.join(""))).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: false,
    });

    const human = await runTrailPlan(
      satisfiedPlan,
      {
        directories: [".brain", ".brain/transactions"],
        files: { ".brain/state.json": "same" },
      },
      false,
    );
    expect(human).toMatchObject({ exitCode: 0 });
    expect(human.output.structured_.join("")).toBe("State outcome recorded.\n");
    expect(human.output.human_).toEqual([]);
  });

  it("rejects an invalid adapter payload before effects or output", async () => {
    const output = recordingOutput();
    const fileSystem = memoryFileSystem();
    const invalidAdapter = [
      {
        path: ["invalid-adapter"],
        summary: "Return an invalid adapter payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("trail.ok", {
            evidence: [{ kind: "event" as const, ref: ".brain/events.jsonl" }],
          }),
          plan: planOf({
            kind: "write_file" as const,
            path: "must-not-change.txt",
            content: "forbidden",
          }),
          humanStdout: null,
          payload: { not: "an adapter message" },
        }),
      },
    ];

    const exitCode = await runCommandLine(
      ["--json", "invalid-adapter"],
      createRuntime({ fileSystem, output }),
      invalidAdapter,
    );

    expect(exitCode).toBe(2);
    expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
    expect(output.structured_.join("")).not.toContain("an adapter message");
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
  });

  it.each([
    [
      "accessor",
      () => {
        let accessed = false;
        const payload = Object.defineProperty(
          structuredClone(adapterMessage),
          "hostContract",
          {
            enumerable: true,
            get() {
              accessed = true;
              throw new Error("hostile accessor invoked");
            },
          },
        );
        return { payload, wasAccessed: () => accessed };
      },
    ],
    [
      "Proxy",
      () => {
        let accessed = false;
        const payload = new Proxy(structuredClone(adapterMessage), {
          get() {
            accessed = true;
            throw new Error("hostile Proxy trap invoked");
          },
        });
        return { payload, wasAccessed: () => accessed };
      },
    ],
    [
      "revoked Proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable(
          structuredClone(adapterMessage),
          {},
        );
        revoke();
        return { payload: proxy, wasAccessed: () => false };
      },
    ],
  ])(
    "rejects an adapter payload with a hostile %s before effects or output",
    async (_, hostile) => {
      const output = recordingOutput();
      const fileSystem = memoryFileSystem();
      const { payload, wasAccessed } = hostile();
      const validationRequests: unknown[] = [];
      const productionRegistry = createSchemaRegistry();
      const schemaRegistry = trackingSchemaRegistry(
        productionRegistry,
        (request) => {
          validationRequests.push(request);
        },
      );
      const hostileAdapter = [
        {
          path: ["hostile-adapter"],
          summary: "Return a hostile adapter payload.",
          flags: [],
          positionals: { min: 0, max: 0 },
          jsonContract: "adapter-message@1.0.0" as const,
          prerequisite: "none" as const,
          handler: () => ({
            result: resultFor("trail.ok", {
              evidence: [
                { kind: "event" as const, ref: ".brain/events.jsonl" },
              ],
            }),
            plan: planOf({
              kind: "write_file" as const,
              path: "must-not-change.txt",
              content: "forbidden",
            }),
            humanStdout: null,
            payload,
          }),
        },
      ];

      const exitCode = await runCommandLine(
        ["--json", "hostile-adapter"],
        createRuntime({ fileSystem, output }),
        hostileAdapter,
        schemaRegistry,
      );

      expect(exitCode).toBe(2);
      expect(wasAccessed()).toBe(false);
      expect(validationRequests).toHaveLength(1);
      expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
      expect(JSON.parse(output.structured_.join(""))).toMatchObject({
        reasonCode: "runtime.internal_failure",
      });
    },
  );

  it("prepares adapter output before applying effects and publishing", async () => {
    const events: string[] = [];
    const output = recordingOutput();
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const productionRegistry = createSchemaRegistry();
    const schemaRegistry = trackingSchemaRegistry(productionRegistry, () => {
      events.push("validate");
    });
    const ordered = [
      {
        path: ["ordered-adapter"],
        summary: "Return a valid adapter payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("trail.ok", {
            evidence: [{ kind: "event" as const, ref: ".brain/events.jsonl" }],
          }),
          plan: planOf({
            kind: "write_file" as const,
            path: ".brain/changed.json",
            content: "written",
          }),
          humanStdout: null,
          payload: structuredClone(adapterMessage),
        }),
      },
    ];

    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      async replaceFile(stagedPath, targetPath) {
        await storage.durableFileSystem.replaceFile(stagedPath, targetPath);
        if (targetPath === ".brain/changed.json") events.push("effect");
      },
    };

    const exitCode = await runCommandLine(
      ["--json", "ordered-adapter"],
      createRuntime({
        clock: fixedClock("2026-08-09T00:00:00.000Z"),
        ids: sequentialIds("transaction"),
        fileSystem: storage.fileSystem,
        durableFileSystem,
        digests: storage.digests,
        output: {
          structured(text) {
            events.push("output");
            output.structured(text);
          },
          human(text) {
            output.human(text);
          },
        },
      }),
      ordered,
      schemaRegistry,
    );

    expect(exitCode).toBe(0);
    expect(events).toEqual(["validate", "effect", "output"]);
    expect(storage.snapshot().files[".brain/changed.json"]).toBe("written");
  });

  it("fails closed when a non-result command has no payload", async () => {
    const output = recordingOutput();
    const fileSystem = memoryFileSystem();
    const absent = [
      {
        path: ["absent"],
        summary: "Return no payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("trail.ok", {
            evidence: [{ kind: "event", ref: ".brain/events.jsonl" }],
          }),
          plan: planOf({
            kind: "write_file" as const,
            path: "must-not-change.txt",
            content: "forbidden",
          }),
          humanStdout: null,
          payload: undefined,
        }),
      },
    ];
    expect(
      await runCommandLine(
        ["--json", "absent"],
        createRuntime({ fileSystem, output }),
        absent,
      ),
    ).toBe(2);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
    expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
  });

  it("fails closed when a non-result payload cannot encode as JSON", async () => {
    const output = recordingOutput();
    const unencodable = [
      {
        path: ["unencodable"],
        summary: "Return an unencodable payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: null,
          payload: () => undefined,
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "unencodable"],
        createRuntime({ output }),
        unencodable,
      ),
    ).toBe(2);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
  });

  it("rejects unsafe strings in a non-result JSON payload", async () => {
    const output = recordingOutput();
    const unsafePayload = [
      {
        path: ["unsafe-payload"],
        summary: "Return an unsafe payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        prerequisite: "none" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: null,
          payload: { path: "/home/customer/private.txt" },
        }),
      },
    ];

    expect(
      await runCommandLine(
        ["--json", "unsafe-payload"],
        createRuntime({ output }),
        unsafePayload,
      ),
    ).toBe(2);
    expect(output.structured_.join("")).not.toContain("/home/customer");
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
  });
});
