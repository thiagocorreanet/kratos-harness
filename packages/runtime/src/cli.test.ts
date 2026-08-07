import { YODA_VERSION } from "@mestre-yoda/contracts";
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
        stdout:
          "Usage: yoda [--expect <version>] [--help | --version | handshake]\n",
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
      stderr: "Unrecognized arguments. Run yoda --help for usage.\n",
      stdout: "",
    });
  });

  it.each([
    [["/home/someone/private/secret-token"], "secret-token"],
    [["--version", "--expect", "sekrit-value-1.2.3"], "sekrit-value"],
    [["--expect", "9.9.9", "unknown-subcommand"], "unknown-subcommand"],
  ])("never echoes caller-supplied text from %o", (args, secret) => {
    // A misordered --expect lands here, so this path must not become the way a
    // supplied value or an absolute path reaches public output.
    const result = invoke(args);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain(secret);
  });

  it("answers the handshake with a contract report", () => {
    const result = invoke(["handshake"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      messageType: "response",
      operation: "handshake",
      correlationId: "cli",
    });
  });

  it("continues past a matching --expect", () => {
    expect(invoke(["--expect", YODA_VERSION, "--version"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${YODA_VERSION}\n`,
    });
  });

  it("treats a bare matching --expect as help", () => {
    expect(invoke(["--expect", YODA_VERSION]).stdout).toContain("Usage: yoda");
  });

  it.each([
    ["9.9.9", "contract.plugin_version_unsupported"],
    ["not-semver", "contract.plugin_version_invalid"],
  ])("refuses to act on a drifted --expect %s", (value, reasonCode) => {
    const result = invoke(["--expect", value, "--version"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "failure",
      reasonCode,
      stateChanged: false,
    });
    // A drifted install must never reach the operation it was asked for.
    expect(result.stdout).not.toContain(YODA_VERSION);
  });

  it("refuses a --expect with no value", () => {
    expect(invoke(["--expect"]).exitCode).toBe(2);
  });
});
