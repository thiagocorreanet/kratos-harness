import { describe, expect, it } from "vitest";

import type { ProjectConfigV1 } from "@mestre-yoda/contracts";
import {
  classifyConfiguration,
  type ConfigurationObservation,
  type ConfigurationValidator,
} from "@mestre-yoda/runtime/domain/project";

const validConfiguration: ProjectConfigV1 = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  pluginVersion: "0.0.0-development",
  hostContract: "1.0.0",
  language: "en",
  policyMode: "strict",
  managedState: {
    directory: ".brain",
    eventLog: "events.jsonl",
    snapshots: true,
  },
};

function file(value: unknown): ConfigurationObservation {
  return { kind: "file", text: JSON.stringify(value) };
}

function recordingValidator(result: "valid" | "invalid") {
  const values: unknown[] = [];
  const validator: ConfigurationValidator = (value) => {
    values.push(value);
    return result === "valid"
      ? { kind: "valid", value: validConfiguration }
      : { kind: "invalid" };
  };
  return { validator, values };
}

describe("project configuration classification", () => {
  it.each([
    ["an absent document", { kind: "absent" } as const, "guard.config_missing"],
    ["a non-file document", { kind: "other" } as const, "guard.config_corrupt"],
    [
      "invalid JSON",
      { kind: "file", text: '{"stateContract":' } as const,
      "guard.config_corrupt",
    ],
    ["a missing identity", file({}), "contract.state_version_invalid"],
    ["a null document", file(null), "contract.state_version_invalid"],
    ["an array document", file([]), "contract.state_version_invalid"],
    [
      "a non-string identity",
      file({ stateContract: 1 }),
      "contract.state_version_invalid",
    ],
    [
      "an untrimmed identity",
      file({ stateContract: " 1.0.0" }),
      "contract.state_version_invalid",
    ],
    [
      "a future identity",
      file({ stateContract: "2.0.0" }),
      "contract.state_version_unsupported",
    ],
    [
      "a migration-only identity",
      file({ stateContract: "go-v3@0.6.5" }),
      "contract.state_version_unsupported",
    ],
  ])("rejects %s before schema validation", (_label, input, reasonCode) => {
    const { validator, values } = recordingValidator("valid");
    expect(classifyConfiguration(input, validator)).toEqual({
      kind: "failure",
      reasonCode,
    });
    expect(values).toEqual([]);
  });

  it("maps a current schema rejection without exposing caller data", () => {
    const secret = "/home/customer/token=private";
    const { validator } = recordingValidator("invalid");
    const result = classifyConfiguration(
      file({ stateContract: "1.0.0", unexpected: secret }),
      validator,
    );
    expect(result).toEqual({
      kind: "failure",
      reasonCode: "guard.config_corrupt",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns only the value accepted by the validator", () => {
    const parsed = { stateContract: "1.0.0", language: "pt-BR" };
    const { validator, values } = recordingValidator("valid");
    expect(classifyConfiguration(file(parsed), validator)).toEqual({
      kind: "valid",
      value: validConfiguration,
    });
    expect(values).toEqual([parsed]);
  });

  it("uses JSON last-key semantics without publishing parser input", () => {
    const { validator, values } = recordingValidator("invalid");
    const input = {
      kind: "file",
      text: '{"stateContract":"2.0.0","stateContract":"1.0.0"}',
    } as const;
    expect(classifyConfiguration(input, validator)).toEqual({
      kind: "failure",
      reasonCode: "guard.config_corrupt",
    });
    expect(values).toEqual([{ stateContract: "1.0.0" }]);
  });
});
