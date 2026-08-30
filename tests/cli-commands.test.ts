import { KRATOS_VERSION } from "@kratos/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
} from "@kratos/runtime/domain/cli";
import { renderMemoryApplyCommand } from "@kratos/runtime/domain/cli/memory";
import { USAGE_WHY } from "@kratos/runtime/domain/result";

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  return parsed.kind === "result"
    ? { failure: parsed.result, decision: null }
    : { failure: null, decision: dispatch(parsed.invocation) };
}

describe("implemented commands", () => {
  it("quotes memory apply paths and preserves an explicit root", () => {
    const parsed = parseInvocation(
      [
        "memory",
        "promote",
        "proposal 'x'; $(bad).json",
        "--root",
        "a root'$;$(bad)",
      ],
      DEFAULT_REGISTRY,
    );
    if (parsed.kind !== "invocation") throw new Error("expected invocation");
    expect(
      renderMemoryApplyCommand(
        parsed.invocation,
        "a".repeat(64),
        "b".repeat(64),
        "2026-08-29T00:00:00Z",
      ),
    ).toBe(
      String.raw`kratos memory promote --root 'a root'\''$;$(bad)' 'proposal '\''x'\''; $(bad).json' --yes --proposal-digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --plan-digest bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --plan-time 2026-08-29T00:00:00Z`,
    );
  });
  it("registers exactly the commands that work today", () => {
    expect(
      DEFAULT_REGISTRY.filter((spec) => spec.retired !== true)
        .map((spec) => spec.path.join(" "))
        .sort(),
    ).toEqual([
      "adapters",
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
      "explain",
      "gaps record",
      "gaps resolve",
      "gaps waive",
      "gates record",
      "guard write",
      "handoff",
      "handshake",
      "help",
      "hook",
      "init",
      "memory archive",
      "memory capture",
      "memory list",
      "memory merge",
      "memory promote",
      "migrate brain",
      "migrate config",
      "migrate rollback",
      "objective",
      "repair",
      "scope record",
      "start",
      "stats",
      "status",
      "unlock stop-loss",
      "version",
    ]);
  });

  it("registers every retired phase name apart from those", () => {
    expect(
      DEFAULT_REGISTRY.filter((spec) => spec.retired === true)
        .map((spec) => spec.path.join(" "))
        .sort(),
    ).toEqual(["auto", "code", "eval", "next", "prd", "review", "run", "spec"]);
  });

  it("prints usage for an empty argument vector", () => {
    expect(invoke([]).decision?.humanStdout).toContain("Usage: kratos");
  });

  it.each([["--help"], ["-h"], ["help"]])("answers %s with usage", (token) => {
    expect(invoke([token]).decision?.humanStdout).toContain("Commands:");
  });

  it.each([["--version"], ["version"]])(
    "answers %s with exactly the version",
    (token) => {
      expect(invoke([token]).decision?.humanStdout).toBe(`${KRATOS_VERSION}\n`);
    },
  );

  it("carries the version in the summary for JSON mode", () => {
    expect(invoke(["--json", "--version"]).decision?.result.summary).toContain(
      KRATOS_VERSION,
    );
  });

  it("answers the handshake with an adapter message", () => {
    const decision = invoke(["handshake"]).decision;
    expect(decision?.payload).toMatchObject({
      messageType: "response",
      operation: "handshake",
    });
    expect(JSON.parse(decision?.humanStdout ?? "")).toEqual(decision?.payload);
  });

  it("refuses an unregistered command", () => {
    expect(invoke(["missing"]).failure?.why).toEqual([
      USAGE_WHY.unknownCommand,
    ]);
  });

  it("checks a pinned version before resolving the command", () => {
    expect(invoke(["--expect", "9.9.9", "start"]).failure?.reasonCode).toBe(
      "contract.plugin_version_unsupported",
    );
  });

  it("continues past a matching pin", () => {
    expect(invoke(["--expect", KRATOS_VERSION, "version"]).failure).toBeNull();
  });

  it("keeps help available with a matching pin", () => {
    expect(
      invoke(["--expect", KRATOS_VERSION, "--help"]).decision?.humanStdout,
    ).toContain("Usage: kratos");
  });
});
