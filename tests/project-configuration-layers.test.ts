import { describe, expect, it } from "vitest";

import {
  resolveConfigurationLayers,
  type ConfigurationLayers,
} from "@kratos/runtime/domain/project";

interface Settings {
  language: "en" | "pt-BR";
  policyMode: "standard" | "strict";
  snapshots: boolean;
}

const keys = ["language", "policyMode", "snapshots"] as const;

function layers(
  overrides: Partial<ConfigurationLayers<Settings>> = {},
): ConfigurationLayers<Settings> {
  return {
    defaults: {
      language: "en",
      policyMode: "standard",
      snapshots: false,
    },
    project: {},
    flags: {},
    ...overrides,
  };
}

describe("project configuration layers", () => {
  it("applies default, project, and flag precedence with provenance", () => {
    expect(
      resolveConfigurationLayers(
        keys,
        layers({
          project: { language: "pt-BR", policyMode: "strict" },
          flags: {
            policyMode: { value: "standard", ref: "--policy-mode" },
          },
        }),
      ),
    ).toEqual({
      language: {
        value: "pt-BR",
        source: "project",
        ref: ".brain/config.json",
      },
      policyMode: {
        value: "standard",
        source: "flag",
        ref: "--policy-mode",
      },
      snapshots: { value: false, source: "default", ref: null },
    });
  });

  it("preserves lower-layer values and provenance when overrides are absent", () => {
    expect(resolveConfigurationLayers(keys, layers()).language).toEqual({
      value: "en",
      source: "default",
      ref: null,
    });
  });

  it("does not mutate any input layer", () => {
    const input = layers({ project: { language: "pt-BR" } });
    const before = structuredClone(input);
    resolveConfigurationLayers(keys, input);
    expect(input).toEqual(before);
  });

  it("emits keys in the declared deterministic order", () => {
    const result = resolveConfigurationLayers(keys, layers());
    expect(Object.keys(result)).toEqual(keys);
  });

  it.each([
    [
      "an unknown default key",
      { defaults: { language: "en", privatePath: "/home/customer" } },
    ],
    ["an undefined value", { defaults: { language: undefined } }],
    ["an undefined project value", { project: { language: undefined } }],
    [
      "an unsafe flag ref",
      { flags: { language: { value: "pt-BR", ref: "/home/customer" } } },
    ],
  ])("fails closed for %s", (_label, override) => {
    const input = {
      ...layers(),
      ...override,
    } as unknown as ConfigurationLayers<Settings>;
    expect(() => resolveConfigurationLayers(keys, input)).toThrow(
      "Configuration layers are invalid",
    );
  });

  it("requires every declared setting to resolve", () => {
    expect(() =>
      resolveConfigurationLayers<Settings, typeof keys>(keys, {
        defaults: { language: "en" },
        project: {},
        flags: {},
      }),
    ).toThrow("Configuration layers are incomplete");
  });
});
