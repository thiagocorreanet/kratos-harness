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

function profileValue(value, functionToString, types) {
  if (typeof value === "function") {
    if (types.isProxy(value)) return null;
    try {
      var source = Reflect.apply(functionToString, value, []);
      return typeof source === "string"
        ? { kind: "function", source: source }
        : null;
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
    return { kind: "primitive", value: value };
  }
  return null;
}

function descriptorProfile(descriptor, functionToString, types) {
  if (descriptor === undefined) return null;
  if (Reflect.ownKeys(descriptor).indexOf("value") !== -1) {
    var value = profileValue(descriptor.value, functionToString, types);
    if (value === null || descriptor.writable === undefined) return null;
    return {
      configurable: descriptor.configurable === true,
      enumerable: descriptor.enumerable === true,
      kind: "data",
      value: value,
      writable: descriptor.writable,
    };
  }
  var getter = profileValue(descriptor.get, functionToString, types);
  var setter = profileValue(descriptor.set, functionToString, types);
  if (getter === null || setter === null) return null;
  return {
    configurable: descriptor.configurable === true,
    enumerable: descriptor.enumerable === true,
    get: getter,
    kind: "accessor",
    set: setter,
  };
}

function sameValueProfile(actual, expected) {
  if (actual.kind !== expected.kind) return false;
  return actual.kind === "function"
    ? actual.source === expected.source
    : Object.is(actual.value, expected.value);
}

function sameDescriptorProfile(actual, expected) {
  if (
    actual === null ||
    actual.kind !== expected.kind ||
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }
  return actual.kind === "data"
    ? actual.writable === expected.writable &&
        sameValueProfile(actual.value, expected.value)
    : sameValueProfile(actual.get, expected.get) &&
        sameValueProfile(actual.set, expected.set);
}

function objectPrototypeIsSafe(vm, types) {
  try {
    var intrinsics = vm.runInNewContext(
      "[Object.prototype, Function.prototype.toString]",
      Object.create(null),
    );
    if (
      !Array.isArray(intrinsics) ||
      intrinsics.length !== 2 ||
      typeof intrinsics[0] !== "object" ||
      intrinsics[0] === null ||
      typeof intrinsics[1] !== "function" ||
      types.isProxy(intrinsics[1])
    ) {
      return false;
    }

    var cleanPrototype = intrinsics[0];
    var functionToString = intrinsics[1];
    var cleanKeys = Reflect.ownKeys(cleanPrototype);
    var hostKeys = Reflect.ownKeys(Object.prototype);
    if (cleanKeys.length !== hostKeys.length) return false;

    var expected = new Map();
    for (var index = 0; index < cleanKeys.length; index += 1) {
      var key = cleanKeys[index];
      var cleanDescriptor = Object.getOwnPropertyDescriptor(
        cleanPrototype,
        key,
      );
      var profile = descriptorProfile(cleanDescriptor, functionToString, types);
      if (profile === null) return false;
      expected.set(key, profile);
    }

    for (var hostIndex = 0; hostIndex < hostKeys.length; hostIndex += 1) {
      var hostKey = hostKeys[hostIndex];
      var expectedProfile = expected.get(hostKey);
      if (expectedProfile === undefined) return false;
      var hostDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        hostKey,
      );
      var hostProfile = descriptorProfile(
        hostDescriptor,
        functionToString,
        types,
      );
      if (!sameDescriptorProfile(hostProfile, expectedProfile)) return false;
    }
    return true;
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
