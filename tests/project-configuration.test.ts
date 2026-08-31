import { describe, expect, it } from "vitest";

import type {
  ProjectConfigV1_4,
  ReadableProjectConfig,
} from "@kratos/contracts";
import projectConfigV1 from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import projectConfigV1_1 from "../fixtures/contracts/v1.1/project-config.json" with { type: "json" };
import projectConfigV1_2 from "../fixtures/contracts/v1.2/project-config.json" with { type: "json" };
import projectConfigV1_3 from "../fixtures/contracts/v1.3/project-config.json" with { type: "json" };
import {
  classifyConfiguration,
  type ConfigurationObservation,
  type ConfigurationValidator,
} from "@kratos/runtime/domain/project";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";

const validConfiguration: ProjectConfigV1_4 = {
  contractVersion: "1.4.0",
  stateContract: "1.4.0",
  pluginVersion: "0.0.0-development",
  hostContract: "1.4.0",
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
  gateModes: {},
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
  projectProfile: structuredClone(
    projectConfigV1_3.projectProfile,
  ) as ProjectConfigV1_4["projectProfile"],
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
  it("accepts a positive 1.4 ceiling and resolves an omitted ceiling to three", () => {
    const registry = createSchemaRegistry();
    const configured = {
      ...validConfiguration,
      contractVersion: "1.4.0",
      stateContract: "1.4.0",
      hostContract: "1.4.0",
      acceptanceAttemptCeiling: 5,
    };
    const omitted = {
      ...validConfiguration,
      contractVersion: "1.4.0",
      stateContract: "1.4.0",
      hostContract: "1.4.0",
    };

    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.4.0",
        value: configured,
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toMatchObject({ kind: "valid" });
    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.4.0",
        value: { ...configured, acceptanceAttemptCeiling: 0 },
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toMatchObject({ kind: "invalid" });
    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.4.0",
        value: {
          ...configured,
          acceptanceAttemptCeiling: Number.MAX_SAFE_INTEGER + 1,
        },
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toMatchObject({ kind: "invalid" });

    const validator: ConfigurationValidator = () => ({
      kind: "valid",
      value: omitted as ReadableProjectConfig,
    });
    expect(classifyConfiguration(file(omitted), validator)).toMatchObject({
      kind: "valid",
      value: { acceptanceAttemptCeiling: 3 },
    });
  });

  it("requires migration instead of executing a readable 1.0 configuration", () => {
    const { validator, values } = recordingValidator("valid");

    expect(classifyConfiguration(file(projectConfigV1), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    });
    expect(values).toEqual([]);
  });

  it("requires migration instead of executing a readable 1.1 configuration", () => {
    const { validator, values } = recordingValidator("valid");

    expect(classifyConfiguration(file(projectConfigV1_1), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    });
    expect(values).toEqual([]);
  });

  it("requires explicit profile migration for a readable 1.2 configuration", () => {
    const { validator, values } = recordingValidator("valid");

    expect(classifyConfiguration(file(projectConfigV1_2), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    });
    expect(values).toEqual([]);
  });

  it("requires migration instead of executing a readable 1.3 configuration", () => {
    const validator: ConfigurationValidator = () => ({
      kind: "valid",
      value: projectConfigV1_3 as ReadableProjectConfig,
    });

    expect(classifyConfiguration(file(projectConfigV1_3), validator)).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
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
      file({ stateContract: "1.4.0", unexpected: secret }),
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
      stateContract: "1.4.0",
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
      value: { ...validConfiguration, acceptanceAttemptCeiling: 3 },
    });
    expect(values).toEqual([parsed]);
  });

  it("uses JSON last-key semantics without publishing parser input", () => {
    const { validator, values } = recordingValidator("invalid");
    const input = {
      kind: "file",
      text: '{"stateContract":"2.0.0","stateContract":"1.4.0"}',
    } as const;
    expect(classifyConfiguration(input, validator)).toEqual({
      kind: "failure",
      reasonCode: "guard.config_corrupt",
    });
    expect(values).toEqual([{ stateContract: "1.4.0" }]);
  });
});
