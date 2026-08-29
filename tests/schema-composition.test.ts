import { readFile } from "node:fs/promises";
import { join } from "node:path";

import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import {
  configurationValidator,
  createSchemaRegistry,
} from "@kratos/runtime/composition/schema";
import { describe, expect, it } from "vitest";

describe("schema composition", () => {
  it("reuses exactly one production registry instance", () => {
    expect(createSchemaRegistry()).toBe(createSchemaRegistry());
  });

  it("initializes the production registry without constructing and discarding it in main", async () => {
    const main = await readFile(
      join(import.meta.dirname, "../packages/runtime/src/main.ts"),
      "utf8",
    );

    expect(main).toContain('import "./composition/schema.js";');
    expect(main).not.toContain("createSchemaRegistry");
  });

  it("adapts project configuration to the discovery seam", () => {
    const validate = configurationValidator(createSchemaRegistry());
    expect(validate(projectConfig)).toEqual({
      kind: "valid",
      value: projectConfig,
    });
    expect(validate({ ...projectConfig, unexpected: true })).toEqual({
      kind: "invalid",
    });
  });

  it.each([
    [
      "accessor",
      () => {
        let accessed = false;
        const value = Object.defineProperty(
          structuredClone(projectConfig),
          "stateContract",
          {
            enumerable: true,
            get() {
              accessed = true;
              throw new Error("hostile accessor invoked");
            },
          },
        );
        return { value, wasAccessed: () => accessed };
      },
    ],
    [
      "Proxy",
      () => {
        let accessed = false;
        const value = new Proxy(structuredClone(projectConfig), {
          get() {
            accessed = true;
            throw new Error("hostile Proxy trap invoked");
          },
        });
        return { value, wasAccessed: () => accessed };
      },
    ],
    [
      "revoked Proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable(
          structuredClone(projectConfig),
          {},
        );
        revoke();
        return { value: proxy, wasAccessed: () => false };
      },
    ],
  ])("rejects a project configuration with a hostile %s", (_, hostile) => {
    const validate = configurationValidator(createSchemaRegistry());
    const { value, wasAccessed } = hostile();

    expect(validate(value)).toEqual({ kind: "invalid" });
    expect(wasAccessed()).toBe(false);
  });
});
