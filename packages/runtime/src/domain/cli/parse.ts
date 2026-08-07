import { USAGE_WHY, usageFailure, type Result } from "../result/index.js";

import type { CommandRegistry, CommandSpec, Globals } from "./spec.js";

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

export interface Resolution {
  readonly command: CommandSpec;
  readonly rest: readonly string[];
}

export interface ArgumentParse {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
  readonly failure: Result | null;
}

function match(
  tokens: readonly string[],
  registry: CommandRegistry,
): Resolution | null {
  const depths = registry.map((spec) => spec.path.length);
  for (let depth = Math.max(0, ...depths); depth >= 1; depth -= 1) {
    const candidate = tokens.slice(0, depth).join(" ");
    const command = registry.find((spec) => spec.path.join(" ") === candidate);
    if (command !== undefined) {
      return { command, rest: tokens.slice(depth) };
    }
  }
  return null;
}

/** Resolve separated command paths first, then their dotted spelling. */
export function resolveCommand(
  tokens: readonly string[],
  registry: CommandRegistry,
): Resolution | null {
  const direct = match(tokens, registry);
  if (direct !== null) return direct;
  const first = tokens[0];
  if (!first?.includes(".")) return null;
  return match([...first.split("."), ...tokens.slice(1)], registry);
}

function argumentFailure(why: string): ArgumentParse {
  return { flags: new Map(), positionals: [], failure: usageFailure(why) };
}

/** Apply one command's declared flags and arity to remaining tokens. */
export function parseArguments(
  spec: CommandSpec,
  tokens: readonly string[],
): ArgumentParse {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (!token.startsWith("-") || token.length === 1) {
      positionals.push(token);
      continue;
    }
    const flag = spec.flags.find(({ name }) => name === token);
    if (flag === undefined) return argumentFailure(USAGE_WHY.unknownFlag);
    if (flag.kind === "boolean") {
      flags.set(flag.name, true);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("-")) {
      return argumentFailure(USAGE_WHY.missingValue);
    }
    flags.set(flag.name, value);
    index += 1;
  }

  if (
    positionals.length < spec.positionals.min ||
    positionals.length > spec.positionals.max
  ) {
    return argumentFailure(USAGE_WHY.arity);
  }
  return { flags, positionals, failure: null };
}
