import { describe, expect, it } from "vitest";

import { GLOBAL_FLAGS, parseGlobals } from "@kratos/runtime/domain/cli";
import { USAGE_WHY } from "@kratos/runtime/domain/result";

describe("global flag parsing", () => {
  it("extracts --expect from any position", () => {
    for (const argv of [
      ["--expect", "1.2.3", "version"],
      ["version", "--expect", "1.2.3"],
    ]) {
      const parsed = parseGlobals(argv);
      expect(parsed.failure).toBeNull();
      expect(parsed.globals.expect).toBe("1.2.3");
      expect(parsed.rest).toEqual(["version"]);
    }
  });

  it("extracts --json from any position", () => {
    expect(parseGlobals(["handshake", "--json"]).globals.json).toBe(true);
    expect(parseGlobals(["--json", "handshake"]).globals.json).toBe(true);
    expect(parseGlobals(["handshake"]).globals.json).toBe(false);
  });

  it.each([["--help"], ["-h"]])(
    "normalizes %s into the help command",
    (flag) => {
      expect(parseGlobals([flag]).globals.orientation).toBe("help");
    },
  );

  it("normalizes --version into the version command", () => {
    expect(parseGlobals(["--version"]).globals.orientation).toBe("version");
  });

  it("refuses --expect without a value", () => {
    expect(parseGlobals(["--expect"]).failure?.why).toEqual([
      USAGE_WHY.missingValue,
    ]);
    expect(parseGlobals(["--expect", "--json"]).failure?.why).toEqual([
      USAGE_WHY.missingValue,
    ]);
  });

  it("preserves JSON mode when global parsing fails", () => {
    expect(parseGlobals(["--json", "--expect"]).globals.json).toBe(true);
    expect(parseGlobals(["--expect", "--json"]).globals.json).toBe(true);
  });

  it("accepts an identical repeat and refuses a conflicting one", () => {
    expect(
      parseGlobals(["--expect", "1.2.3", "--expect", "1.2.3"]).failure,
    ).toBeNull();
    expect(
      parseGlobals(["--expect", "1.2.3", "--expect", "9.9.9"]).failure?.why,
    ).toEqual([USAGE_WHY.conflictingFlag]);
  });

  it("recognizes every flag the help text advertises", () => {
    for (const flag of GLOBAL_FLAGS) {
      const argv = flag.kind === "value" ? [flag.name, "1.2.3"] : [flag.name];
      expect(parseGlobals(argv).rest, flag.name).toEqual([]);
    }
  });

  it("leaves an unknown flag for the command parser", () => {
    expect(parseGlobals(["version", "--unknown"]).rest).toEqual([
      "version",
      "--unknown",
    ]);
  });
});
