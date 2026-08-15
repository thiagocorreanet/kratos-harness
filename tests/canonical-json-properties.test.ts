import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { describe, expect, it } from "vitest";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function createGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

function generateUnicodeString(next: () => number): string {
  const characters = ["a", "é", "中", "😀", "\\", "\n", "\u0000"];
  const length = next() % 6;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += characters[next() % characters.length] ?? "";
  }
  return value;
}

function generateJsonValue(next: () => number, depth: number): JsonValue {
  const kind = depth === 4 ? next() % 4 : next() % 6;
  switch (kind) {
    case 0:
      return null;
    case 1:
      return next() % 2 === 0;
    case 2:
      return (next() % 2_000_001) - 1_000_000;
    case 3:
      return generateUnicodeString(next);
    case 4: {
      const length = next() % 5;
      const values: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        values.push(generateJsonValue(next, depth + 1));
      }
      return values;
    }
    default: {
      const keys = ["z", "a", "é", "中", "😀", "\uE000", "\u{10000}"];
      const length = next() % keys.length;
      const value: Record<string, JsonValue> = {};
      for (let index = 0; index < length; index += 1) {
        const key = keys[(next() + index) % keys.length] ?? "";
        value[key] = generateJsonValue(next, depth + 1);
      }
      return value;
    }
  }
}

function reverseObjectInsertionOrder(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(reverseObjectInsertionOrder);
  }
  if (value !== null && typeof value === "object") {
    const objectValue = value as Readonly<Record<string, JsonValue>>;
    const reversed: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(objectValue).reverse()) {
      reversed[key] = reverseObjectInsertionOrder(child);
    }
    return reversed;
  }
  return value;
}

describe("canonical JSON properties", () => {
  it("is idempotent and independent from object insertion order", () => {
    const next = createGenerator(0x19c0ffee);
    const values: JsonValue[] = [
      { "\u{10000}": { nested: true }, "\uE000": [1, 2] },
      ...Array.from({ length: 200 }, () => generateJsonValue(next, 0)),
    ];

    for (const value of values) {
      const encoded = canonicalizeJson(value);
      expect(canonicalizeJson(JSON.parse(encoded) as unknown)).toBe(encoded);
      expect(canonicalizeJson(reverseObjectInsertionOrder(value))).toBe(
        encoded,
      );
    }
  });
});
