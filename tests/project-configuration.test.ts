import { describe, expect, it } from "vitest";

import type {
  ProjectConfigV1_2,
  ReadableProjectConfig,
} from "@kratos/contracts";
import projectConfigV1 from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import projectConfigV1_1 from "../fixtures/contracts/v1.1/project-config.json" with { type: "json" };
import projectConfigV1_2 from "../fixtures/contracts/v1.2/project-config.json" with { type: "json" };
import {
  classifyConfiguration,
  type ConfigurationObservation,
  type ConfigurationValidator,
} from "@kratos/runtime/domain/project";

const validConfiguration: ProjectConfigV1_2 = {
  contractVersion: "1.2.0",
  stateContract: "1.2.0",
  pluginVersion: "0.0.0-development",
  hostContract: "1.2.0",
  language: {
    conversation: "en",
    documentation: "en",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  },
  policyMode: "strict",
  managedState: {
    directory: ".brain",
    eventLog: "events.jsonl",
    snapshots: true,
  },
  modelRoles: {
    codex: {
      planner: "planner",
      implementer: "implementer",
      judge: "judge",
    },
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
  it("requires migration instead of executing a readable 1.0 configuration", () => {
    const { validator, values } = recordingValidator("valid");

    expect(classifyConfiguration(file(projectConfigV1), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "model.config_migration_required",
    });
    expect(values).toEqual([]);
  });

  it("requires migration instead of executing a readable 1.1 configuration", () => {
    const { validator, values } = recordingValidator("valid");

    expect(classifyConfiguration(file(projectConfigV1_1), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "model.config_migration_required",
    });
    expect(values).toEqual([]);
  });

  it("preserves a readable 1.2 configuration for later role-aware phases", () => {
    const validator: ConfigurationValidator = () => ({
      kind: "valid",
      value: projectConfigV1_2 as ReadableProjectConfig,
    });

    expect(classifyConfiguration(file(projectConfigV1_2), validator)).toEqual({
      kind: "valid",
      value: projectConfigV1_2,
    });
  });

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
      "a non-current patch identity",
      file({ stateContract: "1.0.1" }),
      "contract.state_version_unsupported",
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
      file({ stateContract: "1.2.0", unexpected: secret }),
      validator,
    );
    expect(result).toEqual({
      kind: "failure",
      reasonCode: "guard.config_corrupt",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns only the value accepted by the validator", () => {
    const parsed = {
      stateContract: "1.2.0",
      language: {
        conversation: "pt-BR",
        documentation: "pt-BR",
        comments: "en",
        identifiers: "en",
        commits: "en",
        preserveConventions: true,
        enforcement: "advisory",
      },
    };
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
      text: '{"stateContract":"2.0.0","stateContract":"1.2.0"}',
    } as const;
    expect(classifyConfiguration(input, validator)).toEqual({
      kind: "failure",
      reasonCode: "guard.config_corrupt",
    });
    expect(values).toEqual([{ stateContract: "1.2.0" }]);
  });
});
