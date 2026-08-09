import type { ErrorObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { normalizeAjvDiagnostics } from "../packages/runtime/src/infra/schema/diagnostics.js";

function error(
  keyword: string,
  instancePath: string,
  params: Readonly<Record<string, unknown>> = {},
): ErrorObject {
  return {
    instancePath,
    keyword,
    params,
    schemaPath: "attacker-controlled schema path",
  } as ErrorObject;
}

describe("schema diagnostic normalization", () => {
  it("fails closed when Ajv reports no errors", () => {
    expect(() =>
      normalizeAjvDiagnostics(
        undefined,
        "state.project-config",
        "1.0.0",
        "guard.config_corrupt",
      ),
    ).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("ignores a forged non-string missing property", () => {
    expect(
      normalizeAjvDiagnostics(
        [error("required", "/managedState", { missingProperty: 7 })],
        "state.project-config",
        "1.0.0",
        "guard.config_corrupt",
      ),
    ).toEqual([
      {
        contract: "state.project-config",
        version: "1.0.0",
        pointer: "/managedState",
        keyword: "required",
        reasonCode: "guard.config_corrupt",
        recovery:
          "Correct project configuration against its schema before rerunning the guard.",
      },
    ]);
  });

  it("deduplicates and sorts ties by pointer and keyword", () => {
    const diagnostics = normalizeAjvDiagnostics(
      [
        error("z-keyword", "/same"),
        error("a-keyword", "/same"),
        error("type", "/later"),
        error("a-keyword", "/same"),
      ],
      "state.project-config",
      "1.0.0",
      "guard.config_corrupt",
    );

    expect(
      diagnostics.map(({ pointer, keyword }) => [pointer, keyword]),
    ).toEqual([
      ["/later", "type"],
      ["/same", "a-keyword"],
      ["/same", "z-keyword"],
    ]);
  });
});
