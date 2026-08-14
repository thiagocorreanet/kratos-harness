import { YODA_VERSION } from "@mestre-yoda/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
} from "@mestre-yoda/runtime/domain/cli";
import { USAGE_WHY } from "@mestre-yoda/runtime/domain/result";

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  return parsed.kind === "result"
    ? { failure: parsed.result, decision: null }
    : { failure: null, decision: dispatch(parsed.invocation) };
}

describe("implemented commands", () => {
  it("registers exactly the commands that work today", () => {
    expect(DEFAULT_REGISTRY.map((spec) => spec.path.join(" ")).sort()).toEqual([
      "handshake",
      "help",
      "init",
      "version",
    ]);
  });

  it("prints usage for an empty argument vector", () => {
    expect(invoke([]).decision?.humanStdout).toContain("Usage: yoda");
  });

  it.each([["--help"], ["-h"], ["help"]])("answers %s with usage", (token) => {
    expect(invoke([token]).decision?.humanStdout).toContain("Commands:");
  });

  it.each([["--version"], ["version"]])(
    "answers %s with exactly the version",
    (token) => {
      expect(invoke([token]).decision?.humanStdout).toBe(`${YODA_VERSION}\n`);
    },
  );

  it("carries the version in the summary for JSON mode", () => {
    expect(invoke(["--json", "--version"]).decision?.result.summary).toContain(
      YODA_VERSION,
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
    expect(invoke(["start"]).failure?.why).toEqual([USAGE_WHY.unknownCommand]);
  });

  it("checks a pinned version before resolving the command", () => {
    expect(invoke(["--expect", "9.9.9", "start"]).failure?.reasonCode).toBe(
      "contract.plugin_version_unsupported",
    );
  });

  it("continues past a matching pin", () => {
    expect(invoke(["--expect", YODA_VERSION, "version"]).failure).toBeNull();
  });

  it("keeps help available with a matching pin", () => {
    expect(
      invoke(["--expect", YODA_VERSION, "--help"]).decision?.humanStdout,
    ).toContain("Usage: yoda");
  });
});
