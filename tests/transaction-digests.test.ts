import { describe, expect, expectTypeOf, it } from "vitest";

import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import type {
  DurableEntry,
  DurableFileSystem,
  Digests,
} from "@kratos/runtime/ports";

type ExpectedDurableEntry =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" | "symlink" | "special" }
  | { readonly kind: "file"; readonly size: number; readonly sha256: string };

describe("transaction port vocabulary", () => {
  it("exports the closed durable entry union", () => {
    expectTypeOf<DurableEntry>().toEqualTypeOf<ExpectedDurableEntry>();
  });

  it("exports every narrow durable filesystem primitive", () => {
    expectTypeOf<DurableFileSystem["inspect"]>().toEqualTypeOf<
      (path: string) => Promise<DurableEntry>
    >();
    expectTypeOf<DurableFileSystem["list"]>().toEqualTypeOf<
      (path: string) => Promise<readonly string[]>
    >();
    expectTypeOf<DurableFileSystem["readText"]>().toEqualTypeOf<
      (path: string) => Promise<string>
    >();
    expectTypeOf<DurableFileSystem["createDirectory"]>().toEqualTypeOf<
      (path: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["createDirectoryExclusive"]>().toEqualTypeOf<
      (path: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["writeSynced"]>().toEqualTypeOf<
      (path: string, content: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["replaceFile"]>().toEqualTypeOf<
      (stagedPath: string, targetPath: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["removeFile"]>().toEqualTypeOf<
      (path: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["removeEmptyDirectory"]>().toEqualTypeOf<
      (path: string) => Promise<void>
    >();
    expectTypeOf<DurableFileSystem["syncDirectory"]>().toEqualTypeOf<
      (path: string) => Promise<"supported" | "unsupported">
    >();
  });

  it("exports the injected digest capability", () => {
    expectTypeOf<Digests["sha256"]>().toEqualTypeOf<(text: string) => string>();
  });
});

describe("SHA-256 digest adapter", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "café",
      "850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e",
    ],
  ])("hashes the UTF-8 text %j", (text, expected) => {
    expect(sha256Digests().sha256(text)).toBe(expected);
  });

  it("returns lowercase fixed-width digests deterministically", () => {
    const digests = sha256Digests();
    const first = digests.sha256("repeatable");

    expect(digests.sha256("repeatable")).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });
});
