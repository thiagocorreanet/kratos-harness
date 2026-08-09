import { types } from "node:util";

import { isObjectPrototypeEnvironmentSafe } from "./prototype-environment.js";

export function isInertJsonData(value: unknown): boolean {
  if (!isObjectPrototypeEnvironmentSafe()) return false;
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
  if (prototype !== Object.prototype && prototype !== null) {
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
