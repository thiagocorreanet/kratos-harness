import { YODA_VERSION } from "@mestre-yoda/contracts";

import {
  buildHandshakeResponse,
  classifyExpectedVersion,
} from "./handshake.js";

export type TextWriter = (text: string) => void;

const HELP =
  "Usage: yoda [--expect <version>] [--help | --version | handshake]\n";

export function runCli(
  args: readonly string[],
  output: TextWriter,
  error: TextWriter,
): number {
  let rest = args;

  // `--expect` pins the plugin version a caller was configured against. It is
  // checked before anything else so a drifted install can never act.
  if (rest[0] === "--expect") {
    const failure = classifyExpectedVersion(rest[1]);
    if (failure !== null) {
      output(`${JSON.stringify(failure)}\n`);
      return failure.exitCode;
    }
    rest = rest.slice(2);
  }

  if (rest.length === 0 || (rest.length === 1 && rest[0] === "--help")) {
    output(HELP);
    return 0;
  }

  if (rest.length === 1 && rest[0] === "--version") {
    output(`${YODA_VERSION}\n`);
    return 0;
  }

  if (rest.length === 1 && rest[0] === "handshake") {
    output(`${JSON.stringify(buildHandshakeResponse("cli"))}\n`);
    return 0;
  }

  error(`Unknown argument: ${rest.join(" ")}. Run yoda --help for usage.\n`);
  return 2;
}
