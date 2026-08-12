import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import {
  compareGitPaths,
  decodeGitPath,
} from "../packages/runtime/src/domain/git/paths.js";

const digests = sha256Digests();
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("decodeGitPath", () => {
  it("decodes valid UTF-8 as text", () => {
    expect(decodeGitPath(utf8("src/a.ts"), digests)).toEqual({
      kind: "text",
      value: "src/a.ts",
    });
  });

  it("decodes a name containing a newline", () => {
    expect(decodeGitPath(utf8("odd\nname.txt"), digests)).toEqual({
      kind: "text",
      value: "odd\nname.txt",
    });
  });

  it("decodes non-ASCII Unicode", () => {
    // Multi-byte sequences at two lengths: two-byte Latin-1 supplement and
    // three-byte CJK.
    expect(decodeGitPath(utf8("café/naïve/文書.md"), digests)).toEqual({
      kind: "text",
      value: "café/naïve/文書.md",
    });
  });

  it("classifies invalid UTF-8 as undecodable without inventing a name", () => {
    // 0xFF is never valid in UTF-8.
    const path = decodeGitPath(bytes(0x61, 0xff, 0x62), digests);

    expect(path.kind).toBe("undecodable");
    if (path.kind !== "undecodable") throw new Error("unreachable");
    expect(path.bytes).toBe(3);
    expect(path.sha256).toBe(digests.sha256Bytes(bytes(0x61, 0xff, 0x62)));
  });

  it("never yields the replacement character from undecodable bytes", () => {
    const path = decodeGitPath(bytes(0xff, 0xfe), digests);

    expect(JSON.stringify(path)).not.toContain("�");
  });

  it("distinguishes two different undecodable paths", () => {
    const left = decodeGitPath(bytes(0xff, 0x01), digests);
    const right = decodeGitPath(bytes(0xff, 0x02), digests);

    expect(left).not.toEqual(right);
  });
});

describe("compareGitPaths", () => {
  it("orders text paths by UTF-8 bytes, not by locale", () => {
    // Locale collation places "a" before "B"; byte order does not.
    const sorted = [utf8("a.txt"), utf8("B.txt")]
      .map((value) => decodeGitPath(value, digests))
      .sort(compareGitPaths);

    expect(sorted).toEqual([
      { kind: "text", value: "B.txt" },
      { kind: "text", value: "a.txt" },
    ]);
  });

  it("is antisymmetric", () => {
    const left = decodeGitPath(utf8("a"), digests);
    const right = decodeGitPath(utf8("b"), digests);

    expect(Math.sign(compareGitPaths(left, right))).toBe(
      -Math.sign(compareGitPaths(right, left)),
    );
  });

  it("reports equal paths as equal", () => {
    const left = decodeGitPath(utf8("same"), digests);
    const right = decodeGitPath(utf8("same"), digests);

    expect(compareGitPaths(left, right)).toBe(0);
  });

  it("orders every undecodable path after every text path", () => {
    const text = decodeGitPath(utf8("zzz"), digests);
    const undecodable = decodeGitPath(bytes(0xff), digests);

    expect(compareGitPaths(text, undecodable)).toBeLessThan(0);
    expect(compareGitPaths(undecodable, text)).toBeGreaterThan(0);
  });

  it("orders undecodable paths against each other by digest", () => {
    const left = decodeGitPath(bytes(0xff, 0x01), digests);
    const right = decodeGitPath(bytes(0xff, 0x02), digests);

    expect(Math.sign(compareGitPaths(left, right))).not.toBe(0);
  });
});
