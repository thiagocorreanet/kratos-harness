import { describe, expect, it } from "vitest";

import { canonicalizeProjectPath } from "@kratos/runtime/domain/paths";

describe("canonicalizeProjectPath", () => {
  it("normalizes a simple relative path", () => {
    expect(canonicalizeProjectPath("src/index.ts")).toEqual({
      kind: "canonical",
      path: "src/index.ts",
    });
  });

  it("collapses single-dot segments and repeated slashes", () => {
    expect(canonicalizeProjectPath("./src/./domain//paths///file.ts")).toEqual({
      kind: "canonical",
      path: "src/domain/paths/file.ts",
    });
  });

  it("resolves parent double-dot segments within the root", () => {
    expect(
      canonicalizeProjectPath("src/domain/../infra/node/index.ts"),
    ).toEqual({
      kind: "canonical",
      path: "src/infra/node/index.ts",
    });
  });

  it("normalizes the project root itself to an empty string", () => {
    expect(canonicalizeProjectPath(".")).toEqual({
      kind: "canonical",
      path: "",
    });
    expect(canonicalizeProjectPath("./")).toEqual({
      kind: "canonical",
      path: "",
    });
    expect(canonicalizeProjectPath("")).toEqual({
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      resolvedPath: "",
    });
  });

  it("refuses a path that climbs above the root with parent segments", () => {
    expect(canonicalizeProjectPath("../outside.txt")).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "../outside.txt",
    });
    expect(canonicalizeProjectPath("src/../../outside.txt")).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "../outside.txt",
    });
  });

  it("resolves an absolute path against the project root if provided", () => {
    expect(
      canonicalizeProjectPath("/project/root/src/file.ts", {
        root: "/project/root",
      }),
    ).toEqual({
      kind: "canonical",
      path: "src/file.ts",
    });
  });

  it("refuses an absolute path outside the project root", () => {
    expect(
      canonicalizeProjectPath("/etc/passwd", {
        root: "/project/root",
      }),
    ).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "/etc/passwd",
    });
  });

  it("refuses paths containing backslashes or drive letters", () => {
    expect(canonicalizeProjectPath("src\\index.ts")).toEqual({
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      resolvedPath: "src\\index.ts",
    });
    expect(canonicalizeProjectPath("C:/project/root/file.ts")).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "C:/project/root/file.ts",
    });
  });

  it("refuses URL schemes and control characters", () => {
    expect(canonicalizeProjectPath("file:///etc/passwd")).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "file:///etc/passwd",
    });
    expect(canonicalizeProjectPath("http://example.com/file.ts")).toEqual({
      kind: "refused",
      reasonCode: "guard.path_escape",
      resolvedPath: "http://example.com/file.ts",
    });
    expect(canonicalizeProjectPath("src/\0file.ts")).toEqual({
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      resolvedPath: "src/\0file.ts",
    });
  });
});
