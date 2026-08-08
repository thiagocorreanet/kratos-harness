import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import evidence from "../fixtures/contracts/v1/evidence.json" with { type: "json" };
import adapterMessage from "../fixtures/contracts/v1/adapter-message.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  ajvSchemaRegistry,
  compileSchemaRegistry,
  type EmbeddedSchemaEntry,
} from "@mestre-yoda/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const registry = ajvSchemaRegistry();

describe("Ajv schema registry", () => {
  it("returns the original value after exact contract validation", () => {
    const result = registry.validate({
      id: "state.project-config",
      version: "1.0.0",
      value: projectConfig,
      structuralReasonCode: "guard.config_corrupt",
    });
    expect(result).toEqual({ kind: "valid", value: projectConfig });
    if (result.kind === "valid") expect(result.value).toBe(projectConfig);
  });

  it.each([
    [undefined, "contract.state_version_invalid"],
    ["go-v3@0.6.5", "contract.state_version_unsupported"],
    ["2.0.0", "contract.state_version_unsupported"],
  ])(
    "rejects state version %s before schema validation",
    (version, reasonCode) => {
      const result = registry.validate({
        id: "state.snapshot",
        version,
        value: null,
        structuralReasonCode: "runtime.state_corrupt",
      });
      expect(result).toMatchObject({
        kind: "invalid",
        diagnostics: [{ reasonCode }],
      });
    },
  );

  it("maps migration-only state versions to the unsupported recovery", () => {
    expect(
      registry.validate({
        id: "state.snapshot",
        version: "go-v3@0.6.5",
        value: null,
        structuralReasonCode: "runtime.state_corrupt",
      }),
    ).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.snapshot",
          version: null,
          pointer: "",
          keyword: "version",
          reasonCode: "contract.state_version_unsupported",
          recovery:
            "Create and authorize an explicit migration plan for the persisted project state.",
        },
      ],
    });
  });

  it("rejects a forged contract identifier before version diagnostics", () => {
    expect(() =>
      registry.validate({
        id: "host.secret-token-value" as "host.adapter-message",
        version: undefined,
        value: null,
        structuralReasonCode: "trail.output_invalido",
      }),
    ).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("does not mutate or coerce rejected input", () => {
    const value = { ...projectConfig, unexpected: true };
    const before = structuredClone(value);
    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.0.0",
        value,
        structuralReasonCode: "guard.config_corrupt",
      }).kind,
    ).toBe("invalid");
    expect(value).toEqual(before);
  });

  it("normalizes a nested structural failure exactly", () => {
    const value = structuredClone(projectConfig);
    value.managedState.eventLog = "not-the-event-log";

    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.0.0",
        value,
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "/managedState/eventLog",
          keyword: "const",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
      ],
    });
  });

  it.each([
    {
      name: "required",
      id: "state.project-config" as const,
      value: (() => {
        const candidate: Record<string, unknown> =
          structuredClone(projectConfig);
        delete candidate.language;
        return candidate;
      })(),
      pointer: "/language",
      keyword: "required",
      reasonCode: "guard.config_corrupt" as const,
      recovery:
        "Correct project configuration against its schema before rerunning the guard.",
    },
    {
      name: "type",
      id: "state.project-config" as const,
      value: {
        ...structuredClone(projectConfig),
        managedState: {
          ...structuredClone(projectConfig.managedState),
          snapshots: null,
        },
      },
      pointer: "/managedState/snapshots",
      keyword: "type",
      reasonCode: "guard.config_corrupt" as const,
      recovery:
        "Correct project configuration against its schema before rerunning the guard.",
    },
    {
      name: "pattern",
      id: "state.evidence" as const,
      value: { ...structuredClone(evidence), sha256: "rejected-secret-data" },
      pointer: "/sha256",
      keyword: "pattern",
      reasonCode: "runtime.state_corrupt" as const,
      recovery:
        "Preserve the rejected state, run the explicit integrity audit, and retry only after verified repair or rebuild.",
    },
  ])("normalizes a $name failure", (fixture) => {
    const result = registry.validate({
      id: fixture.id,
      version: "1.0.0",
      value: fixture.value,
      structuralReasonCode: fixture.reasonCode,
    });
    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: fixture.id,
          version: "1.0.0",
          pointer: fixture.pointer,
          keyword: fixture.keyword,
          reasonCode: fixture.reasonCode,
          recovery: fixture.recovery,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("rejected-secret-data");
  });

  it("keeps an unexpected property at its safe parent pointer", () => {
    const value = {
      ...structuredClone(projectConfig),
      "secret-token-value": "attacker-controlled-data",
    };
    const result = registry.validate({
      id: "state.project-config",
      version: "1.0.0",
      value,
      structuralReasonCode: "guard.config_corrupt",
    });

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "",
          keyword: "additionalProperties",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("attacker-controlled-data");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("schemaPath");
  });

  it("sorts multiple failures by pointer then keyword", () => {
    const value: Record<string, unknown> = structuredClone(projectConfig);
    delete value.language;
    value.unexpected = true;
    value.managedState = {
      ...structuredClone(projectConfig.managedState),
      eventLog: "wrong",
      snapshots: null,
    };

    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.0.0",
        value,
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "",
          keyword: "additionalProperties",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "/language",
          keyword: "required",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "/managedState/eventLog",
          keyword: "const",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "/managedState/snapshots",
          keyword: "type",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
      ],
    });
  });

  it("deduplicates diagnostics produced by schema composition", () => {
    const value: Record<string, unknown> = structuredClone(adapterMessage);
    delete value.host;
    const result = registry.validate({
      id: "host.adapter-message",
      version: "1.0.0",
      value,
      structuralReasonCode: "trail.output_invalido",
    });
    expect(result.kind).toBe("invalid");
    if (result.kind === "valid") return;
    const serialized = result.diagnostics.map((diagnostic) =>
      JSON.stringify(diagnostic),
    );
    expect(result.diagnostics.length).toBeGreaterThan(1);
    expect(new Set(serialized).size).toBe(serialized.length);
    expect(result.diagnostics).toEqual(
      [...result.diagnostics].sort(
        (left, right) =>
          left.pointer.localeCompare(right.pointer) ||
          left.keyword.localeCompare(right.keyword) ||
          left.reasonCode.localeCompare(right.reasonCode) ||
          left.contract.localeCompare(right.contract),
      ),
    );
  });

  it("escapes schema-owned required property names in JSON Pointers", () => {
    const entries: EmbeddedSchemaEntry[] = EMBEDDED_SCHEMA_CATALOG.map(
      (entry) => structuredClone(entry),
    );
    const projectEntry = entries.find(
      ({ id }) => id === "state.project-config",
    );
    if (projectEntry === undefined) throw new Error("missing schema fixture");
    const schema = projectEntry.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    properties["owned~/field"] = { type: "string" };
    schema.allOf = [
      {
        type: "object",
        properties: { "owned~/field": { type: "string" } },
        required: ["owned~/field"],
      },
      {
        type: "object",
        properties: { "owned~/field": { type: "string" } },
        required: ["owned~/field"],
      },
    ];
    const injected = compileSchemaRegistry(
      entries,
      EMBEDDED_SCHEMA_DEPENDENCIES,
    );

    expect(
      injected.validate({
        id: "state.project-config",
        version: "1.0.0",
        value: projectConfig,
        structuralReasonCode: "guard.config_corrupt",
      }),
    ).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "1.0.0",
          pointer: "/owned~0~1field",
          keyword: "required",
          reasonCode: "guard.config_corrupt",
          recovery:
            "Correct project configuration against its schema before rerunning the guard.",
        },
      ],
    });
  });

  it("throws only the registry-integrity error for an unavailable policy", () => {
    expect(() =>
      registry.validate({
        id: "state.project-config",
        version: "1.0.0",
        value: { ...projectConfig, unexpected: true },
        structuralReasonCode: "not.committed" as "guard.config_corrupt",
      }),
    ).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("sanitizes catalog and schema compilation failures", () => {
    expect(() =>
      compileSchemaRegistry(
        EMBEDDED_SCHEMA_CATALOG.slice(1),
        EMBEDDED_SCHEMA_DEPENDENCIES,
      ),
    ).toThrow(new Error("Embedded schema registry is invalid"));
    expect(() => compileSchemaRegistry(EMBEDDED_SCHEMA_CATALOG, [])).toThrow(
      new Error("Embedded schema registry is invalid"),
    );
  });
});
