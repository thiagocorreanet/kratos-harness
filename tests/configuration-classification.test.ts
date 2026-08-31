import { describe, expect, it } from "vitest";

import type { ReadableProjectConfig } from "@kratos/contracts";
import { classifyConfiguration } from "@kratos/runtime/domain/project";

describe("configuration classification version migration", () => {
  it("classifies prior state contracts as migration-required and 1.4.0 as valid", () => {
    const outcome11 = classifyConfiguration(
      { kind: "file", text: JSON.stringify({ stateContract: "1.1.0" }) },
      () => ({ kind: "valid", value: {} as ReadableProjectConfig }),
    );
    expect(outcome11.kind).toBe("migration-required");

    const outcome12 = classifyConfiguration(
      { kind: "file", text: JSON.stringify({ stateContract: "1.2.0" }) },
      () => ({ kind: "valid", value: {} as ReadableProjectConfig }),
    );
    expect(outcome12).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    });

    const outcome13 = classifyConfiguration(
      { kind: "file", text: JSON.stringify({ stateContract: "1.3.0" }) },
      () => ({ kind: "valid", value: {} as ReadableProjectConfig }),
    );
    expect(outcome13).toEqual({
      kind: "migration-required",
      reasonCode: "profile.config_migration_required",
    });

    const outcome14 = classifyConfiguration(
      { kind: "file", text: JSON.stringify({ stateContract: "1.4.0" }) },
      () => ({ kind: "valid", value: {} as ReadableProjectConfig }),
    );
    expect(outcome14.kind).toBe("valid");
  });
});
