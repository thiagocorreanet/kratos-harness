import {
  DEFAULT_REGISTRY,
  dispatch,
  observingCommand,
  parseInvocation,
  type CommandSpec,
  type Invocation,
} from "@kratos/runtime/domain/cli";
import { planOf } from "@kratos/runtime/domain/effects";
import { resultFor } from "@kratos/runtime/domain/result";
import { describe, expect, it } from "vitest";

const probe: CommandSpec = observingCommand(
  "initialization",
  {
    path: ["probe"],
    summary: "Report what the runtime observed.",
    flags: [],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => ({
    result: resultFor("runtime.orientation_ok", {
      summary: `Observed ${String(observation.evidence.rootEntries.length)} entries.`,
    }),
    plan: planOf(),
    humanStdout: `${observation.evidence.rootEntries.join(",")}\n`,
    payload: null,
  }),
);

function invocationWith(observation: Invocation["observation"]): Invocation {
  return {
    command: probe,
    globals: { json: false, expect: null, orientation: null },
    flags: new Map(),
    positionals: [],
    registry: [probe],
    observation,
  };
}

describe("commands that observe before deciding", () => {
  it("declares what it needs rather than reaching for it", () => {
    expect(probe.prerequisite).toBe("initialization");
    // Every other registered command needs nothing observed, which is why the
    // registry could dispatch a pure handler with no facts at all before this.
    const observing = DEFAULT_REGISTRY.filter(
      (command) => command.prerequisite !== "none",
    ).map((command) => command.path.join(" "));

    expect(observing).toEqual([
      "agent record",
      "approve",
      "audit",
      "budgets",
      "continue",
      "dashboard",
      "doctor",
      "done",
      "evidence bundle",
      "evidence record",
      "gaps record",
      "gaps resolve",
      "gaps waive",
      "guard write",
      "gates record",
      "handoff",
      "init",
      "hook",
      "migrate brain",
      "migrate config",
      "migrate memory",
      "migrate rollback",
      "metrics refresh",
      "memory capture",
      "memory curate",
      "memory list",
      "memory promote",
      "memory reinforce",
      "memory merge",
      "memory archive",
      "narrate",
      "objective",
      "profile derive",
      "repair",
      "repair resolve",
      "start",
      "stats",
      "status",
      "scope record",
      "unlock stop-loss",
    ]);
  });

  it("hands the parsed invocation an empty observation", () => {
    // Parsing is pure and reads no filesystem, so it cannot satisfy a
    // prerequisite. The composition root fills this in before dispatch.
    const parsed = parseInvocation(["version"], DEFAULT_REGISTRY);

    expect(
      parsed.kind === "invocation" && parsed.invocation.observation,
    ).toEqual({ kind: "none" });
  });

  it("gives the handler the observation the composition collected", () => {
    const decision = dispatch(
      invocationWith({
        kind: "initialization",
        configExpected: { kind: "missing" },
        evidence: { rootEntries: ["package.json", "README.md"] },
        answers: {
          kind: "invalid",
          reasonCode: "contract.host_version_invalid",
        },
        destinations: [],
        resolution: null,
      }),
    );

    expect(decision.result.summary).toBe("Observed 2 entries.");
  });

  it("fails internally rather than deciding without the facts it declared", () => {
    // Reachable only by constructing an invocation directly, which is exactly
    // why it is tested: a registry that grows a second observing command must
    // not discover this branch in production.
    const decision = dispatch(invocationWith({ kind: "none" }));

    expect(decision.result.reasonCode).toBe("runtime.internal_failure");
    expect(decision.plan.effects).toEqual([]);
  });
});
