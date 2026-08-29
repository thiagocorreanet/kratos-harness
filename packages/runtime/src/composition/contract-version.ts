import { types } from "node:util";

/**
 * Reads a declared contract revision without evaluating caller-controlled
 * properties. Structural validation remains responsible for accepting the
 * complete payload after this routing hint is selected.
 *
 * Proxy detection is a Node.js boundary concern. Keeping it in composition
 * preserves the domain's platform independence without weakening the inert
 * input guarantee for hostile and revoked proxies.
 */
export function declaredContractVersion(
  value: unknown,
  property: string,
  fallback: string,
): string {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    Array.isArray(value)
  ) {
    return fallback;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fallback;

  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.enumerable &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : fallback;
}
