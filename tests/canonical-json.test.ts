import {
  CanonicalJsonError,
  canonicalizeJson,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, it } from "vitest";

describe("canonical JSON", () => {
  class CustomValue {
    public readonly value = 1;
  }

  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalizeJson({ z: 1, a: { y: 2, x: [3, 1] } })).toBe(
      '{"a":{"x":[3,1],"y":2},"z":1}',
    );
  });

  it.each([
    [null, "null"],
    [true, "true"],
    [-0, "0"],
    ["café\n", '"café\\n"'],
  ])("serializes %j deterministically", (value, expected) => {
    expect(canonicalizeJson(value)).toBe(expected);
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol("x"),
    () => 1,
  ])("rejects unsupported scalar %s without exposing it", (value) => {
    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
    expect(() => canonicalizeJson(value)).toThrow(
      "Value is not canonical JSON",
    );
  });

  it("rejects unsupported properties, sparse arrays, and cycles", () => {
    expect(() => canonicalizeJson({ safe: 1, rejected: undefined })).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalizeJson(Array(1))).toThrow(CanonicalJsonError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalizeJson(cycle)).toThrow(CanonicalJsonError);
  });

  it.each([
    new Date(),
    new Map(),
    new CustomValue(),
    new String("value"),
    new Number(1),
    new Boolean(true),
  ])("rejects non-plain object %s", (value) => {
    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
  });

  it("supports null-prototype JSON objects", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.z = 1;
    value.a = true;

    expect(canonicalizeJson(value)).toBe('{"a":true,"z":1}');
  });
});
