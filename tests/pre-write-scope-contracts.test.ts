import featureScopeSchema from "../schemas/state/feature-scope.v1.schema.json" with { type: "json" };
import guardrailsSchema from "../schemas/state/guardrails.v1.schema.json" with { type: "json" };
import preToolUseSchema from "../schemas/host/pre-tool-use.v1.schema.json" with { type: "json" };
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const registry = createSchemaRegistry();

function validator(schema: object) {
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

describe("pre-write scope contracts", () => {
  it("accepts ordered project-relative scope globs and rejects unsafe globs", () => {
    const validate = validator(featureScopeSchema);
    const scope = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      allow: ["src/**", "!src/generated/**", "docs/[a-z]?/*.md"],
      deny: [".env", "!fixtures/.env.example"],
    };

    expect(validate(scope), JSON.stringify(validate.errors)).toBe(true);
    for (const glob of [
      "",
      "!",
      "/etc/**",
      "C:/private/**",
      "../private/**",
      "src\\**",
    ]) {
      expect(
        validate({ ...scope, allow: [glob] }),
        `expected ${JSON.stringify(glob)} to be invalid`,
      ).toBe(false);
    }
  });

  it("accepts an ordered heterogeneous normalized mutation request", () => {
    const validate = validator(preToolUseSchema);
    const request = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      mutations: [
        { kind: "create", path: "src/new-file.ts" },
        { kind: "update", path: "src/index.ts" },
        { kind: "delete", path: "src/obsolete.ts" },
        {
          kind: "move",
          source: "src/old-name.ts",
          destination: "src/new-name.ts",
        },
      ],
    };

    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...request, mutations: [] })).toBe(false);
  });

  it("requires the exact closed shape for each normalized mutation", () => {
    const validate = validator(preToolUseSchema);
    const request = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      mutations: [
        {
          kind: "move",
          source: "src/old-name.ts",
          destination: "src/new-name.ts",
        },
      ],
    };

    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({
        ...request,
        mutations: [{ kind: "move", source: "src/old-name.ts" }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...request,
        mutations: [
          {
            kind: "move",
            source: "src/old-name.ts",
            destination: "src/new-name.ts",
            path: "src/unexpected.ts",
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        ...request,
        mutations: [{ kind: "update", path: "src/index.ts", extra: true }],
      }),
    ).toBe(false);
  });

  it("keeps existing guardrails valid and accepts an additive project write block", () => {
    const validate = validator(guardrailsSchema);
    const legacy = {
      contractVersion: "1.0.0",
      policyMode: "standard",
      snapshots: true,
      managedPaths: [".brain", ".claude", "CLAUDE.md"],
    };

    expect(validate(legacy), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({
        ...legacy,
        stateContract: "1.0.0",
        writeBlocks: ["private/**", "!private/example.txt"],
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    for (const glob of ["../private/**", "C:/private/**"]) {
      expect(validate({ ...legacy, writeBlocks: [glob] })).toBe(false);
    }
  });

  it("registers generated scope, guardrails, and pre-tool types", () => {
    const featureScope = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      allow: ["src/**"],
      deny: [],
    };
    const guardrails = {
      contractVersion: "1.0.0",
      policyMode: "standard",
      snapshots: true,
      managedPaths: [".brain"],
    };
    const request = {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      mutations: [{ kind: "update", path: "src/index.ts" }],
    };

    expect(
      registry.validate({
        id: "state.feature-scope",
        version: "1.0.0",
        value: featureScope,
        structuralReasonCode: "guard.scope_corrupt",
      }),
    ).toEqual({ kind: "valid", value: featureScope });
    expect(
      registry.validate({
        id: "state.guardrails",
        version: "1.0.0",
        value: guardrails,
        structuralReasonCode: "guard.guardrails_corrupt",
      }),
    ).toEqual({ kind: "valid", value: guardrails });
    expect(
      registry.validate({
        id: "host.pre-tool-use",
        version: "1.0.0",
        value: request,
        structuralReasonCode: "guard.target_uninspectable",
      }),
    ).toEqual({ kind: "valid", value: request });
  });
});
