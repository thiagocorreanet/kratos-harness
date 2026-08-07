import {
  GLOBAL_FLAGS,
  type CommandRegistry,
  type CommandSpec,
  type FlagSpec,
} from "./spec.js";

function label(flag: FlagSpec): string {
  return flag.valueLabel === undefined
    ? flag.name
    : `${flag.name} ${flag.valueLabel}`;
}

function sortedFlags(flags: readonly FlagSpec[]): readonly FlagSpec[] {
  return [...flags].sort((left, right) =>
    left.name.localeCompare(right.name, "en-US"),
  );
}

function sortedCommands(registry: CommandRegistry): readonly CommandSpec[] {
  return [...registry].sort((left, right) =>
    left.path.join(" ").localeCompare(right.path.join(" "), "en-US"),
  );
}

/** Render the exact invocation form of one command. */
export function usageLine(spec: CommandSpec): string {
  const flags = sortedFlags(spec.flags).map((flag) => `[${label(flag)}]`);
  return ["yoda", ...spec.path, ...flags].join(" ");
}

function pad(text: string, width: number): string {
  return text.padEnd(width, " ");
}

/** Generate complete deterministic usage text from the command registry. */
export function renderHelp(registry: CommandRegistry): string {
  const commands = sortedCommands(registry);
  const width = Math.max(
    12,
    ...commands.map((spec) => spec.path.join(" ").length + 2),
    ...GLOBAL_FLAGS.map((flag) => label(flag).length + 2),
    ...commands.flatMap((spec) =>
      spec.flags.map((flag) => label(flag).length + 6),
    ),
  );
  const lines = [
    "Usage: yoda [--expect <version>] [--json] <command>",
    "",
    "Commands:",
  ];
  for (const spec of commands) {
    lines.push(`  ${pad(spec.path.join(" "), width)}${spec.summary}`);
    for (const flag of sortedFlags(spec.flags)) {
      lines.push(`      ${pad(label(flag), width - 4)}${flag.summary}`);
    }
  }
  lines.push("", "Global flags:");
  for (const flag of sortedFlags(GLOBAL_FLAGS)) {
    lines.push(`  ${pad(label(flag), width)}${flag.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
