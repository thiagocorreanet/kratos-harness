import { YODA_VERSION } from "@mestre-yoda/contracts";

export type TextWriter = (text: string) => void;

const HELP = "Usage: yoda [--help | --version]\n";

export function runCli(
  args: readonly string[],
  output: TextWriter,
  error: TextWriter,
): number {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    output(HELP);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    output(`${YODA_VERSION}\n`);
    return 0;
  }

  error(`Unknown argument: ${args.join(" ")}. Run yoda --help for usage.\n`);
  return 2;
}
