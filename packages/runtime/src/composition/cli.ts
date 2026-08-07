import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  type CommandRegistry,
} from "../domain/cli/index.js";
import {
  internalFailure,
  renderResultHuman,
  renderResultJson,
  validateResult,
  type Result,
} from "../domain/result/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { applyPlan } from "./index.js";

function write(
  text: string,
  stream: "stdout" | "stderr",
  ports: RuntimePorts,
): void {
  if (text.length === 0) return;
  if (stream === "stdout") ports.output.structured(text);
  else ports.output.human(text);
}

function publish(result: Result, json: boolean, ports: RuntimePorts): number {
  const rendered = json ? renderResultJson(result) : renderResultHuman(result);
  write(rendered.stdout, "stdout", ports);
  write(rendered.stderr, "stderr", ports);
  return rendered.exitCode;
}

/** Parse, validate, apply, and publish one command line. */
export async function runCommandLine(
  argv: readonly string[],
  ports: RuntimePorts,
  registry: CommandRegistry = DEFAULT_REGISTRY,
): Promise<number> {
  const json = argv.includes("--json");
  try {
    const parsed = parseInvocation(argv, registry);
    if (parsed.kind === "result") {
      return publish(parsed.result, parsed.json, ports);
    }
    const decision = dispatch(parsed.invocation);
    validateResult(decision.result);
    await applyPlan(decision.plan, ports);
    if (decision.result.exitCode !== 0) {
      return publish(decision.result, json, ports);
    }
    if (json && parsed.invocation.command.jsonContract === "result@1.0.0") {
      return publish(decision.result, true, ports);
    }
    if (json) {
      if (decision.payload === undefined) {
        throw new Error("Command payload is absent");
      }
      const payload = JSON.stringify(decision.payload);
      write(`${payload}\n`, "stdout", ports);
      return decision.result.exitCode;
    }
    write(
      decision.humanStdout ?? `${decision.result.summary}\n`,
      "stdout",
      ports,
    );
    return decision.result.exitCode;
  } catch {
    return publish(internalFailure(), json, ports);
  }
}
