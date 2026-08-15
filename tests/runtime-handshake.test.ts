import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { KRATOS_VERSION } from "@kratos/contracts";
import {
  buildHandshakeResponse,
  classifyExpectedVersion,
} from "@kratos/runtime/handshake";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
let validateMessage: (value: unknown) => boolean;

beforeAll(async () => {
  const [messageSchema, resultSchema] = await Promise.all([
    readFile(
      join(repositoryRoot, "schemas/host/adapter-message.v1.schema.json"),
      "utf8",
    ),
    readFile(join(repositoryRoot, "schemas/result.v1.schema.json"), "utf8"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(JSON.parse(resultSchema) as object);
  validateMessage = ajv.compile(JSON.parse(messageSchema) as object);
});

describe("runtime handshake", () => {
  it("reports the carried contract versions", () => {
    const message = buildHandshakeResponse("cli");

    expect(message).toMatchObject({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      messageType: "response",
      operation: "handshake",
      correlationId: "cli",
    });
    expect(message.payload).toMatchObject({
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      stateChanged: false,
      retryable: false,
      recovery: null,
    });
  });

  it("satisfies the host adapter message schema", () => {
    expect(validateMessage(buildHandshakeResponse("cli"))).toBe(true);
  });

  it("stays deterministic across invocations", () => {
    expect(buildHandshakeResponse("abc")).toEqual(
      buildHandshakeResponse("abc"),
    );
  });

  it("reports no observed host identity when invoked directly", () => {
    // The runtime cannot observe a host it was not handed one by.
    expect(buildHandshakeResponse("cli").observedIdentity).toEqual({
      adapterVersion: KRATOS_VERSION,
      model: null,
    });
  });

  it("accepts the exact bundle version", () => {
    expect(classifyExpectedVersion(KRATOS_VERSION)).toBeNull();
  });

  it.each([
    [undefined, "contract.plugin_version_invalid"],
    ["", "contract.plugin_version_invalid"],
    ["not-semver", "contract.plugin_version_invalid"],
    [" 1.0.0 ", "contract.plugin_version_invalid"],
    [42, "contract.plugin_version_invalid"],
    ["9.9.9", "contract.plugin_version_unsupported"],
    ["1.0.0", "contract.plugin_version_unsupported"],
  ])("rejects %o", (value, reasonCode) => {
    expect(classifyExpectedVersion(value)).toMatchObject({
      reasonCode,
      status: "failure",
      exitCode: 2,
      stateChanged: false,
      retryable: false,
    });
  });

  it.each(["7.7.7", "not-semver", "sekrit-build-name"])(
    "never echoes the supplied value %s",
    (value) => {
      // Distinctive values only: a substring assertion against "" or against a
      // version that also appears as `contractVersion` proves nothing.
      expect(JSON.stringify(classifyExpectedVersion(value))).not.toContain(
        value,
      );
    },
  );
});
