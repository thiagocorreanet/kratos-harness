import { types } from "node:util";
import { runInNewContext } from "node:vm";

const REGISTRY_INTEGRITY_ERROR = "Embedded schema registry is invalid";
const UNRESOLVED = Symbol("unresolved intrinsic property");

type FunctionToString = (this: unknown) => string;
type IntrinsicFunction = (...args: never[]) => unknown;

interface TrustedIntrinsics {
  readonly arrayConstructor: IntrinsicFunction;
  readonly functionCall: IntrinsicFunction;
  readonly functionPrototype: IntrinsicFunction;
  readonly functionToString: FunctionToString;
  readonly objectPrototype: object;
}

interface ComparedObjects {
  readonly actualToExpected: WeakMap<object, object>;
  readonly expectedToActual: WeakMap<object, object>;
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
    const functionCall = resolveDataProperty(Function.prototype, "call");
    if (functionCall === UNRESOLVED) return false;

    const compared: ComparedObjects = {
      actualToExpected: new WeakMap<object, object>(),
      expectedToActual: new WeakMap<object, object>(),
    };
    return (
      sameIntrinsicValue(
        Object.prototype,
        TRUSTED_INTRINSICS.objectPrototype,
        TRUSTED_INTRINSICS.functionToString,
        compared,
      ) &&
      sameIntrinsicValue(
        Function.prototype,
        TRUSTED_INTRINSICS.functionPrototype,
        TRUSTED_INTRINSICS.functionToString,
        compared,
      ) &&
      sameIntrinsicValue(
        functionCall,
        TRUSTED_INTRINSICS.functionCall,
        TRUSTED_INTRINSICS.functionToString,
        compared,
      ) &&
      sameIntrinsicValue(
        Array,
        TRUSTED_INTRINSICS.arrayConstructor,
        TRUSTED_INTRINSICS.functionToString,
        compared,
      )
    );
  } catch {
    return false;
  }
}

function createTrustedIntrinsics(): TrustedIntrinsics | null {
  try {
    const sandbox = Object.create(null) as Record<string, never>;
    const intrinsics: unknown = runInNewContext(
      "[Object.prototype, Function.prototype, Function.prototype.call, Function.prototype.toString, Array]",
      sandbox,
    );
    if (typeof intrinsics !== "object" || intrinsics === null) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      intrinsics,
      "length",
    );
    if (lengthDescriptor?.value !== 5) return null;
    const objectPrototype: unknown = Object.getOwnPropertyDescriptor(
      intrinsics,
      "0",
    )?.value;
    const functionPrototype: unknown = Object.getOwnPropertyDescriptor(
      intrinsics,
      "1",
    )?.value;
    const functionCall: unknown = Object.getOwnPropertyDescriptor(
      intrinsics,
      "2",
    )?.value;
    const functionToString: unknown = Object.getOwnPropertyDescriptor(
      intrinsics,
      "3",
    )?.value;
    const arrayConstructor: unknown = Object.getOwnPropertyDescriptor(
      intrinsics,
      "4",
    )?.value;
    if (
      typeof objectPrototype !== "object" ||
      objectPrototype === null ||
      typeof functionPrototype !== "function" ||
      typeof functionCall !== "function" ||
      typeof functionToString !== "function" ||
      typeof arrayConstructor !== "function" ||
      types.isProxy(functionPrototype) ||
      types.isProxy(functionCall) ||
      types.isProxy(functionToString) ||
      types.isProxy(arrayConstructor)
    ) {
      return null;
    }
    return {
      arrayConstructor: arrayConstructor as IntrinsicFunction,
      functionCall: functionCall as IntrinsicFunction,
      functionPrototype: functionPrototype as IntrinsicFunction,
      functionToString: functionToString as FunctionToString,
      objectPrototype,
    };
  } catch {
    return null;
  }
}

function resolveDataProperty(value: object, key: PropertyKey): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      const valueDescriptor = Object.getOwnPropertyDescriptor(
        descriptor,
        "value",
      );
      return valueDescriptor === undefined ? UNRESOLVED : valueDescriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return UNRESOLVED;
}

function sameIntrinsicValue(
  actual: unknown,
  expected: unknown,
  functionToString: FunctionToString,
  compared: ComparedObjects,
): boolean {
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === "function" && typeof expected === "function") {
    if (types.isProxy(actual) || types.isProxy(expected)) return false;
    const actualSource: unknown = Reflect.apply(functionToString, actual, []);
    const expectedSource: unknown = Reflect.apply(
      functionToString,
      expected,
      [],
    );
    if (typeof actualSource !== "string" || actualSource !== expectedSource) {
      return false;
    }
    return sameIntrinsicObject(actual, expected, functionToString, compared);
  }
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    return Object.is(actual, expected);
  }
  if (types.isProxy(actual) || types.isProxy(expected)) return false;
  return sameIntrinsicObject(actual, expected, functionToString, compared);
}

function sameIntrinsicObject(
  actual: object,
  expected: object,
  functionToString: FunctionToString,
  compared: ComparedObjects,
): boolean {
  const mappedExpected = compared.actualToExpected.get(actual);
  if (mappedExpected !== undefined) return mappedExpected === expected;
  const mappedActual = compared.expectedToActual.get(expected);
  if (mappedActual !== undefined) return mappedActual === actual;
  compared.actualToExpected.set(actual, expected);
  compared.expectedToActual.set(expected, actual);

  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(expected);
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
      if (Object.is(actualKey, expectedKey)) found = true;
    }
    if (!found) return false;
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    if (key === undefined) return false;
    const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key);
    const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key);
    if (
      !sameIntrinsicDescriptor(
        actualDescriptor,
        expectedDescriptor,
        functionToString,
        compared,
      )
    ) {
      return false;
    }
  }
  /* eslint-enable @typescript-eslint/prefer-for-of */

  return sameIntrinsicValue(
    Object.getPrototypeOf(actual),
    Object.getPrototypeOf(expected),
    functionToString,
    compared,
  );
}

function sameIntrinsicDescriptor(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptor | undefined,
  functionToString: FunctionToString,
  compared: ComparedObjects,
): boolean {
  if (actual === undefined || expected === undefined) return false;
  if (
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }

  const actualIsData =
    Object.getOwnPropertyDescriptor(actual, "value") !== undefined;
  const expectedIsData =
    Object.getOwnPropertyDescriptor(expected, "value") !== undefined;
  if (actualIsData !== expectedIsData) return false;
  if (actualIsData) {
    return (
      actual.writable === expected.writable &&
      sameIntrinsicValue(
        actual.value,
        expected.value,
        functionToString,
        compared,
      )
    );
  }
  const actualGet: unknown = Object.getOwnPropertyDescriptor(
    actual,
    "get",
  )?.value;
  const expectedGet: unknown = Object.getOwnPropertyDescriptor(
    expected,
    "get",
  )?.value;
  const actualSet: unknown = Object.getOwnPropertyDescriptor(
    actual,
    "set",
  )?.value;
  const expectedSet: unknown = Object.getOwnPropertyDescriptor(
    expected,
    "set",
  )?.value;
  return (
    sameIntrinsicValue(actualGet, expectedGet, functionToString, compared) &&
    sameIntrinsicValue(actualSet, expectedSet, functionToString, compared)
  );
}
