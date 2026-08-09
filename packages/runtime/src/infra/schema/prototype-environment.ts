import { types } from "node:util";
import { runInNewContext } from "node:vm";

const REGISTRY_INTEGRITY_ERROR = "Embedded schema registry is invalid";

type ValueProfile =
  | { readonly kind: "function"; readonly source: string }
  | {
      readonly kind: "primitive";
      readonly value: boolean | null | number | string | undefined;
    };

type DescriptorProfile =
  | {
      readonly configurable: boolean;
      readonly enumerable: boolean;
      readonly kind: "data";
      readonly value: ValueProfile;
      readonly writable: boolean;
    }
  | {
      readonly configurable: boolean;
      readonly enumerable: boolean;
      readonly get: ValueProfile;
      readonly kind: "accessor";
      readonly set: ValueProfile;
    };

type FunctionToString = (this: unknown) => string;

interface TrustedProfile {
  readonly descriptors: ReadonlyMap<PropertyKey, DescriptorProfile>;
  readonly functionToString: FunctionToString;
}

const TRUSTED_PROFILE = createTrustedProfile();

export function assertObjectPrototypeEnvironmentSafe(): void {
  if (!isObjectPrototypeEnvironmentSafe()) {
    throw new Error(REGISTRY_INTEGRITY_ERROR);
  }
}

export function isObjectPrototypeEnvironmentSafe(): boolean {
  if (TRUSTED_PROFILE === null) return false;
  const keys = Reflect.ownKeys(Object.prototype);
  if (
    keys.length !== TRUSTED_PROFILE.descriptors.size ||
    keys.some((key) => !TRUSTED_PROFILE.descriptors.has(key))
  ) {
    return false;
  }

  for (const [key, expected] of TRUSTED_PROFILE.descriptors) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
    const actual = descriptorProfile(
      descriptor,
      TRUSTED_PROFILE.functionToString,
    );
    if (actual === null || !sameDescriptorProfile(actual, expected)) {
      return false;
    }
  }
  return true;
}

function createTrustedProfile(): TrustedProfile | null {
  try {
    const sandbox = Object.create(null) as Record<string, never>;
    const intrinsics: unknown = runInNewContext(
      "[Object.prototype, Function.prototype.toString]",
      sandbox,
    );
    if (!Array.isArray(intrinsics) || intrinsics.length !== 2) return null;
    const objectPrototype: unknown = intrinsics[0];
    const functionToString: unknown = intrinsics[1];
    if (
      typeof objectPrototype !== "object" ||
      objectPrototype === null ||
      typeof functionToString !== "function" ||
      types.isProxy(functionToString)
    ) {
      return null;
    }

    const trustedFunctionToString = functionToString as FunctionToString;
    const descriptors = new Map<PropertyKey, DescriptorProfile>();
    for (const key of Reflect.ownKeys(objectPrototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(objectPrototype, key);
      const profile = descriptorProfile(descriptor, trustedFunctionToString);
      if (profile === null) return null;
      descriptors.set(key, profile);
    }
    return { descriptors, functionToString: trustedFunctionToString };
  } catch {
    return null;
  }
}

function descriptorProfile(
  descriptor: PropertyDescriptor | undefined,
  functionToString: FunctionToString,
): DescriptorProfile | null {
  if (descriptor === undefined) return null;
  const descriptorKeys = Reflect.ownKeys(descriptor);
  if (descriptorKeys.includes("value")) {
    const value: unknown = descriptor.value;
    const valueProfile = profileValue(value, functionToString);
    if (valueProfile === null || descriptor.writable === undefined) return null;
    return {
      configurable: descriptor.configurable === true,
      enumerable: descriptor.enumerable === true,
      kind: "data",
      value: valueProfile,
      writable: descriptor.writable,
    };
  }

  const getter: unknown = Object.getOwnPropertyDescriptor(
    descriptor,
    "get",
  )?.value;
  const setter: unknown = Object.getOwnPropertyDescriptor(
    descriptor,
    "set",
  )?.value;
  const getProfile = profileValue(getter, functionToString);
  const setProfile = profileValue(setter, functionToString);
  if (getProfile === null || setProfile === null) return null;
  return {
    configurable: descriptor.configurable === true,
    enumerable: descriptor.enumerable === true,
    get: getProfile,
    kind: "accessor",
    set: setProfile,
  };
}

function profileValue(
  value: unknown,
  functionToString: FunctionToString,
): ValueProfile | null {
  if (typeof value === "function") {
    if (types.isProxy(value)) return null;
    try {
      const source: unknown = Reflect.apply(functionToString, value, []);
      return typeof source === "string" ? { kind: "function", source } : null;
    } catch {
      return null;
    }
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { kind: "primitive", value };
  }
  return null;
}

function sameDescriptorProfile(
  actual: DescriptorProfile,
  expected: DescriptorProfile,
): boolean {
  if (
    actual.kind !== expected.kind ||
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }
  if (actual.kind === "data" && expected.kind === "data") {
    return (
      actual.writable === expected.writable &&
      sameValueProfile(actual.value, expected.value)
    );
  }
  if (actual.kind === "accessor" && expected.kind === "accessor") {
    return (
      sameValueProfile(actual.get, expected.get) &&
      sameValueProfile(actual.set, expected.set)
    );
  }
  return false;
}

function sameValueProfile(
  actual: ValueProfile,
  expected: ValueProfile,
): boolean {
  if (actual.kind !== expected.kind) return false;
  if (actual.kind === "function" && expected.kind === "function") {
    return actual.source === expected.source;
  }
  if (actual.kind === "primitive" && expected.kind === "primitive") {
    return Object.is(actual.value, expected.value);
  }
  return false;
}
