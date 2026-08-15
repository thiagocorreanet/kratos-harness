import { types } from "node:util";
import { runInNewContext } from "node:vm";

const REGISTRY_INTEGRITY_ERROR = "Embedded schema registry is invalid";
const UNRESOLVED = Symbol("unresolved intrinsic property");

type IntrinsicFunction = (...args: never[]) => unknown;
type TrustedFunctionSource = (value: unknown) => unknown;
type TrustedGetOwnPropertyDescriptor = (
  value: object,
  key: PropertyKey,
) => PropertyDescriptor | undefined;
type TrustedGetPrototypeOf = (value: object) => object | null;
type TrustedIs = (left: unknown, right: unknown) => boolean;
type TrustedOwnKeys = (value: object) => PropertyKey[];

interface TrustedIntrinsics {
  readonly arrayConstructor: IntrinsicFunction;
  readonly functionCall: IntrinsicFunction;
  readonly functionPrototype: IntrinsicFunction;
  readonly functionSource: TrustedFunctionSource;
  readonly getOwnPropertyDescriptor: TrustedGetOwnPropertyDescriptor;
  readonly getPrototypeOf: TrustedGetPrototypeOf;
  readonly is: TrustedIs;
  readonly objectPrototype: object;
  readonly ownKeys: TrustedOwnKeys;
  readonly reflectObject: object;
}

interface ComparedPair {
  readonly actual: object;
  readonly expected: object;
  readonly previous: ComparedPair | null;
}

interface ComparedObjects {
  head: ComparedPair | null;
}

const TRUSTED_INTRINSICS = createTrustedIntrinsics();

export function assertObjectPrototypeEnvironmentSafe(): void {
  if (!isObjectPrototypeEnvironmentSafe()) {
    throw new Error(REGISTRY_INTEGRITY_ERROR);
  }
}

export function isObjectPrototypeEnvironmentSafe(): boolean {
  if (TRUSTED_INTRINSICS === null) return false;
  try {
    const functionCall = resolveDataProperty(
      Function.prototype,
      "call",
      TRUSTED_INTRINSICS,
    );
    if (functionCall === UNRESOLVED) return false;

    const compared: ComparedObjects = { head: null };
    return (
      sameIntrinsicValue(
        Object.prototype,
        TRUSTED_INTRINSICS.objectPrototype,
        TRUSTED_INTRINSICS,
        compared,
      ) &&
      sameIntrinsicValue(
        Function.prototype,
        TRUSTED_INTRINSICS.functionPrototype,
        TRUSTED_INTRINSICS,
        compared,
      ) &&
      sameIntrinsicValue(
        functionCall,
        TRUSTED_INTRINSICS.functionCall,
        TRUSTED_INTRINSICS,
        compared,
      ) &&
      sameIntrinsicValue(
        Array,
        TRUSTED_INTRINSICS.arrayConstructor,
        TRUSTED_INTRINSICS,
        compared,
      ) &&
      sameIntrinsicValue(
        Reflect,
        TRUSTED_INTRINSICS.reflectObject,
        TRUSTED_INTRINSICS,
        compared,
      )
    );
  } catch {
    return false;
  }
}

function createTrustedIntrinsics(): TrustedIntrinsics | null {
  try {
    const intrinsics: unknown = runInNewContext(
      `
        (function () {
          var apply = Reflect.apply;
          var functionToString = Function.prototype.toString;
          var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
          var getPrototypeOf = Object.getPrototypeOf;
          var is = Object.is;
          var ownKeys = Reflect.ownKeys;
          return [
            Object.prototype,
            Function.prototype,
            Function.prototype.call,
            Array,
            function (value) {
              return apply(functionToString, value, []);
            },
            function (value, key) {
              return getOwnPropertyDescriptor(value, key);
            },
            function (value) {
              return getPrototypeOf(value);
            },
            function (left, right) {
              return is(left, right);
            },
            function (value) {
              return ownKeys(value);
            },
            Reflect,
          ];
        })()
      `,
    );
    if (typeof intrinsics !== "object" || intrinsics === null) return null;
    const trusted = intrinsics as Readonly<Record<number | "length", unknown>>;
    if (trusted.length !== 10) return null;
    const objectPrototype = trusted[0];
    const functionPrototype = trusted[1];
    const functionCall = trusted[2];
    const arrayConstructor = trusted[3];
    const functionSource = trusted[4];
    const getOwnPropertyDescriptor = trusted[5];
    const getPrototypeOf = trusted[6];
    const is = trusted[7];
    const ownKeys = trusted[8];
    const reflectObject = trusted[9];
    if (
      typeof objectPrototype !== "object" ||
      objectPrototype === null ||
      typeof functionPrototype !== "function" ||
      typeof functionCall !== "function" ||
      typeof arrayConstructor !== "function" ||
      typeof functionSource !== "function" ||
      typeof getOwnPropertyDescriptor !== "function" ||
      typeof getPrototypeOf !== "function" ||
      typeof is !== "function" ||
      typeof ownKeys !== "function" ||
      typeof reflectObject !== "object" ||
      reflectObject === null ||
      types.isProxy(functionPrototype) ||
      types.isProxy(functionCall) ||
      types.isProxy(arrayConstructor) ||
      types.isProxy(functionSource) ||
      types.isProxy(getOwnPropertyDescriptor) ||
      types.isProxy(getPrototypeOf) ||
      types.isProxy(is) ||
      types.isProxy(ownKeys) ||
      types.isProxy(reflectObject)
    ) {
      return null;
    }
    return {
      arrayConstructor: arrayConstructor as IntrinsicFunction,
      functionCall: functionCall as IntrinsicFunction,
      functionPrototype: functionPrototype as IntrinsicFunction,
      functionSource: functionSource as TrustedFunctionSource,
      getOwnPropertyDescriptor:
        getOwnPropertyDescriptor as TrustedGetOwnPropertyDescriptor,
      getPrototypeOf: getPrototypeOf as TrustedGetPrototypeOf,
      is: is as TrustedIs,
      objectPrototype,
      ownKeys: ownKeys as TrustedOwnKeys,
      reflectObject,
    };
  } catch {
    return null;
  }
}

