import { pathToFileURL } from "node:url";
import { join } from "node:path";

import type { AdapterMessageV1_1, PhaseHandoffV1_2 } from "@kratos/contracts";
import type { HostModelCatalog } from "@kratos/adapters";
import { beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";
import {
  antigravityCatalog,
  claudeCatalog,
  codexCatalog,
} from "./support/model-routing.js";

type PackageHost = "claude-code" | "codex" | "antigravity";

interface PackagedPhaseRelay {
  readonly host: PackageHost;
  relaySelectedPhase(input: {
    readonly root: string;
    readonly modelRouting?: HostModelCatalog;
    readonly messageId: string;
    readonly correlationId: string;
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
        readonly memory: null | {
          readonly ref: ".brain/03-memory/gotchas.md";
          readonly sha256: string;
          readonly lessonIds: readonly string[];
        };
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

function handoff(host: "claude" | "codex" | "antigravity"): PhaseHandoffV1_2 {
  return {
    contractVersion: "1.2.0",
    hostContract: "1.2.0",
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
    memory: {
      ref: ".brain/03-memory/gotchas.md",
      sha256: "d".repeat(64),
      lessonIds: ["e".repeat(64)],
    },
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

describe("packaged phase-agent relay", () => {
  it.each([
    ["codex", "codex", codexCatalog()],
    ["claude-code", "claude", claudeCatalog()],
    ["antigravity", "antigravity", antigravityCatalog()],
  ] as const)(
    "binds the %s launch and agent record request to the runtime handoff",
    async (packageHost, configurationHost, modelRouting) => {
      const relay = await packagedRelay(packageHost);
      const launches: unknown[] = [];
      const runtimeCalls: {
        readonly executable: string;
        readonly args: readonly string[];
        readonly input?: string;
      }[] = [];
      const result = await relay.relaySelectedPhase({
        root: "/project",
        modelRouting,
        messageId: "phase-result-01",
        correlationId: "phase-result-01",
        spawnRuntime: (executable, args, options) => {
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
      expect(launches).toEqual([
        {
          phase: "review",
          role: "judge",
          model: "judge-canonical",
          effort: "high",
          memory: {
            ref: ".brain/03-memory/gotchas.md",
            sha256: "d".repeat(64),
            lessonIds: ["e".repeat(64)],
          },
        },
      ]);
      expect(runtimeCalls).toHaveLength(2);
      expect(runtimeCalls[0]?.executable).toBe(process.execPath);
      expect(runtimeCalls[0]?.args.slice(1)).toEqual([
        "--json",
        "handoff",
        "--root",
        "/project",
      ]);
      expect(runtimeCalls[0]?.args[0]).toMatch(/runtime\/kratos\.mjs$/u);
      expect(runtimeCalls[1]?.args.slice(1)).toEqual([
        "--json",
        "agent",
        "record",
        ".brain/agent-replies/review.md",
        "--correlation-id",
        "phase-result-01",
        "--root",
        "/project",
      ]);
      expect(
        JSON.parse(runtimeCalls[1]?.input ?? "null") as AdapterMessageV1_1,
      ).toMatchObject({
        messageType: "request",
        host: configurationHost,
        operation: "sdd.agent.record:phase-result-01",
        payloadContract: "host.agent-output@1.2.0",
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
    },
  );

  it.each([
    ["codex", "model", "codex", codexCatalog(), false, true],
    ["codex", "effort", "codex", codexCatalog(), true, false],
    ["claude-code", "model", "claude", claudeCatalog(), false, true],
    ["claude-code", "effort", "claude", claudeCatalog(), true, false],
    ["antigravity", "model", "antigravity", antigravityCatalog(), false, true],
    ["antigravity", "effort", "antigravity", antigravityCatalog(), true, false],
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
    ["antigravity", antigravityCatalog()],
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
