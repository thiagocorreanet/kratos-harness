import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import { describe, expect, it } from "vitest";

describe("workflow hook contracts", () => {
  it("publishes every normalized observation and persisted hook record", () => {
    expect(manifest.schemas.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "host.hook-observation",
        "state.failure-candidate",
        "state.run-usage",
        "state.session-telemetry",
      ]),
    );
  });
});
