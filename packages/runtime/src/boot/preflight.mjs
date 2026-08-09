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

function resolveDataProperty(value, key) {
  var current = value;
  while (current !== null) {
    var descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      return Reflect.ownKeys(descriptor).indexOf("value") !== -1
        ? descriptor.value
        : UNRESOLVED;
    }
    current = Object.getPrototypeOf(current);
  }
  return UNRESOLVED;
}

function sameIntrinsicValue(
  actual,
  expected,
  functionToString,
  types,
  compared,
) {
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === "function") {
    if (types.isProxy(actual) || types.isProxy(expected)) return false;
    var actualSource = Reflect.apply(functionToString, actual, []);
    var expectedSource = Reflect.apply(functionToString, expected, []);
    if (typeof actualSource !== "string" || actualSource !== expectedSource) {
      return false;
    }
    return sameIntrinsicObject(
      actual,
      expected,
      functionToString,
      types,
      compared,
    );
  }
  if (actual === null || expected === null || typeof actual !== "object") {
    return Object.is(actual, expected);
  }
  if (types.isProxy(actual) || types.isProxy(expected)) return false;
  return sameIntrinsicObject(
    actual,
    expected,
    functionToString,
    types,
    compared,
  );
}

function sameIntrinsicObject(
  actual,
  expected,
  functionToString,
  types,
  compared,
) {
  if (compared.actualToExpected.has(actual)) {
    return compared.actualToExpected.get(actual) === expected;
  }
  if (compared.expectedToActual.has(expected)) {
    return compared.expectedToActual.get(expected) === actual;
  }
  compared.actualToExpected.set(actual, expected);
  compared.expectedToActual.set(expected, actual);

  var actualKeys = Reflect.ownKeys(actual);
  var expectedKeys = Reflect.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  for (var actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
    var actualKey = actualKeys[actualIndex];
    var found = false;
    for (
      var expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      if (Object.is(actualKey, expectedKeys[expectedIndex])) found = true;
    }
    if (!found) return false;
  }

  for (var index = 0; index < expectedKeys.length; index += 1) {
    var key = expectedKeys[index];
    if (
      !sameIntrinsicDescriptor(
        Object.getOwnPropertyDescriptor(actual, key),
        Object.getOwnPropertyDescriptor(expected, key),
        functionToString,
        types,
        compared,
      )
    ) {
      return false;
    }
  }
  return sameIntrinsicValue(
    Object.getPrototypeOf(actual),
    Object.getPrototypeOf(expected),
    functionToString,
    types,
    compared,
  );
}

function sameIntrinsicDescriptor(
  actual,
  expected,
  functionToString,
  types,
  compared,
) {
  if (actual === undefined || expected === undefined) return false;
  if (
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }
  var actualIsData = Reflect.ownKeys(actual).indexOf("value") !== -1;
  var expectedIsData = Reflect.ownKeys(expected).indexOf("value") !== -1;
  if (actualIsData !== expectedIsData) return false;
  if (actualIsData) {
    return (
      actual.writable === expected.writable &&
      sameIntrinsicValue(
        actual.value,
        expected.value,
        functionToString,
        types,
        compared,
      )
    );
  }
  var actualGet = Object.getOwnPropertyDescriptor(actual, "get").value;
  var expectedGet = Object.getOwnPropertyDescriptor(expected, "get").value;
  var actualSet = Object.getOwnPropertyDescriptor(actual, "set").value;
  var expectedSet = Object.getOwnPropertyDescriptor(expected, "set").value;
  return (
    sameIntrinsicValue(
      actualGet,
      expectedGet,
      functionToString,
      types,
      compared,
    ) &&
    sameIntrinsicValue(
      actualSet,
      expectedSet,
      functionToString,
      types,
      compared,
    )
  );
}

function objectPrototypeIsSafe(vm, types) {
  try {
    var intrinsics = vm.runInNewContext(
      "[Object.prototype, Function.prototype, Function.prototype.call, Function.prototype.toString]",
      Object.create(null),
    );
    if (
      !Array.isArray(intrinsics) ||
      intrinsics.length !== 4 ||
      typeof intrinsics[0] !== "object" ||
      intrinsics[0] === null ||
      typeof intrinsics[1] !== "function" ||
      typeof intrinsics[2] !== "function" ||
      typeof intrinsics[3] !== "function" ||
      types.isProxy(intrinsics[1]) ||
      types.isProxy(intrinsics[2]) ||
      types.isProxy(intrinsics[3])
    ) {
      return false;
    }

    var functionCall = resolveDataProperty(Function.prototype, "call");
    if (functionCall === UNRESOLVED) return false;
    var compared = {
      actualToExpected: new WeakMap(),
      expectedToActual: new WeakMap(),
    };
    return (
      sameIntrinsicValue(
        Object.prototype,
        intrinsics[0],
        intrinsics[3],
        types,
        compared,
      ) &&
      sameIntrinsicValue(
        Function.prototype,
        intrinsics[1],
        intrinsics[3],
        types,
        compared,
      ) &&
      sameIntrinsicValue(
        functionCall,
        intrinsics[2],
        intrinsics[3],
        types,
        compared,
      )
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
