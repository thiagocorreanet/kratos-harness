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
});
