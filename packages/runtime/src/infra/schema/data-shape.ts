import { types } from "node:util";

const OBJECT_PROTOTYPE_DATA_KEYS = [
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "hasOwnProperty",
  "__lookupGetter__",
  "__lookupSetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "toLocaleString",
] as const;
const OBJECT_PROTOTYPE_ACCESSOR_KEY = "__proto__";
const OBJECT_PROTOTYPE_KEYS = new Set<string>([
  ...OBJECT_PROTOTYPE_DATA_KEYS,
  OBJECT_PROTOTYPE_ACCESSOR_KEY,
]);
const OBJECT_PROTOTYPE_SNAPSHOT = captureObjectPrototype();

export function isInertJsonData(value: unknown): boolean {
  return inspect(value, new WeakSet<object>());
}

function inspect(value: unknown, active: WeakSet<object>): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || types.isProxy(value)) return false;
  if (active.has(value)) return false;

  if (Array.isArray(value)) return inspectArray(value, active);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === Object.prototype) {
    if (!objectPrototypeMatchesSnapshot()) return false;
  } else if (prototype !== null) {
    return false;
  }
  return inspectObject(value as Record<string, unknown>, active);
}

function inspectArray(
  value: readonly unknown[],
  active: WeakSet<object>,
): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;

  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable
  ) {
    return false;
  }
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || keys.length !== length + 1) return false;

  active.add(value);
  try {
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !inspect(descriptor.value, active)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    active.delete(value);
  }
}

function inspectObject(
  value: Record<string, unknown>,
  active: WeakSet<object>,
): boolean {
  active.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !inspect(descriptor.value, active)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    active.delete(value);
  }
}

function captureObjectPrototype(): ReadonlyMap<
  string,
  PropertyDescriptor
> | null {
  const keys = Reflect.ownKeys(Object.prototype);
  if (
    keys.length !== OBJECT_PROTOTYPE_KEYS.size ||
    keys.some(
      (key) => typeof key !== "string" || !OBJECT_PROTOTYPE_KEYS.has(key),
    )
  ) {
    return null;
  }

  const snapshot = new Map<string, PropertyDescriptor>();
  for (const key of OBJECT_PROTOTYPE_DATA_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
    if (!isSafeIntrinsicDataDescriptor(descriptor)) return null;
    snapshot.set(key, descriptor);
  }

  const accessorDescriptor = Object.getOwnPropertyDescriptor(
    Object.prototype,
    OBJECT_PROTOTYPE_ACCESSOR_KEY,
  );
  if (!isSafeIntrinsicAccessorDescriptor(accessorDescriptor)) return null;
  snapshot.set(OBJECT_PROTOTYPE_ACCESSOR_KEY, accessorDescriptor);
  return snapshot;
}

function isSafeIntrinsicDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: (...args: never[]) => unknown } {
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "function" &&
    !types.isProxy(descriptor.value) &&
    descriptor.writable === true &&
    descriptor.enumerable === false &&
    descriptor.configurable === true
  );
}

function isSafeIntrinsicAccessorDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor {
  const getter: unknown =
    descriptor === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(descriptor, "get")?.value;
  const setter: unknown =
    descriptor === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(descriptor, "set")?.value;
  return (
    descriptor !== undefined &&
    !("value" in descriptor) &&
    typeof getter === "function" &&
    !types.isProxy(getter) &&
    typeof setter === "function" &&
    !types.isProxy(setter) &&
    descriptor.enumerable === false &&
    descriptor.configurable === true
  );
}

function objectPrototypeMatchesSnapshot(): boolean {
  if (OBJECT_PROTOTYPE_SNAPSHOT === null) return false;
  const keys = Reflect.ownKeys(Object.prototype);
  if (
    keys.length !== OBJECT_PROTOTYPE_SNAPSHOT.size ||
    keys.some(
      (key) => typeof key !== "string" || !OBJECT_PROTOTYPE_SNAPSHOT.has(key),
    )
  ) {
    return false;
  }

  for (const [key, expected] of OBJECT_PROTOTYPE_SNAPSHOT) {
    const actual = Object.getOwnPropertyDescriptor(Object.prototype, key);
    if (!sameDescriptor(actual, expected)) return false;
  }
  return true;
}

function sameDescriptor(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptor,
): boolean {
  if (
    actual === undefined ||
    actual.enumerable !== expected.enumerable ||
    actual.configurable !== expected.configurable
  ) {
    return false;
  }
  if ("value" in expected) {
    return (
      "value" in actual &&
      actual.value === expected.value &&
      actual.writable === expected.writable
    );
  }
  return (
    !("value" in actual) &&
    actual.get === expected.get &&
    actual.set === expected.set
  );
}
