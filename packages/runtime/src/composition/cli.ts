import { CONTRACT_IDENTITIES } from "@mestre-yoda/contracts";

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
  transactionFailureResult,
  validatePublicText,
  validateResult,
  type Result,
} from "../domain/result/index.js";
import {
  prepareContract,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { applyPlan } from "./index.js";
import { observeInitialization } from "./init.js";
import { createSchemaRegistry } from "./schema.js";
import { TransactionFailure } from "./transactions.js";

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
  if (plan.effects.length !== 0 && !result.stateChanged) {
    throw new Error("A command effect plan conflicts with its result");
  }
}

function prepareAdapterPayload(
  payload: unknown,
  registry: SchemaRegistry,
): string {
  const prepared = prepareContract(registry, {
    id: "host.adapter-message",
    version: CONTRACT_IDENTITIES.host,
    value: payload,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    throw new Error("Command payload does not satisfy its declared contract");
  }
  validatePublicText(prepared.canonical);
  return `${prepared.canonical}\n`;
}

/** Parse, validate, apply, and publish one command line. */
export async function runCommandLine(
  argv: readonly string[],
  ports: RuntimePorts,
  commandRegistry: CommandRegistry = DEFAULT_REGISTRY,
  schemaRegistry: SchemaRegistry = createSchemaRegistry(),
): Promise<number> {
  const json = argv.includes("--json");
  try {
    const parsed = parseInvocation(argv, commandRegistry);
    if (parsed.kind === "result") {
      return publish(parsed.result, parsed.json, ports);
    }
    let invocation = parsed.invocation;
    let applyPorts = ports;
    if (invocation.command.prerequisite !== "none") {
      const observed = await observeInitialization(
        invocation,
        ports,
        schemaRegistry,
      );
      if (observed.kind === "failure") {
        return publish(observed.result, json, ports);
      }
      invocation = { ...invocation, observation: observed.observation };
      // The command may target a directory other than the one this process
      // started in, and its plan has to be committed where it was decided.
      applyPorts = observed.ports;
    }
    const decision = dispatch(invocation);
    validateResult(decision.result);
    validatePlan(decision.result, decision.plan);
    if (decision.result.exitCode !== 0) {
      return publish(decision.result, json, ports);
    }

    let preparedOutput: string | undefined;
    if (invocation.command.jsonContract === "adapter-message@1.0.0") {
      if (decision.payload === undefined) {
        throw new Error("Command payload is absent");
      }
      preparedOutput = prepareAdapterPayload(decision.payload, schemaRegistry);
    } else if (!json) {
      preparedOutput = decision.humanStdout ?? `${decision.result.summary}\n`;
      validatePublicText(preparedOutput);
    }
    const outcome = await applyPlan(decision.plan, applyPorts, {
      rootMode: decision.rootMode ?? "existing",
    });
    const result =
      outcome.kind === "noop" && decision.result.stateChanged
        ? { ...decision.result, stateChanged: false }
        : decision.result;
    validateResult(result);
    // A result-contract command prepares human output above; the only absent
    // value here is therefore result-contract JSON, rendered after outcome.
    const stdout = preparedOutput ?? renderResultJson(result).stdout;
    write(stdout, "stdout", ports);
    return result.exitCode;
  } catch (error) {
    if (error instanceof TransactionFailure) {
      return publish(transactionFailureResult(error), json, ports);
    }
    return publish(internalFailure(), json, ports);
  }
}
