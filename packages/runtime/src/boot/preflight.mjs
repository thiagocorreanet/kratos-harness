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

if (atLeast(process.versions.node, MINIMUM)) {
  import("__CORE__").catch(function (error) {
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
