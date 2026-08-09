#!/usr/bin/env node
// Plugin runtime entry point.
//
// The build substitutes the interpreter floor, the catalog summary and recovery
// text, and the core path into this file. Those markers are deliberately not
// named here: naming them would substitute this very comment and leave the
// shipped artifact describing itself incoherently.
//
// It deliberately uses only syntax valid on Node 12 and is never transpiled. A
// module is parsed in full before any of it runs, so a version guard sharing a
// file with modern syntax would never execute: the parser would reject the file
// first and the caller would see a SyntaxError instead of a structured result.
// That is why the runtime boots in two files.
"use strict";

var MINIMUM = "__MINIMUM_NODE__";

function atLeast(actual, minimum) {
  var left = String(actual).split(".");
  var right = String(minimum).split(".");
  for (var index = 0; index < 3; index += 1) {
    var current = parseInt(left[index], 10);
    var required = parseInt(right[index], 10);
    if (isNaN(current)) return false;
    if (current > required) return true;
    if (current < required) return false;
  }
  // A prerelease of the minimum precedes it and is not supported.
  return String(actual).indexOf("-") === -1;
}

var UNRESOLVED = {};

function resolveDataProperty(value, key, trusted) {
  var current = value;
  while (current !== null) {
    var descriptor = trusted.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      var valueDescriptor = trusted.getOwnPropertyDescriptor(
        descriptor,
        "value",
      );
      return valueDescriptor === undefined ? UNRESOLVED : valueDescriptor.value;
    }
    current = trusted.getPrototypeOf(current);
  }
  return UNRESOLVED;
}

function sameIntrinsicValue(actual, expected, trusted, types, compared) {
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === "function") {
    if (types.isProxy(actual) || types.isProxy(expected)) return false;
    var actualSource = trusted.functionSource(actual);
    var expectedSource = trusted.functionSource(expected);
    if (typeof actualSource !== "string" || actualSource !== expectedSource) {
      return false;
    }
    return sameIntrinsicObject(actual, expected, trusted, types, compared);
  }
  if (actual === null || expected === null || typeof actual !== "object") {
    return trusted.is(actual, expected);
  }
  if (types.isProxy(actual) || types.isProxy(expected)) return false;
  return sameIntrinsicObject(actual, expected, trusted, types, compared);
}

function sameIntrinsicObject(actual, expected, trusted, types, compared) {
  var pair = compared.head;
  while (pair !== null) {
    if (pair.actual === actual) return pair.expected === expected;
    if (pair.expected === expected) return pair.actual === actual;
    pair = pair.previous;
  }
  compared.head = {
    actual: actual,
    expected: expected,
    previous: compared.head,
  };

  var actualKeys = trusted.ownKeys(actual);
  var expectedKeys = trusted.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  for (var actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
    var actualKey = actualKeys[actualIndex];
    var found = false;
    for (
      var expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      if (trusted.is(actualKey, expectedKeys[expectedIndex])) found = true;
    }
    if (!found) return false;
  }

  for (var index = 0; index < expectedKeys.length; index += 1) {
    var key = expectedKeys[index];
    if (
      !sameIntrinsicDescriptor(
        trusted.getOwnPropertyDescriptor(actual, key),
        trusted.getOwnPropertyDescriptor(expected, key),
        trusted,
        types,
        compared,
      )
    ) {
      return false;
    }
  }
  return sameIntrinsicValue(
    trusted.getPrototypeOf(actual),
    trusted.getPrototypeOf(expected),
    trusted,
    types,
    compared,
  );
}

function sameIntrinsicDescriptor(actual, expected, trusted, types, compared) {
  if (
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }
  var actualIsData =
    trusted.getOwnPropertyDescriptor(actual, "value") !== undefined;
  var expectedIsData =
    trusted.getOwnPropertyDescriptor(expected, "value") !== undefined;
  if (actualIsData !== expectedIsData) return false;
  if (actualIsData) {
    return (
      actual.writable === expected.writable &&
      sameIntrinsicValue(actual.value, expected.value, trusted, types, compared)
    );
  }
  var actualGet = trusted.getOwnPropertyDescriptor(actual, "get").value;
  var expectedGet = trusted.getOwnPropertyDescriptor(expected, "get").value;
  var actualSet = trusted.getOwnPropertyDescriptor(actual, "set").value;
  var expectedSet = trusted.getOwnPropertyDescriptor(expected, "set").value;
  return (
    sameIntrinsicValue(actualGet, expectedGet, trusted, types, compared) &&
    sameIntrinsicValue(actualSet, expectedSet, trusted, types, compared)
  );
}

