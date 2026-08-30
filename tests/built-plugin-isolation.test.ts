import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRoot } from "./support/built-plugin.js";

describe("built plugin test isolation", () => {
  it("uses this worker's process-unique temporary build directory", () => {
    expect(buildRoot).toBe(
      join(tmpdir(), `kratos-plugin-vitest-build-${String(process.pid)}`),
    );
  });
});
