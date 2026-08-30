import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import type { AdapterMessageV1_1, PhaseHandoffV1_1 } from "@kratos/contracts";
import {
  relaySelectedPhase as relayThroughAdapter,
  type HostModelCatalog,
} from "@kratos/adapters";
import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";
import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

type PackageHost = "claude-code" | "codex";

interface PackagedPhaseRelay {
  readonly host: PackageHost;
  relaySelectedPhase(input: {
    readonly root: string;
    readonly modelRouting?: HostModelCatalog;
    readonly messageId: string;
    readonly correlationId: string;
    readonly sessionId: string;
    readonly occurredAt: string;
    readonly spawnRuntime: (
      executable: string,
      args: readonly string[],
      options: { readonly input?: string },
    ) => {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    readonly launcher: {
      readonly exactSelection: {
        readonly model: boolean;
        readonly effort: boolean;
      };
      launch(request: {
        readonly phase: string;
        readonly role: string;
        readonly model: string;
        readonly effort: string;
      }): Promise<{
        readonly payload: { readonly ref: string; readonly sha256: string };
        readonly observedIdentity: {
          readonly model: string | null;
          readonly effort: string | null;
        };
      }>;
    };
  }): Promise<
    | {
        readonly kind: "recorded";
        readonly rendering: {
          readonly stdout: string;
          readonly stderr: string;
          readonly exitCode: number;
        };
      }
    | { readonly kind: "runtime-refused" }
    | {
        readonly kind: "exact-selection-unsupported";
        readonly phaseExecuted: false;
      }
  >;
}

function handoff(host: "claude" | "codex"): PhaseHandoffV1_1 {
  return {
    contractVersion: "1.1.0",
    hostContract: "1.1.0",
    feature: "relay-feature",
    runId: "run-01",
    revision: 7,
    phase: "review",
    host,
    assignment: {
      phase: "review",
      role: "judge",
      model: "judge-canonical",
      effort: "high",
    },
    assignmentDigest: "a".repeat(64),
    objectiveDigest: "b".repeat(64),
    status: "active",
    gateOutcome: "pass",
    blockers: [],
    openGaps: 0,
    nextAction: "Complete the selected phase.",
  };
}

async function packagedRelay(host: PackageHost): Promise<PackagedPhaseRelay> {
  return (await import(
    pathToFileURL(
      join(hostPackage(host), "skills/kratos/scripts/phase-agent-relay.mjs"),
    ).href
  )) as PackagedPhaseRelay;
}

beforeAll(buildPlugin);

describe("shared phase-agent relay", () => {
  it("starts the exact lifecycle before launch and records afterward", async () => {
    const order: string[] = [];
    const lifecycles: unknown[] = [];

    const result = await relayThroughAdapter("codex", {
      modelRouting: codexCatalog(),
      messageId: "phase-result-00",
      correlationId: "phase-start-00",
      sessionId: "trusted-session-00",
      occurredAt: "2026-08-30T12:00:00.000Z",
      runtime: {
        handoff: () => {
          order.push("handoff");
          return Promise.resolve({ kind: "ready", handoff: handoff("codex") });
        },
        start: (lifecycle) => {
          order.push("start");
          lifecycles.push(lifecycle);
          return Promise.resolve({ stdout: "{}\n", stderr: "", exitCode: 0 });
        },
        record: () => {
          order.push("record");
          return Promise.resolve({ stdout: "{}\n", stderr: "", exitCode: 0 });
        },
      },
      launcher: {
        exactSelection: { model: true, effort: true },
        launch: () => {
          order.push("launch");
          return Promise.resolve({
            payload: { ref: ".brain/reply.md", sha256: "c".repeat(64) },
            observedIdentity: { model: null, effort: null },
          });
        },
      },
    });

    expect(order).toEqual(["handoff", "start", "launch", "record"]);
    expect(lifecycles).toEqual([
      {
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        kind: "phase.start",
        sessionId: "trusted-session-00",
        correlationId: "phase-start-00",
        occurredAt: "2026-08-30T12:00:00.000Z",
        assignmentDigest: "a".repeat(64),
      },
    ]);
    expect(result.kind).toBe("recorded");
  });

  it("returns the runtime start refusal without launch or record", async () => {
    const calls: string[] = [];
    const refusal = {
      stdout: '{"reasonCode":"metrics.phase_assignment_conflict"}\n',
      stderr: "",
      exitCode: 3,
    };
    const result = await relayThroughAdapter("codex", {
      modelRouting: codexCatalog(),
      messageId: "phase-result-refused",
      correlationId: "phase-start-refused",
      sessionId: "trusted-session-refused",
      occurredAt: "2026-08-30T12:00:00.000Z",
      runtime: {
        handoff: () =>
          Promise.resolve({ kind: "ready", handoff: handoff("codex") }),
        start: () => {
          calls.push("start");
          return Promise.resolve(refusal);
        },
        record: () => {
          calls.push("record");
          throw new Error("record must not run");
        },
      },
      launcher: {
        exactSelection: { model: true, effort: true },
        launch: () => {
          calls.push("launch");
          throw new Error("launch must not run");
        },
      },
    });

    expect(result).toEqual({ kind: "runtime-refused", rendering: refusal });
    expect(calls).toEqual(["start"]);
  });

  it("refuses missing trusted session identity before start or launch", async () => {
    const calls: string[] = [];
    await expect(
      relayThroughAdapter("codex", {
        modelRouting: codexCatalog(),
        messageId: "phase-result-missing-session",
        correlationId: "phase-start-missing-session",
        sessionId: "",
        occurredAt: "2026-08-30T12:00:00.000Z",
        runtime: {
          handoff: () => {
            calls.push("handoff");
            return Promise.resolve({
              kind: "ready",
              handoff: handoff("codex"),
            });
          },
          start: () => {
            calls.push("start");
            return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
          },
          record: () => {
            calls.push("record");
            return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
          },
        },
        launcher: {
          exactSelection: { model: true, effort: true },
          launch: () => {
            calls.push("launch");
            throw new Error("launch must not run");
          },
        },
      }),
    ).rejects.toThrow("Trusted phase lifecycle input is unavailable");
    expect(calls).toEqual(["handoff"]);
  });
});

describe("packaged phase-agent relay", () => {
  it.each([
    ["codex", "codex", codexCatalog()],
    ["claude-code", "claude", claudeCatalog()],
  ] as const)(
    "binds the %s launch and agent record request to the runtime handoff",
    async (packageHost, configurationHost, modelRouting) => {
      const relay = await packagedRelay(packageHost);
      const temporary = await mkdtemp(join(tmpdir(), "kratos-phase-relay-"));
      const project = join(temporary, "project");
      await mkdir(join(project, ".brain"), { recursive: true });
      const launches: unknown[] = [];
      const order: string[] = [];
      const runtimeCalls: {
        readonly executable: string;
        readonly args: readonly string[];
        readonly input?: string;
      }[] = [];
      const result = await relay.relaySelectedPhase({
        root: project,
        modelRouting,
        messageId: "phase-result-01",
        correlationId: "phase-result-01",
        sessionId: "trusted-session-01",
        occurredAt: "2026-08-30T12:00:00.000Z",
        spawnRuntime: (executable, args, options) => {
          order.push(
            args.includes("handoff")
              ? "handoff"
              : args.includes("hook")
                ? "start"
                : "record",
          );
          runtimeCalls.push({ executable, args, ...options });
          return runtimeCalls.length === 1
            ? {
                stdout: `${JSON.stringify(handoff(configurationHost))}\n`,
                stderr: "",
                status: 0,
              }
            : {
                stdout: '{"reasonCode":"trail.ok"}\n',
                stderr: "",
                status: 0,
              };
        },
        launcher: {
          exactSelection: { model: true, effort: true },
          launch: (request) => {
            order.push("launch");
            launches.push(request);
            return Promise.resolve({
              payload: {
                ref: ".brain/agent-replies/review.md",
                sha256: "c".repeat(64),
              },
              observedIdentity: {
                model: "judge-canonical",
                effort: "high",
              },
            });
          },
        },
      });

      expect(relay.host).toBe(packageHost);
      expect(order).toEqual(["handoff", "start", "launch", "record"]);
      expect(launches).toEqual([
        {
          phase: "review",
          role: "judge",
          model: "judge-canonical",
          effort: "high",
        },
      ]);
      expect(runtimeCalls).toHaveLength(3);
      expect(runtimeCalls[0]?.executable).toBe(process.execPath);
      expect(runtimeCalls[0]?.args.slice(1)).toEqual([
        "--json",
        "handoff",
        "--root",
        project,
      ]);
      expect(runtimeCalls[0]?.args[0]).toMatch(/runtime\/kratos\.mjs$/u);
      expect(runtimeCalls[1]?.args.slice(1)).toEqual([
        "--json",
        "hook",
        "--host",
        packageHost,
        "--root",
        project,
      ]);
      const startMessage = JSON.parse(runtimeCalls[1]?.input ?? "null") as {
        readonly correlationId: string;
        readonly occurredAt: string;
        readonly payload: {
          readonly host: string;
          readonly hook: string;
          readonly phase: string;
          readonly artifact: { readonly ref: string; readonly sha256: string };
        };
      };
      expect(startMessage).toMatchObject({
        correlationId: "phase-result-01",
        occurredAt: "2026-08-30T12:00:00.000Z",
        kind: "hook",
        payload: { host: packageHost, hook: "phase.start", phase: "before" },
      });
      expect(
        ajvSchemaRegistry().validate({
          id: "host.operation-message",
          version: "1.0.0",
          value: startMessage,
          structuralReasonCode: "trail.output_invalido",
        }).kind,
      ).toBe("valid");
      const lifecycleContent = await readFile(
        join(project, startMessage.payload.artifact.ref),
        "utf8",
      );
      expect(startMessage.payload.artifact.sha256).toBe(
        createHash("sha256").update(lifecycleContent).digest("hex"),
      );
      expect(JSON.parse(lifecycleContent)).toEqual({
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        kind: "phase.start",
        sessionId: "trusted-session-01",
        correlationId: "phase-result-01",
        occurredAt: "2026-08-30T12:00:00.000Z",
        assignmentDigest: "a".repeat(64),
      });
      expect(runtimeCalls[2]?.args.slice(1)).toEqual([
        "--json",
        "agent",
        "record",
        ".brain/agent-replies/review.md",
        "--correlation-id",
        "phase-result-01",
        "--root",
        project,
      ]);
      expect(
        JSON.parse(runtimeCalls[2]?.input ?? "null") as AdapterMessageV1_1,
      ).toMatchObject({
        messageType: "request",
        host: configurationHost,
        operation: "sdd.agent.record:phase-result-01",
        payloadContract: "host.agent-output@1.0.0",
        payload: {
          ref: ".brain/agent-replies/review.md",
          sha256: "c".repeat(64),
        },
        phaseExecution: {
          assignmentDigest: "a".repeat(64),
          model: "judge-canonical",
          effort: "high",
        },
      });
      expect(result).toEqual({
        kind: "recorded",
        rendering: {
          stdout: '{"reasonCode":"trail.ok"}\n',
          stderr: "",
          exitCode: 0,
        },
      });
      await rm(temporary, { recursive: true, force: true });
    },
  );

  it.each([
    ["codex", "codex", codexCatalog()],
    ["claude-code", "claude", claudeCatalog()],
  ] as const)(
    "relays a %s phase-start refusal without launching or recording",
    async (packageHost, configurationHost, modelRouting) => {
      const relay = await packagedRelay(packageHost);
      const temporary = await mkdtemp(join(tmpdir(), "kratos-phase-refusal-"));
      const project = join(temporary, "project");
      await mkdir(join(project, ".brain"), { recursive: true });
      let launches = 0;
      let runtimeCalls = 0;
      try {
        const result = await relay.relaySelectedPhase({
          root: project,
          modelRouting,
          messageId: "phase-result-start-refused",
          correlationId: "phase-start-refused",
          sessionId: "trusted-session-refused",
          occurredAt: "2026-08-30T12:00:00.000Z",
          spawnRuntime: (_executable, args) => {
            runtimeCalls += 1;
            return args.includes("handoff")
              ? {
                  status: 0,
                  stdout: `${JSON.stringify(handoff(configurationHost))}\n`,
                  stderr: "",
                }
              : {
                  status: 3,
                  stdout:
                    '{"reasonCode":"metrics.phase_assignment_conflict"}\n',
                  stderr: "",
                };
          },
          launcher: {
            exactSelection: { model: true, effort: true },
            launch: () => {
              launches += 1;
              throw new Error("phase work must not begin");
            },
          },
        });

        expect(result).toEqual({
          kind: "runtime-refused",
          rendering: {
            stdout: '{"reasonCode":"metrics.phase_assignment_conflict"}\n',
            stderr: "",
            exitCode: 3,
          },
        });
        expect(runtimeCalls).toBe(2);
        expect(launches).toBe(0);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );

  it("emits byte-equivalent lifecycle artifacts and equivalent operation envelopes", async () => {
    const captures: {
      readonly lifecycle: string;
      readonly message: Record<string, unknown>;
    }[] = [];
    for (const [packageHost, configurationHost, modelRouting] of [
      ["codex", "codex", codexCatalog()],
      ["claude-code", "claude", claudeCatalog()],
    ] as const) {
      const relay = await packagedRelay(packageHost);
      const temporary = await mkdtemp(join(tmpdir(), "kratos-phase-parity-"));
      const project = join(temporary, "project");
      await mkdir(join(project, ".brain"), { recursive: true });
      const startMessages: Record<string, unknown>[] = [];
      try {
        await relay.relaySelectedPhase({
          root: project,
          modelRouting,
          messageId: "phase-result-parity",
          correlationId: "phase-start-parity",
          sessionId: "trusted-session-parity",
          occurredAt: "2026-08-30T12:00:00.000Z",
          spawnRuntime: (_executable, args, options) => {
            if (args.includes("handoff")) {
              return {
                status: 0,
                stdout: `${JSON.stringify(handoff(configurationHost))}\n`,
                stderr: "",
              };
            }
            if (args.includes("hook")) {
              startMessages.push(
                JSON.parse(options.input ?? "null") as Record<string, unknown>,
              );
            }
            return {
              status: 0,
              stdout: '{"reasonCode":"trail.ok"}\n',
              stderr: "",
            };
          },
          launcher: {
            exactSelection: { model: true, effort: true },
            launch: () =>
              Promise.resolve({
                payload: {
                  ref: ".brain/agent-replies/review.md",
                  sha256: "c".repeat(64),
                },
                observedIdentity: { model: null, effort: null },
              }),
          },
        });
        const startMessage = startMessages[0];
        if (startMessage === undefined)
          throw new Error("phase start was not sent");
        const payload = startMessage.payload as {
          artifact: { ref: string };
          host: string;
        };
        captures.push({
          lifecycle: await readFile(
            join(project, payload.artifact.ref),
            "utf8",
          ),
          message: {
            ...startMessage,
            payload: { ...payload, host: "equivalent-host" },
          },
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }

    expect(captures[0]?.lifecycle).toBe(captures[1]?.lifecycle);
    expect(captures[0]?.message).toEqual(captures[1]?.message);
  });

  it.each([
    ["codex", "model", "codex", codexCatalog(), false, true],
    ["codex", "effort", "codex", codexCatalog(), true, false],
    ["claude-code", "model", "claude", claudeCatalog(), false, true],
    ["claude-code", "effort", "claude", claudeCatalog(), true, false],
  ] as const)(
    "refuses %s before phase work when exact %s selection is unavailable",
    async (
      packageHost,
      _selector,
      configurationHost,
      modelRouting,
      exactModel,
      exactEffort,
    ) => {
      const relay = await packagedRelay(packageHost);
      let launches = 0;
      let runtimeCalls = 0;
      const result = await relay.relaySelectedPhase({
        root: "/project",
        modelRouting,
        messageId: "phase-result-02",
        correlationId: "phase-result-02",
        sessionId: "trusted-session-02",
        occurredAt: "2026-08-30T12:00:00.000Z",
        spawnRuntime: () => {
          runtimeCalls += 1;
          return {
            status: 0,
            stdout: `${JSON.stringify(handoff(configurationHost))}\n`,
            stderr: "",
          };
        },
        launcher: {
          exactSelection: { model: exactModel, effort: exactEffort },
          launch: () => {
            launches += 1;
            throw new Error("phase work must not begin");
          },
        },
      });

      expect(result).toEqual({
        kind: "exact-selection-unsupported",
        phaseExecuted: false,
      });
      expect(launches).toBe(0);
      expect(runtimeCalls).toBe(1);
    },
  );

  it.each([
    ["codex", codexCatalog()],
    ["claude-code", claudeCatalog()],
  ] as const)(
    "relays a %s runtime handoff refusal without phase work",
    async (packageHost, modelRouting) => {
      const relay = await packagedRelay(packageHost);
      let launches = 0;
      const result = await relay.relaySelectedPhase({
        root: "/project",
        modelRouting,
        messageId: "phase-result-03",
        correlationId: "phase-result-03",
        sessionId: "trusted-session-03",
        occurredAt: "2026-08-30T12:00:00.000Z",
        spawnRuntime: () => ({
          status: 3,
          stdout: '{"reasonCode":"model.role_missing"}\n',
          stderr: "",
        }),
        launcher: {
          exactSelection: { model: true, effort: true },
          launch: () => {
            launches += 1;
            throw new Error("phase work must not begin");
          },
        },
      });

      expect(result).toEqual({
        kind: "runtime-refused",
        rendering: {
          stdout: '{"reasonCode":"model.role_missing"}\n',
          stderr: "",
          exitCode: 3,
        },
      });
      expect(launches).toBe(0);
    },
  );
});