function objectPrototypeIsSafe(vm, types) {
  try {
    var intrinsics = vm.runInNewContext(
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
    if (
      typeof intrinsics !== "object" ||
      intrinsics === null ||
      intrinsics.length !== 10
    ) {
      return false;
    }
    var objectPrototype = intrinsics[0];
    var functionPrototype = intrinsics[1];
    var functionCallIntrinsic = intrinsics[2];
    var arrayConstructor = intrinsics[3];
    var functionSource = intrinsics[4];
    var getOwnPropertyDescriptor = intrinsics[5];
    var getPrototypeOf = intrinsics[6];
    var is = intrinsics[7];
    var ownKeys = intrinsics[8];
    var reflectObject = intrinsics[9];
    if (
      typeof objectPrototype !== "object" ||
      objectPrototype === null ||
      typeof functionPrototype !== "function" ||
      typeof functionCallIntrinsic !== "function" ||
      typeof arrayConstructor !== "function" ||
      typeof functionSource !== "function" ||
      typeof getOwnPropertyDescriptor !== "function" ||
      typeof getPrototypeOf !== "function" ||
      typeof is !== "function" ||
      typeof ownKeys !== "function" ||
      typeof reflectObject !== "object" ||
      reflectObject === null ||
      types.isProxy(functionPrototype) ||
      types.isProxy(functionCallIntrinsic) ||
      types.isProxy(arrayConstructor) ||
      types.isProxy(functionSource) ||
      types.isProxy(getOwnPropertyDescriptor) ||
      types.isProxy(getPrototypeOf) ||
      types.isProxy(is) ||
      types.isProxy(ownKeys) ||
      types.isProxy(reflectObject)
    ) {
      return false;
    }

    var trusted = {
      functionSource: functionSource,
      getOwnPropertyDescriptor: getOwnPropertyDescriptor,
      getPrototypeOf: getPrototypeOf,
      is: is,
      ownKeys: ownKeys,
    };
    var functionCall = resolveDataProperty(Function.prototype, "call", trusted);
    if (functionCall === UNRESOLVED) return false;
    var compared = { head: null };
    return (
      sameIntrinsicValue(
        Object.prototype,
        objectPrototype,
        trusted,
        types,
        compared,
      ) &&
      sameIntrinsicValue(
        Function.prototype,
        functionPrototype,
        trusted,
        types,
        compared,
      ) &&
      sameIntrinsicValue(
        functionCall,
        functionCallIntrinsic,
        trusted,
        types,
        compared,
      ) &&
      sameIntrinsicValue(Array, arrayConstructor, trusted, types, compared) &&
      sameIntrinsicValue(Reflect, reflectObject, trusted, types, compared)
    );
  } catch {
    return false;
  }
}

function loadCore() {
  return Promise.all([import("node:vm"), import("node:util")]).then(
    function (modules) {
      if (!objectPrototypeIsSafe(modules[0], modules[1].types)) {
        throw new Error("Embedded schema registry is invalid");
      }
      return import("__CORE__");
    },
  );
}

if (atLeast(process.versions.node, MINIMUM)) {
  loadCore().catch(function (error) {
    // Only a genuinely missing or unloadable core is reported here. Anything
    // the core threw while running is re-raised, because swallowing it would
    // leave a real crash with no diagnostic at all.
    if (
      error === null ||
      typeof error !== "object" ||
      (error.code !== "ERR_MODULE_NOT_FOUND" &&
        error.code !== "ERR_UNSUPPORTED_DIR_IMPORT" &&
        !(error instanceof SyntaxError))
    ) {
      throw error;
    }
    process.stderr.write("The Yoda runtime could not be loaded.\n");
    process.exitCode = 2;
  });
} else {
  process.stdout.write(
    JSON.stringify({
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "runtime.node_unsupported",
      summary: "__SUMMARY__",
      why: ["The plugin runtime requires a newer Node.js interpreter."],
      evidence: [],
      stateChanged: false,
      retryable: false,
      recovery: "__RECOVERY__",
    }) + "\n",
  );
  process.exitCode = 2;
}