function resolveDataProperty(
  value: object,
  key: PropertyKey,
  trusted: TrustedIntrinsics,
): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = trusted.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      const valueDescriptor = trusted.getOwnPropertyDescriptor(
        descriptor,
        "value",
      );
      return valueDescriptor === undefined ? UNRESOLVED : valueDescriptor.value;
    }
    current = trusted.getPrototypeOf(current);
  }
  return UNRESOLVED;
}

function sameIntrinsicValue(
  actual: unknown,
  expected: unknown,
  trusted: TrustedIntrinsics,
  compared: ComparedObjects,
): boolean {
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === "function" && typeof expected === "function") {
    if (types.isProxy(actual) || types.isProxy(expected)) return false;
    const actualSource = trusted.functionSource(actual);
    const expectedSource = trusted.functionSource(expected);
    if (typeof actualSource !== "string" || actualSource !== expectedSource) {
      return false;
    }
    return sameIntrinsicObject(actual, expected, trusted, compared);
  }
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    return trusted.is(actual, expected);
  }
  if (types.isProxy(actual) || types.isProxy(expected)) return false;
  return sameIntrinsicObject(actual, expected, trusted, compared);
}

function sameIntrinsicObject(
  actual: object,
  expected: object,
  trusted: TrustedIntrinsics,
  compared: ComparedObjects,
): boolean {
  let pair = compared.head;
  while (pair !== null) {
    if (pair.actual === actual) return pair.expected === expected;
    if (pair.expected === expected) return pair.actual === actual;
    pair = pair.previous;
  }
  compared.head = { actual, expected, previous: compared.head };

  const actualKeys = trusted.ownKeys(actual);
  const expectedKeys = trusted.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  // Indexed loops deliberately avoid consulting a potentially polluted
  // Array.prototype iterator before the intrinsic comparison rejects it.
  /* eslint-disable @typescript-eslint/prefer-for-of */
  for (let actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
    const actualKey = actualKeys[actualIndex];
    let found = false;
    for (
      let expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      const expectedKey = expectedKeys[expectedIndex];
      if (trusted.is(actualKey, expectedKey)) found = true;
    }
    if (!found) return false;
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    // Reflect.ownKeys returns a dense PropertyKey array.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-proxy own keys cannot disappear during synchronous inspection
    const key = expectedKeys[index]!;
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- non-proxy own keys cannot disappear during synchronous inspection
    const actualDescriptor = trusted.getOwnPropertyDescriptor(
      actual,
      key,
    ) as PropertyDescriptor;
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- non-proxy own keys cannot disappear during synchronous inspection
    const expectedDescriptor = trusted.getOwnPropertyDescriptor(
      expected,
      key,
    ) as PropertyDescriptor;
    if (
      !sameIntrinsicDescriptor(
        actualDescriptor,
        expectedDescriptor,
        trusted,
        compared,
      )
    ) {
      return false;
    }
  }
  /* eslint-enable @typescript-eslint/prefer-for-of */

  return sameIntrinsicValue(
    trusted.getPrototypeOf(actual),
    trusted.getPrototypeOf(expected),
    trusted,
    compared,
  );
}

function sameIntrinsicDescriptor(
  actual: PropertyDescriptor,
  expected: PropertyDescriptor,
  trusted: TrustedIntrinsics,
  compared: ComparedObjects,
): boolean {
  if (
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }

  const actualIsData =
    trusted.getOwnPropertyDescriptor(actual, "value") !== undefined;
  const expectedIsData =
    trusted.getOwnPropertyDescriptor(expected, "value") !== undefined;
  if (actualIsData !== expectedIsData) return false;
  if (actualIsData) {
    return (
      actual.writable === expected.writable &&
      sameIntrinsicValue(actual.value, expected.value, trusted, compared)
    );
  }
  const actualGet: unknown = trusted.getOwnPropertyDescriptor(
    actual,
    "get",
  )?.value;
  const expectedGet: unknown = trusted.getOwnPropertyDescriptor(
    expected,
    "get",
  )?.value;
  const actualSet: unknown = trusted.getOwnPropertyDescriptor(
    actual,
    "set",
  )?.value;
  const expectedSet: unknown = trusted.getOwnPropertyDescriptor(
    expected,
    "set",
  )?.value;
  return (
    sameIntrinsicValue(actualGet, expectedGet, trusted, compared) &&
    sameIntrinsicValue(actualSet, expectedSet, trusted, compared)
  );
}
