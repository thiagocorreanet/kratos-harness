import { YODA_VERSION } from "@mestre-yoda/contracts";
import { describe, expect, it } from "vitest";

import { runCli } from "@mestre-yoda/runtime";
import { createRuntime } from "@mestre-yoda/runtime/composition";
import { runCommandLine } from "@mestre-yoda/runtime/composition/cli";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@mestre-yoda/runtime/domain/result";
import {
  memoryFileSystem,
  recordingOutput,
} from "@mestre-yoda/runtime/infra/fake";

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));
  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

describe("composed command line", () => {
  it("delegates the process entry to the composed pipeline", async () => {
    const output = recordingOutput();
    const exitCode = await runCli(["version"], createRuntime({ output }));
    expect(exitCode).toBe(0);
    expect(output.structured_.join("")).toBe(`${YODA_VERSION}\n`);
  });

  it("prints usage on stdout with an empty stderr", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: yoda");
    expect(result.stderr).toBe("");
  });

  it("prints exactly the version", async () => {
    expect(await run(["version"])).toEqual({
      exitCode: 0,
      stdout: `${YODA_VERSION}\n`,
      stderr: "",
    });
  });

  it("emits one result envelope in JSON mode", async () => {
    const result = await run(["--json", "version"]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "runtime.orientation_ok",
    });
    expect(result.stdout.trimEnd()).not.toContain("\n");
  });

  it("emits the declared adapter message for the handshake", async () => {
    expect(
      JSON.parse((await run(["--json", "handshake"])).stdout),
    ).toMatchObject({
      operation: "handshake",
      payloadContract: "result@1.0.0",
    });
  });

  it("writes a human failure to stderr and nothing to stdout", async () => {
    const result = await run(["start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Reason: trail.uso");
  });

  it("writes a JSON failure to stdout as one envelope", async () => {
    const result = await run(["--json", "start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      reasonCode: "trail.uso",
    });
  });

  it("renders malformed globals and command arguments through usage results", async () => {
    expect(await run(["--json", "--expect"])).toMatchObject({
      exitCode: 2,
      stderr: "",
    });
    expect((await run(["version", "--unknown"])).stderr).toContain(
      "Reason: trail.uso",
    );
  });

  it("renders an unexpected failure as a sanitized internal failure", async () => {
    const output = recordingOutput();
    const exploding = [
      {
        path: ["boom"],
        summary: "Throw on purpose.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        handler: () => {
          throw new Error("/home/someone/secret-token");
        },
      },
    ];
    const exitCode = await runCommandLine(
      ["boom"],
      createRuntime({ output }),
      exploding,
    );
    expect(exitCode).toBe(2);
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
    expect(output.human_.join("")).not.toContain("secret-token");
    expect(output.structured_.join("")).toBe("");
  });

  it("validates a decision before applying its effect plan", async () => {
    const fileSystem = memoryFileSystem();
    const output = recordingOutput();
    const invalid = [
      {
        path: ["invalid"],
        summary: "Return an invalid result.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        handler: () => ({
          result: resultFor("trail.uso"),
          plan: planOf({
            kind: "write_file" as const,
            path: "changed.txt",
            content: "must not be written",
          }),
          humanStdout: null,
          payload: null,
        }),
      },
    ];

    const exitCode = await runCommandLine(
      ["invalid"],
      createRuntime({ fileSystem, output }),
      invalid,
    );
    expect(exitCode).toBe(2);
    expect(await fileSystem.stat("changed.txt")).toBeNull();
    expect(output.human_.join("")).toContain(
      "Reason: runtime.internal_failure",
    );
  });

  it("publishes a command-owned failure through the result renderer", async () => {
    const output = recordingOutput();
    const failing = [
      {
        path: ["fail"],
        summary: "Return a failure.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "result@1.0.0" as const,
        handler: () => ({
          result: usageFailure(USAGE_WHY.arity),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }),
      },
    ];
    expect(
      await runCommandLine(["fail"], createRuntime({ output }), failing),
    ).toBe(2);
    expect(output.human_.join("")).toContain("Reason: trail.uso");
  });

  it("fails closed when a non-result command has no payload", async () => {
    const output = recordingOutput();
    const absent = [
      {
        path: ["absent"],
        summary: "Return no payload.",
        flags: [],
        positionals: { min: 0, max: 0 },
        jsonContract: "adapter-message@1.0.0" as const,
        handler: () => ({
          result: resultFor("runtime.orientation_ok"),
          plan: planOf(),
          humanStdout: null,
          payload: undefined,
        }),
      },
    ];
    expect(
      await runCommandLine(
        ["--json", "absent"],
        createRuntime({ output }),
        absent,
      ),
    ).toBe(2);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
  });
});
