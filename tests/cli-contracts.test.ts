import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

import { createRuntime } from "@mestre-yoda/runtime/composition";
import { runCommandLine } from "@mestre-yoda/runtime/composition/cli";
import { DEFAULT_REGISTRY } from "@mestre-yoda/runtime/domain/cli";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import {
  memoryFileSystem,
  recordingOutput,
} from "@mestre-yoda/runtime/infra/fake";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaPaths = new Map([
  ["result@1.0.0", "schemas/result.v1.schema.json"],
  ["adapter-message@1.0.0", "schemas/host/adapter-message.v1.schema.json"],
]);
const validators = new Map<string, (value: unknown) => boolean>();

beforeAll(async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const resultSchema = JSON.parse(
    await readFile(
      join(repositoryRoot, "schemas/result.v1.schema.json"),
      "utf8",
    ),
  ) as object;
  validators.set("result@1.0.0", ajv.compile(resultSchema));
  for (const [id, path] of schemaPaths) {
    if (id === "result@1.0.0") continue;
    const schema = JSON.parse(
      await readFile(join(repositoryRoot, path), "utf8"),
    ) as object;
    validators.set(id, ajv.compile(schema));
  }
});

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));
  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

describe("declared JSON contracts", () => {
  it("declares a schema that exists for every command", () => {
    for (const spec of DEFAULT_REGISTRY) {
      expect(schemaPaths.has(spec.jsonContract), spec.path.join(" ")).toBe(
        true,
      );
    }
  });

  it("emits output satisfying the declared schema", async () => {
    for (const spec of DEFAULT_REGISTRY) {
      const result = await run(["--json", ...spec.path]);
      const validate = validators.get(spec.jsonContract);
      expect(validate?.(JSON.parse(result.stdout)), spec.path.join(" ")).toBe(
        true,
      );
    }
  });
});

describe("output safety", () => {
  const hostile = [
    "/home/someone/private/secret-token",
    "--expect",
    "sekrit-value-1.2.3",
    "start\u0007",
  ];

  it("never echoes a supplied argument in either mode", async () => {
    for (const json of [[], ["--json"]]) {
      const result = await run([...json, ...hostile]);
      expect(result.exitCode).not.toBe(0);
      for (const secret of ["secret-token", "sekrit-value", "\u0007"]) {
        expect(result.stdout, secret).not.toContain(secret);
        expect(result.stderr, secret).not.toContain(secret);
      }
    }
  });
});

describe("determinism", () => {
  it("emits identical bytes for two runs of one argument vector", async () => {
    expect(await run(["--json", "handshake"])).toEqual(
      await run(["--json", "handshake"]),
    );
    expect(await run(["--help"])).toEqual(await run(["--help"]));
  });

  it("publishes the handshake as canonical adapter text", async () => {
    const result = await run(["--json", "handshake"]);

    expect(result.stdout).toBe(
      `${canonicalizeJson(JSON.parse(result.stdout))}\n`,
    );
  });
});

describe("no mutation on a usage failure", () => {
  it("applies no filesystem effect", async () => {
    const fileSystem = memoryFileSystem();
    const output = recordingOutput();
    const before = await fileSystem.list(".");
    await runCommandLine(["start"], createRuntime({ fileSystem, output }));
    expect(await fileSystem.list(".")).toEqual(before);
  });
});
