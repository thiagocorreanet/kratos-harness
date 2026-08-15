import type {
  CommandObservation,
  Invocation,
} from "../domain/cli/index.js";
import { classifyHostContract } from "../domain/host/index.js";
import { usageFailure, type Result } from "../domain/result/index.js";
import { prepareContract, type SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import type { Observed } from "./init.js";
import { anchorPorts, resolveCommandRoot } from "./root.js";

export async function observeHostOperation(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return { kind: "failure", result: root.result };
  const anchored = anchorPorts(root.target, ports);
  const input = await anchored.standardInput.read();
  if (input === null || input.trim().length === 0) {
    return failure("The hook command requires one JSON message on standard input.");
  }

  const document = parse(input);
  const contractFailure = classifyHostContract(document);
  if (contractFailure !== null) {
    return { kind: "failure", result: contractFailure };
  }
  const prepared = prepareContract(registry, {
    id: "host.operation-message",
    version: "1.0.0",
    value: document,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    return failure("The host operation message does not satisfy its schema.");
  }

  const observation: CommandObservation = {
    kind: "host-operation",
    message: prepared.value,
  };
  return { kind: "observed", observation, ports: anchored };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function failure(why: string): { readonly kind: "failure"; readonly result: Result } {
  return { kind: "failure", result: usageFailure(why) };
}
