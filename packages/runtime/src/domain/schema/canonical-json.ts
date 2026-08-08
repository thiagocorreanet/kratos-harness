export class CanonicalJsonError extends Error {
  public constructor() {
    super("Value is not canonical JSON");
    this.name = "CanonicalJsonError";
  }
}

export function canonicalizeJson(value: unknown): string {
  return encode(value, new WeakSet<object>());
}

function encode(value: unknown, active: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError();
      }
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) {
        return encodeArray(value, active);
      }
      if (isPlainJsonObject(value)) {
        return encodeObject(value, active);
      }
      throw new CanonicalJsonError();
    default:
      throw new CanonicalJsonError();
  }
}

function encodeArray(value: unknown[], active: WeakSet<object>): string {
  enter(value, active);
  try {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      entries.push(encode(ownDataProperty(value, index), active));
    }
    return `[${entries.join(",")}]`;
  } finally {
    active.delete(value);
  }
}

function encodeObject(
  value: Record<string, unknown>,
  active: WeakSet<object>,
): string {
  enter(value, active);
  try {
    return `{${unicodeCodePointKeys(value)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${encode(ownDataProperty(value, key), active)}`,
      )
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

/** Read only inert own data without invoking an accessor. */
function ownDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new CanonicalJsonError();
  }
  return descriptor.value;
}

/** Decorate with an ASCII order key so the built-in sort compares code points. */
function unicodeCodePointKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value)
    .map((key) => `${codePointSortKey(key)}\u0000${key}`)
    .sort()
    .map((decorated) => decorated.slice(decorated.indexOf("\u0000") + 1));
}

/** Fixed-width hexadecimal preserves numeric code-point order and prefixes. */
function codePointSortKey(value: string): string {
  return Array.from(value, (character) =>
    codePointOfCharacter(character).toString(16).padStart(6, "0"),
  ).join("");
}

/** `Array.from(string)` yields either one code unit or one surrogate pair. */
function codePointOfCharacter(character: string): number {
  if (character.length === 1) return character.charCodeAt(0);
  return (
    (character.charCodeAt(0) - 0xd800) * 0x400 +
    character.charCodeAt(1) -
    0xdc00 +
    0x10000
  );
}

/**
 * JSON data-model objects have either the ordinary object prototype or no
 * prototype. Other JavaScript object types may hide non-JSON state.
 */
function isPlainJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function enter(value: object, active: WeakSet<object>): void {
  if (active.has(value)) {
    throw new CanonicalJsonError();
  }
  active.add(value);
}
