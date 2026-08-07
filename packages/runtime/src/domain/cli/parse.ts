import { USAGE_WHY, usageFailure, type Result } from "../result/index.js";

import type { Globals } from "./spec.js";

export interface GlobalParse {
  readonly globals: Globals;
  readonly rest: readonly string[];
  readonly failure: Result | null;
}

function failed(why: string, globals: Globals): GlobalParse {
  return { globals, rest: [], failure: usageFailure(why) };
}

/** Extract flags shared by every command regardless of argument order. */
export function parseGlobals(argv: readonly string[]): GlobalParse {
  const rest: string[] = [];
  let json = false;
  let expect: string | null = null;
  let orientation: Globals["orientation"] = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      json = true;
    } else if (token === "--help" || token === "-h") {
      orientation = "help";
    } else if (token === "--version") {
      orientation ??= "version";
    } else if (token === "--expect") {
      const value = argv[index + 1];
      const globals = { json, expect, orientation };
      if (value === undefined || value.startsWith("-")) {
        return failed(USAGE_WHY.missingValue, globals);
      }
      if (expect !== null && expect !== value) {
        return failed(USAGE_WHY.conflictingFlag, globals);
      }
      expect = value;
      index += 1;
    } else if (token !== undefined) {
      rest.push(token);
    }
  }

  return { globals: { json, expect, orientation }, rest, failure: null };
}
