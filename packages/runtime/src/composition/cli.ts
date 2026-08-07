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
  validatePublicText,
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

function validatePlan(
  result: Result,
  plan: Parameters<typeof applyPlan>[0],
): void {
  if (plan.effects.some(({ kind }) => kind === "emit")) {
    throw new Error("A command decision cannot own output effects");
  }
  if ((plan.effects.length !== 0) !== result.stateChanged) {
    throw new Error("A command effect plan conflicts with its result");
  }
}

function encodePayload(payload: unknown): string {
  const encoded: unknown = JSON.stringify(
    payload,
    (key: string, value: unknown): unknown => {
      validatePublicText(key);
      if (typeof value === "string") validatePublicText(value);
      return value;
    },
  );
  if (typeof encoded !== "string") {
    throw new Error("Command payload cannot be encoded");
  }
  return encoded;
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
    validatePlan(decision.result, decision.plan);
    if (decision.result.exitCode !== 0) {
      return publish(decision.result, json, ports);
    }

    let stdout: string;
    if (json && parsed.invocation.command.jsonContract === "result@1.0.0") {
      stdout = renderResultJson(decision.result).stdout;
    } else if (json) {
      if (decision.payload === undefined) {
        throw new Error("Command payload is absent");
      }
      stdout = `${encodePayload(decision.payload)}\n`;
    } else {
      stdout = decision.humanStdout ?? `${decision.result.summary}\n`;
      validatePublicText(stdout);
    }
    await applyPlan(decision.plan, ports);
    write(stdout, "stdout", ports);
    return decision.result.exitCode;
  } catch {
    return publish(internalFailure(), json, ports);
  }
}
