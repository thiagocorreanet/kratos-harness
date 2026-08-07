import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

function invoke(args: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runCli(
    args,
    (text) => stdout.push(text),
    (text) => stderr.push(text),
  );

  return {
    exitCode,
    stderr: stderr.join(""),
    stdout: stdout.join(""),
  };
}

describe("runCli", () => {
  it.each([{ args: [] }, { args: ["--help"] }])(
    "prints help for $args",
    ({ args }) => {
      expect(invoke(args)).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: "Usage: yoda [--help | --version]\n",
      });
    },
  );

  it("prints the development version", () => {
    expect(invoke(["--version"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "0.0.0-development\n",
    });
  });

  it("rejects an unknown argument", () => {
    expect(invoke(["start"])).toEqual({
      exitCode: 2,
      stderr: "Unknown argument: start. Run yoda --help for usage.\n",
      stdout: "",
    });
  });
});
