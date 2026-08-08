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
      if (!Object.hasOwn(value, index)) {
        throw new CanonicalJsonError();
      }
      entries.push(encode(value[index], active));
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
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(value[key], active)}`)
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
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
