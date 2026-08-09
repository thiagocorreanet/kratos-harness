import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import approval from "../fixtures/contracts/v1/approval.json" with { type: "json" };
import evidence from "../fixtures/contracts/v1/evidence.json" with { type: "json" };
import adapterMessage from "../fixtures/contracts/v1/adapter-message.json" with { type: "json" };
import migration from "../fixtures/contracts/v1/migration.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  ajvSchemaRegistry,
  compileSchemaRegistry,
  type EmbeddedSchemaEntry,
} from "@mestre-yoda/runtime/infra/schema";
import { beforeAll, describe, expect, it, vi } from "vitest";

const registry = ajvSchemaRegistry();
const repositoryRoot = join(import.meta.dirname, "..");
const bundledRuntime = join(repositoryRoot, "dist/plugin/runtime/yoda.mjs");

function runWithPrototypePollution(preloadSource: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preloadSource)}`,
      bundledRuntime,
      "--json",
      "handshake",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
}

const projectConfigRequest = (value: unknown) => ({
  id: "state.project-config" as const,
  version: "1.0.0",
  value,
  structuralReasonCode: "guard.config_corrupt" as const,
});

const migrationRequest = (value: unknown) => ({
  id: "state.migration" as const,
  version: "1.0.0",
  value,
  structuralReasonCode: "runtime.state_corrupt" as const,
});

const rootProjectConfigTypeDiagnostic = {
  contract: "state.project-config",
  version: "1.0.0",
  pointer: "",
  keyword: "type",
  reasonCode: "guard.config_corrupt",
  recovery:
    "Correct project configuration against its schema before rerunning the guard.",
};

const rootApprovalTypeDiagnostic = {
  contract: "state.approval",
  version: "1.0.0",
  pointer: "",
  keyword: "type",
  reasonCode: "runtime.state_corrupt",
  recovery:
    "Preserve the rejected state, run the explicit integrity audit, and retry only after verified repair or rebuild.",
};

const rootMigrationTypeDiagnostic = {
  contract: "state.migration",
  version: "1.0.0",
  pointer: "",
  keyword: "type",
  reasonCode: "runtime.state_corrupt",
  recovery:
    "Preserve the rejected state, run the explicit integrity audit, and retry only after verified repair or rebuild.",
};

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

  it("rejects inherited-only contract fields without observing them", () => {
    let calls = 0;
    const inherited = structuredClone(approval) as Record<string, unknown>;
    Object.defineProperty(inherited, "observation", {
      enumerable: true,
      get() {
        calls += 1;
        return approval.observation;
      },
    });
    const value = Object.create(inherited) as Record<string, unknown>;
    const request = {
      id: "state.approval" as const,
      version: "1.0.0",
      value,
      structuralReasonCode: "runtime.state_corrupt" as const,
    };
    const expected = {
      kind: "invalid",
      diagnostics: [rootApprovalTypeDiagnostic],
    };

    const first = registry.validate(request);
    const second = registry.validate(request);

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(calls).toBe(0);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(approval.observation);
    expect(serialized).not.toContain(approval.challenge);
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("schemaPath");
  });

  it("rejects an own accessor without invoking it", () => {
    let calls = 0;
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    Object.defineProperty(value, "language", {
      enumerable: true,
      get() {
        calls += 1;
        return "en";
      },
    });

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(calls).toBe(0);
  });

  it("rejects a non-enumerable own accessor without invoking it", () => {
    let calls = 0;
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    Object.defineProperty(value, "language", {
      enumerable: false,
      get() {
        calls += 1;
        return "en";
      },
    });

    const result = registry.validate(projectConfigRequest(value));

    expect(calls).toBe(0);
    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
  });

  it("rejects a throwing own accessor without invoking it", () => {
    let calls = 0;
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    Object.defineProperty(value, "language", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("attacker-controlled getter text");
      },
    });

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(calls).toBe(0);
  });

  it("rejects a nested accessor without invoking it", () => {
    let calls = 0;
    const value = structuredClone(projectConfig);
    Object.defineProperty(value.managedState, "eventLog", {
      enumerable: true,
      get() {
        calls += 1;
        return "events.jsonl";
      },
    });

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(calls).toBe(0);
  });

  it("rejects a custom prototype with an inherited getter without invoking it", () => {
    let calls = 0;
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "inherited", {
      enumerable: true,
      get() {
        calls += 1;
        return "attacker-controlled inherited text";
      },
    });
    const value = structuredClone(projectConfig);
    Object.setPrototypeOf(value, prototype);

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(calls).toBe(0);
  });

  it("rejects a proxy without invoking reflective or property traps", () => {
    const calls = {
      get: 0,
      getOwnPropertyDescriptor: 0,
      ownKeys: 0,
    };
    const value = new Proxy(structuredClone(projectConfig), {
      get(target, property) {
        calls.get += 1;
        return target[property as keyof typeof target];
      },
      getOwnPropertyDescriptor(target, property) {
        calls.getOwnPropertyDescriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        calls.ownKeys += 1;
        return Reflect.ownKeys(target);
      },
    });

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(calls).toEqual({
      get: 0,
      getOwnPropertyDescriptor: 0,
      ownKeys: 0,
    });
  });

  it("rejects a cycle hidden in a non-enumerable own descriptor", () => {
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    Object.defineProperty(value, "hiddenCycle", {
      enumerable: false,
      value,
    });

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
  });

  it("rejects an unsupported value hidden in a non-enumerable own descriptor", () => {
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    Object.defineProperty(value, "hiddenUnsupported", {
      enumerable: false,
      value: Symbol("attacker-controlled hidden value"),
    });

    const result = registry.validate(projectConfigRequest(value));

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(JSON.stringify(result)).not.toContain("attacker-controlled");
  });

  it("rejects an own symbol key with one sanitized root diagnostic", () => {
    const value = structuredClone(projectConfig) as Record<
      string | symbol,
      unknown
    >;
    value[Symbol("attacker-controlled key")] = "attacker-controlled value";

    const result = registry.validate(projectConfigRequest(value));

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(JSON.stringify(result)).not.toContain("attacker-controlled");
  });

  it("rejects Object.prototype pollution without invoking its getter", () => {
    let calls = 0;
    let observedCalls: number;
    let result: unknown;
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    delete value.language;
    Object.defineProperty(Object.prototype, "language", {
      configurable: true,
      get() {
        calls += 1;
        return "en";
      },
    });

    try {
      result = registry.validate(projectConfigRequest(value));
      observedCalls = calls;
    } finally {
      delete (Object.prototype as Record<string, unknown>).language;
    }

    expect(observedCalls).toBe(0);
    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
  });

  it("fails closed on Object.prototype pollution present before module initialization", async () => {
    let calls = 0;
    let importError: unknown;
    let importCalls: number;
    Object.defineProperty(Object.prototype, "language", {
      configurable: true,
      get() {
        calls += 1;
        return "en";
      },
    });

    try {
      vi.resetModules();
      try {
        await import("@mestre-yoda/runtime/infra/schema");
      } catch (error) {
        importError = error;
      }
      importCalls = calls;
    } finally {
      delete (Object.prototype as Record<string, unknown>).language;
      vi.resetModules();
    }

    expect(importCalls).toBe(0);
    expect(importError).toEqual(
      new Error("Embedded schema registry is invalid"),
    );
  });

  it("accepts null-prototype own data while preserving value identity", () => {
    const value = Object.assign(
      Object.create(null) as Record<string, unknown>,
      approval,
    );

    const result = registry.validate({
      id: "state.approval",
      version: "1.0.0",
      value,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(result).toEqual({ kind: "valid", value });
    if (result.kind === "valid") expect(result.value).toBe(value);
  });

  it("accepts a shared acyclic child without cloning either identity", () => {
    const entries: EmbeddedSchemaEntry[] = EMBEDDED_SCHEMA_CATALOG.map(
      (entry) => structuredClone(entry),
    );
    const projectEntry = entries.find(
      ({ id }) => id === "state.project-config",
    );
    if (projectEntry === undefined) throw new Error("missing schema fixture");
    const schema = projectEntry.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    properties.managedStateAlias = structuredClone(properties.managedState);
    (schema.required as string[]).push("managedStateAlias");
    const injected = compileSchemaRegistry(
      entries,
      EMBEDDED_SCHEMA_DEPENDENCIES,
    );
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    const shared = value.managedState;
    value.managedStateAlias = shared;

    const result = injected.validate(projectConfigRequest(value));

    expect(result).toEqual({ kind: "valid", value });
    if (result.kind === "valid") {
      expect(result.value).toBe(value);
      expect(
        (result.value as unknown as Record<string, unknown>).managedStateAlias,
      ).toBe(shared);
    }
  });

  it("rejects cyclic input with one sanitized root diagnostic", () => {
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    value.cycle = value;

    const result = registry.validate(projectConfigRequest(value));

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(JSON.stringify(result)).not.toContain("cycle");
  });

  it("rejects a sparse array with one sanitized root diagnostic", () => {
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    value.managedState = Array(1);

    expect(registry.validate(projectConfigRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
  });

  it("rejects an array with a custom prototype", () => {
    const value = structuredClone(migration);
    const arrayPrototype = Array.prototype as object;
    const customPrototype = Object.create(arrayPrototype) as object;
    Object.setPrototypeOf(value.conversions, customPrototype);

    expect(registry.validate(migrationRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootMigrationTypeDiagnostic],
    });
  });

  it("rejects an extra array accessor without invoking it", () => {
    let calls = 0;
    const value = structuredClone(migration);
    Object.defineProperty(value.conversions, "extra", {
      enumerable: true,
      get() {
        calls += 1;
        return "attacker-controlled array value";
      },
    });

    const result = registry.validate(migrationRequest(value));

    expect(calls).toBe(0);
    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootMigrationTypeDiagnostic],
    });
  });

  it("rejects an extra array data key", () => {
    const value = structuredClone(migration);
    Object.defineProperty(value.conversions, "extra", {
      enumerable: true,
      value: "attacker-controlled array value",
    });

    const result = registry.validate(migrationRequest(value));

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootMigrationTypeDiagnostic],
    });
    expect(JSON.stringify(result)).not.toContain("attacker-controlled");
  });

  it("rejects an array symbol key", () => {
    const value = structuredClone(migration);
    const conversions = value.conversions as unknown as Record<
      string | symbol,
      unknown
    >;
    conversions[Symbol("attacker-controlled array key")] = "hidden";

    expect(registry.validate(migrationRequest(value))).toEqual({
      kind: "invalid",
      diagnostics: [rootMigrationTypeDiagnostic],
    });
  });

  it("rejects an accessor-backed array position without invoking it", () => {
    let calls = 0;
    const value = structuredClone(migration);
    const first = value.conversions[0];
    Object.defineProperty(value.conversions, "0", {
      enumerable: true,
      get() {
        calls += 1;
        return first;
      },
    });

    const result = registry.validate(migrationRequest(value));

    expect(calls).toBe(0);
    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootMigrationTypeDiagnostic],
    });
  });

  it.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects the non-finite number %s with one sanitized root diagnostic",
    (nonFinite) => {
      const value = structuredClone(projectConfig) as Record<string, unknown>;
      value.language = nonFinite;

      expect(registry.validate(projectConfigRequest(value))).toEqual({
        kind: "invalid",
        diagnostics: [rootProjectConfigTypeDiagnostic],
      });
    },
  );

  it.each([
    ["symbol", Symbol("attacker-controlled symbol")],
    ["function", () => "attacker-controlled function"],
  ])("rejects an unsupported %s value at the root", (_name, unsupported) => {
    const value = structuredClone(projectConfig) as Record<string, unknown>;
    value.language = unsupported;

    const result = registry.validate(projectConfigRequest(value));

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [rootProjectConfigTypeDiagnostic],
    });
    expect(JSON.stringify(result)).not.toContain("attacker-controlled");
  });

  it("keeps version classification ahead of inert-data validation", () => {
    const value = new Proxy(structuredClone(projectConfig), {
      ownKeys() {
        throw new Error("version-first violation");
      },
    });

    expect(
      registry.validate({
        ...projectConfigRequest(value),
        version: "2.0.0",
      }),
    ).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "2.0.0",
          pointer: "",
          keyword: "version",
          reasonCode: "contract.state_version_unsupported",
          recovery:
            "Create and authorize an explicit migration plan for the persisted project state.",
        },
      ],
    });
  });

  it("reads a changing request value once and returns that validated identity", () => {
    let calls = 0;
    const first = structuredClone(projectConfig);
    const changed = {
      ...structuredClone(projectConfig),
      unexpected: true,
    };
    const request = {
      id: "state.project-config" as const,
      version: "1.0.0",
      get value() {
        calls += 1;
        return calls === 1 ? first : changed;
      },
      structuralReasonCode: "guard.config_corrupt" as const,
    };

    const result = registry.validate(request);

    expect(calls).toBe(1);
    expect(result).toEqual({ kind: "valid", value: first });
    if (result.kind === "valid") expect(result.value).toBe(first);
  });

  it("reads the version once and leaves later envelope fields untouched when unsupported", () => {
    const calls = {
      structuralReasonCode: 0,
      value: 0,
      version: 0,
    };
    const request = {
      id: "state.project-config" as const,
      get version() {
        calls.version += 1;
        return "2.0.0";
      },
      get value() {
        calls.value += 1;
        return projectConfig;
      },
      get structuralReasonCode() {
        calls.structuralReasonCode += 1;
        return "guard.config_corrupt" as const;
      },
    };

    const result = registry.validate(request);

    expect(calls).toEqual({
      structuralReasonCode: 0,
      value: 0,
      version: 1,
    });
    expect(result).toMatchObject({
      kind: "invalid",
      diagnostics: [
        {
          contract: "state.project-config",
          version: "2.0.0",
          keyword: "version",
          reasonCode: "contract.state_version_unsupported",
        },
      ],
    });
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

describe("schema registry fresh-process preflight", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });
  });

  it("rejects a throwing allowlisted accessor before any hostile execution", () => {
    const result = runWithPrototypePollution(`
      let calls = 0;
      process.on("exit", () => {
        process.stderr.write("\\nMESTRE_YODA_PROBE_CALLS=" + calls + "\\n");
      });
      Object.defineProperty(Object.prototype, "hasOwnProperty", {
        configurable: true,
        enumerable: false,
        get() {
          calls += 1;
          throw new Error("attacker-allowlisted-accessor");
        },
      });
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MESTRE_YODA_PROBE_CALLS=0");
    expect(result.stderr).toContain("Embedded schema registry is invalid");
    expect(result.stderr).not.toContain("attacker-allowlisted-accessor");
  });

  it("rejects a hostile allowlisted data function before invoking it", () => {
    const result = runWithPrototypePollution(`
      let calls = 0;
      const intrinsic = Object.prototype.hasOwnProperty;
      process.on("exit", () => {
        process.stderr.write("\\nMESTRE_YODA_PROBE_CALLS=" + calls + "\\n");
      });
      function hostile(...args) {
        calls += 1;
        return Reflect.apply(intrinsic, this, args);
      }
      Object.defineProperty(Object.prototype, "hasOwnProperty", {
        configurable: true,
        enumerable: false,
        value: hostile,
        writable: true,
      });
    `);

    expect(result.stderr).toContain("MESTRE_YODA_PROBE_CALLS=0");
    expect(result.stderr).toContain("Embedded schema registry is invalid");
    expect(result.status).not.toBe(0);
  });

  it("rejects an own returning call accessor without invoking it", () => {
    const result = runWithPrototypePollution(`
      let calls = 0;
      const intrinsic = Object.prototype.hasOwnProperty;
      process.on("exit", () => {
        process.stderr.write("\\nMESTRE_YODA_PROBE_CALLS=" + calls + "\\n");
      });
      Object.defineProperty(intrinsic, "call", {
        configurable: true,
        enumerable: false,
        get() {
          calls += 1;
          return Function.prototype.call;
        },
      });
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MESTRE_YODA_PROBE_CALLS=0");
    expect(result.stderr).toContain("Embedded schema registry is invalid");
  });

  it("rejects an own throwing call accessor without invoking it", () => {
    const result = runWithPrototypePollution(`
      let calls = 0;
      const intrinsic = Object.prototype.hasOwnProperty;
      process.on("exit", () => {
        process.stderr.write("\\nMESTRE_YODA_PROBE_CALLS=" + calls + "\\n");
      });
      Object.defineProperty(intrinsic, "call", {
        configurable: true,
        enumerable: false,
        get() {
          calls += 1;
          throw new Error("attacker-call-accessor");
        },
      });
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MESTRE_YODA_PROBE_CALLS=0");
    expect(result.stderr).toContain("Embedded schema registry is invalid");
    expect(result.stderr).not.toContain("attacker-call-accessor");
  });
});
