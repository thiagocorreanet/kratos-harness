import { describe, expect, it } from "vitest";

import {
  parseArguments,
  resolveCommand,
  type CommandRegistry,
  type CommandSpec,
} from "@kratos/runtime/domain/cli";
import { planOf } from "@kratos/runtime/domain/effects";
import { resultFor, USAGE_WHY } from "@kratos/runtime/domain/result";

function spec(overrides: Partial<CommandSpec>): CommandSpec {
  return {
    path: ["ac", "check"],
    summary: "Check every stored acceptance criterion.",
    flags: [
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
      {
        name: "--force",
        kind: "boolean",
        summary: "Overwrite existing rules.",
      },
    ],
    positionals: { min: 0, max: 1 },
    jsonContract: "result@1.0.0",
    prerequisite: "none",
    handler: () => ({
      result: resultFor("runtime.orientation_ok"),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    }),
    ...overrides,
  };
}

const registry: CommandRegistry = [spec({}), spec({ path: ["ac"] })];

describe("command resolution", () => {
  it("resolves the separated spelling", () => {
    expect(
      resolveCommand(["ac", "check", "x"], registry)?.command.path,
    ).toEqual(["ac", "check"]);
  });

  it("resolves the dotted spelling to the same command", () => {
    expect(resolveCommand(["ac.check"], registry)?.command.path).toEqual([
      "ac",
      "check",
    ]);
  });

  it("prefers the longest matching path", () => {
    expect(resolveCommand(["ac"], registry)?.command.path).toEqual(["ac"]);
    expect(resolveCommand(["ac", "check"], registry)?.rest).toEqual([]);
  });

  it("returns nothing for an unregistered name", () => {
    expect(resolveCommand(["start"], registry)).toBeNull();
  });
});

describe("argument parsing", () => {
  it("reads a value flag and a boolean flag", () => {
    const parsed = parseArguments(spec({}), ["--root", ".", "--force"]);
    expect(parsed.failure).toBeNull();
    expect(parsed.flags.get("--root")).toBe(".");
    expect(parsed.flags.get("--force")).toBe(true);
  });

  it("collects positionals", () => {
    expect(parseArguments(spec({}), ["target"]).positionals).toEqual([
      "target",
    ]);
  });

  it.each([
    [["--unknown"], USAGE_WHY.unknownFlag],
    [["-x"], USAGE_WHY.unknownFlag],
    [["--root"], USAGE_WHY.missingValue],
    [["--root", "--force"], USAGE_WHY.missingValue],
    [["one", "two"], USAGE_WHY.arity],
  ])("refuses %o", (tokens, why) => {
    expect(parseArguments(spec({}), tokens).failure?.why).toEqual([why]);
  });

  it("requires the minimum number of positionals", () => {
    expect(
      parseArguments(spec({ positionals: { min: 1, max: 1 } }), []).failure
        ?.why,
    ).toEqual([USAGE_WHY.arity]);
  });
});
