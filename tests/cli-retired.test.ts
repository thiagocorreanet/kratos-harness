import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  RETIRED_COMMANDS,
  renderHelp,
  retiredWhy,
} from "@kratos/runtime/domain/cli";
import { USAGE_WHY } from "@kratos/runtime/domain/result";

// Covers parity rows CLI-RETIRED-AUTO, CLI-RETIRED-CODE, CLI-RETIRED-EVAL,
// CLI-RETIRED-NEXT, CLI-RETIRED-PRD, CLI-RETIRED-REVIEW, CLI-RETIRED-RUN, and
// CLI-RETIRED-SPEC (verification cases UNIT-CLI-RETIRED-*).

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  return parsed.kind === "result"
    ? { failure: parsed.result, decision: null }
    : { failure: null, decision: dispatch(parsed.invocation) };
}

const names = RETIRED_COMMANDS.map((name) => [name] as const);

describe("retired phase commands", () => {
  it.each(names)("refuses %s without executing it", (name) => {
    const { decision, failure } = invoke([name]);
    expect(failure).toBeNull();
    expect(decision?.result.reasonCode).toBe("trail.uso");
    expect(decision?.result.status).toBe("failure");
    expect(decision?.result.exitCode).toBe(2);
  });

  it.each(names)("never mutates state for %s", (name) => {
    const { decision } = invoke([name]);
    // A retired name that planned an effect would be the manual phase control
    // it exists to refuse.
    expect(decision?.plan.effects).toEqual([]);
    expect(decision?.result.stateChanged).toBe(false);
    expect(decision?.rootMode).toBeUndefined();
  });

  it.each(names)("never reports %s as a successful active command", (name) => {
    const { decision } = invoke([name]);
    expect(decision?.result.exitCode).not.toBe(0);
    expect(decision?.humanStdout).toBeNull();
    expect(decision?.payload).toBeNull();
  });

  it.each(names)("points %s at the agent-driven trail", (name) => {
    const { decision } = invoke([name]);
    expect(decision?.result.why).toEqual(retiredWhy(name));
    expect(decision?.result.why[0]).toContain(`\`${name}\``);
    expect(decision?.result.why[1]).toContain("selects each phase");
    // The generic answer for a name nobody registered says nothing about where
    // the capability went, which is exactly what these rows forbid.
    expect(decision?.result.why).not.toContain(USAGE_WHY.unknownCommand);
  });

  it.each(names)("recognizes %s beside every global flag", (name) => {
    for (const argv of [
      ["--json", name],
      [name, "--json"],
      ["--expect", "0.3.0", name],
      [name, "--expect", "0.3.0"],
    ]) {
      const { decision, failure } = invoke(argv);
      expect(failure, argv.join(" ")).toBeNull();
      expect(decision?.result.why, argv.join(" ")).toEqual(retiredWhy(name));
    }
  });

  it.each(names)("recognizes %s carrying its legacy operands", (name) => {
    for (const argv of [
      [name, "step-1"],
      [name, "step-1", "step-2", "step-3"],
      [name, "-"],
    ]) {
      const { decision, failure } = invoke(argv);
      expect(failure, argv.join(" ")).toBeNull();
      expect(decision?.result.reasonCode, argv.join(" ")).toBe("trail.uso");
    }
  });

  it("publishes every retired name in help, apart from the workflow", () => {
    const help = renderHelp(DEFAULT_REGISTRY);
    const retiredSection = help.indexOf("Retired commands:");
    expect(retiredSection).toBeGreaterThan(help.indexOf("Commands:"));
    for (const name of RETIRED_COMMANDS) {
      expect(help.indexOf(`  ${name} `)).toBeGreaterThan(retiredSection);
    }
  });

  it("keeps a name nobody retired on the unknown-command answer", () => {
    const { failure, decision } = invoke(["prd-output"]);
    expect(decision).toBeNull();
    expect(failure?.reasonCode).toBe("trail.uso");
    expect(failure?.why).toEqual([USAGE_WHY.unknownCommand]);
  });
});
