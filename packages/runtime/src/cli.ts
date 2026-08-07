import { runCommandLine } from "./composition/cli.js";
import { createRuntime } from "./composition/index.js";
import type { RuntimePorts } from "./ports/index.js";

/** Process entry: compose the real ports and run one command line. */
export async function runCli(
  argv: readonly string[],
  ports: RuntimePorts = createRuntime(),
): Promise<number> {
  return runCommandLine(argv, ports);
}
