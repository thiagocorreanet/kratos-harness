import { USAGE_WHY, usageFailure, type Result } from "../result/index.js";
import { classifyExpectedVersion } from "../handshake.js";

import type {
  CommandRegistry,
  CommandSpec,
  Globals,
  Invocation,
} from "./spec.js";

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
  const json = argv.includes("--json");
  let expect: string | null = null;
  let orientation: Globals["orientation"] = null;
  let skip = false;

  for (const [index, token] of argv.entries()) {
    if (skip) {
      skip = false;
      continue;
    }
    if (token === "--json") {
      continue;
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
      skip = true;
    } else {
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
  let skip = false;

  for (const [index, token] of tokens.entries()) {
    if (skip) {
      skip = false;
      continue;
    }
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
    skip = true;
  }

  if (
    positionals.length < spec.positionals.min ||
    positionals.length > spec.positionals.max
  ) {
    return argumentFailure(USAGE_WHY.arity);
  }
  return { flags, positionals, failure: null };
}

export type ParseOutcome =
  | { readonly kind: "invocation"; readonly invocation: Invocation }
  | {
      readonly kind: "result";
      readonly result: Result;
      readonly json: boolean;
    };

/** Turn argv into either a validated invocation or the result ending the run. */
export function parseInvocation(
  argv: readonly string[],
  registry: CommandRegistry,
): ParseOutcome {
  const parsed = parseGlobals(argv);
  if (parsed.failure !== null) {
    return {
      kind: "result",
      result: parsed.failure,
      json: parsed.globals.json,
    };
  }
  if (parsed.globals.expect !== null) {
    const drift = classifyExpectedVersion(parsed.globals.expect);
    if (drift !== null) {
      return { kind: "result", result: drift, json: parsed.globals.json };
    }
  }
  const tokens =
    parsed.globals.orientation !== null
      ? [parsed.globals.orientation]
      : parsed.rest.length === 0
        ? ["help"]
        : parsed.rest;
  const resolved = resolveCommand(tokens, registry);
  if (resolved === null) {
    return {
      kind: "result",
      result: usageFailure(USAGE_WHY.unknownCommand),
      json: parsed.globals.json,
    };
  }
  const args = parseArguments(resolved.command, resolved.rest);
  if (args.failure !== null) {
    return { kind: "result", result: args.failure, json: parsed.globals.json };
  }
  return {
    kind: "invocation",
    invocation: {
      command: resolved.command,
      globals: parsed.globals,
      flags: args.flags,
      positionals: args.positionals,
      registry,
    },
  };
}
