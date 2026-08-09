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

  it("sorts object keys lexicographically by Unicode code point", () => {
    const privateUse = "\uE000";
    const supplementary = "\u{10000}";
    const expected = `{"${privateUse}":1,"${supplementary}":2}`;

    expect(canonicalizeJson({ [supplementary]: 2, [privateUse]: 1 })).toBe(
      expected,
    );
    expect(canonicalizeJson({ [privateUse]: 1, [supplementary]: 2 })).toBe(
      expected,
    );
  });

  it("rejects an object getter without evaluating it", () => {
    let calls = 0;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, "observed", {
      enumerable: true,
      get: () => {
        calls += 1;
        return "must not be read";
      },
    });

    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
    expect(calls).toBe(0);
  });

  it("rejects an array index getter without evaluating it", () => {
    let calls = 0;
    const value = [0];
    Object.defineProperty(value, 0, {
      enumerable: true,
      get: () => {
        calls += 1;
        return 1;
      },
    });

    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
    expect(calls).toBe(0);
  });

  it("never observes a changing getter", () => {
    let calls = 0;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, "changing", {
      enumerable: true,
      get: () => {
        calls += 1;
        return calls;
      },
    });

    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
    expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
    expect(calls).toBe(0);
  });

  it("does not leak or execute a throwing getter", () => {
    const secret = "getter secret must not escape";
    let calls = 0;
    let error: unknown;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, "throwing", {
      enumerable: true,
      get: () => {
        calls += 1;
        throw new Error(secret);
      },
    });

    try {
      canonicalizeJson(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CanonicalJsonError);
    expect(error instanceof Error ? error.message : String(error)).toBe(
      "Value is not canonical JSON",
    );
    expect(
      error instanceof Error ? error.message : String(error),
    ).not.toContain(secret);
    expect(calls).toBe(0);
  });

  it("encodes own data descriptors on arrays and null-prototype objects", () => {
    const object = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(object, "z", { enumerable: true, value: 2 });
    Object.defineProperty(object, "a", { enumerable: true, value: 1 });
    const array: unknown[] = [];
    Object.defineProperty(array, 0, { enumerable: true, value: object });

    expect(canonicalizeJson(array)).toBe('[{"a":1,"z":2}]');
  });

  it("ignores symbol and non-enumerable accessors without evaluating them", () => {
    let calls = 0;
    const value = { visible: true };
    const accessor = {
      get: () => {
        calls += 1;
        return "ignored";
      },
    };
    Object.defineProperty(value, "hidden", accessor);
    Object.defineProperty(value, Symbol("hidden"), accessor);

    expect(canonicalizeJson(value)).toBe('{"visible":true}');
    expect(calls).toBe(0);
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
