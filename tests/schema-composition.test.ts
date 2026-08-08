import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import {
  configurationValidator,
  createSchemaRegistry,
} from "@mestre-yoda/runtime/composition/schema";
import { describe, expect, it } from "vitest";

describe("schema composition", () => {
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
