import type { FailureCandidateV1, MemoryCaptureV1_2 } from "@kratos/contracts";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { FailureObservation } from "../domain/hooks/index.js";
import { captureCandidate, sanitizeDiagnostic } from "../domain/hooks/index.js";
import {
  resultFor,
  usageFailure,
  type Result,
} from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { createSchemaRegistry } from "./schema.js";

export type ObservedMemory =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      readonly ports: RuntimePorts;
    };

/** Read candidate state and, for capture, a validated local proposal. */
export async function observeMemory(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry = createSchemaRegistry(),
): Promise<ObservedMemory> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  const candidates = await readCandidates(anchored, registry);
  if (candidates.kind === "failure") return candidates;

  if (invocation.command.path.join(" ") === "memory list") {
    return {
      kind: "observed",
      observation: {
        kind: "memory",
        operation: "list",
        candidates: candidates.value,
      },
      ports: anchored,
    };
  }

  const proposal = await readProposal(
    invocation.positionals[0] ?? "",
    anchored,
    registry,
  );
  if (proposal.kind === "failure") return proposal;
  const capture: FailureObservation = {
    toolFamily: "other",
    failureClass: "unknown",
    exitCode: null,
    diagnostic: sanitizeDiagnostic(
      proposal.value.observation,
      anchored.environment.workingDirectory(),
    ),
    observedAt: anchored.clock.now().toISOString(),
  };
  return {
    kind: "observed",
    observation: {
      kind: "memory",
      operation: "capture",
      candidates: candidates.value,
      capture: captureCandidate(capture, candidates.value, (canonical) =>
        anchored.digests.sha256(canonical),
      ),
    },
    ports: anchored,
  };
}

export type CandidateInbox =
  | { readonly kind: "value"; readonly value: readonly FailureCandidateV1[] }
  | { readonly kind: "failure"; readonly result: Result };

export async function readCandidates(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<CandidateInbox> {
  const root = ".brain/03-memory/candidates";
  if ((await ports.durableFileSystem.inspect(root)).kind !== "directory") {
    return { kind: "value", value: [] };
  }
  const candidates: FailureCandidateV1[] = [];
  for (const name of await ports.durableFileSystem.list(root)) {
    if (!name.endsWith(".json")) continue;
    const path = `${root}/${name}`;
    if ((await ports.durableFileSystem.inspect(path)).kind !== "file") continue;
    try {
      const parsed = JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown;
      const prepared = registry.validate({
        id: "state.failure-candidate",
        version: "1.0.0",
        value: parsed,
        structuralReasonCode: "runtime.state_corrupt",
      });
      if (prepared.kind !== "valid") return corrupt(path);
      candidates.push(prepared.value);
    } catch {
      return corrupt(path);
    }
  }
  return {
    kind: "value",
    value: candidates.sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
  };
}

async function readProposal(
  path: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | { readonly kind: "value"; readonly value: MemoryCaptureV1_2 }
  | { readonly kind: "failure"; readonly result: Result }
> {
  try {
    const parsed = JSON.parse(await ports.fileSystem.read(path)) as unknown;
    const prepared = registry.validate({
      id: "host.memory-capture",
      version: "1.2.0",
      value: parsed,
      structuralReasonCode: "trail.uso",
    });
    return prepared.kind === "valid"
      ? { kind: "value", value: prepared.value }
      : {
          kind: "failure",
          result: usageFailure("The memory capture proposal is invalid."),
        };
  } catch {
    return {
      kind: "failure",
      result: usageFailure("The memory capture proposal is unreadable."),
    };
  }
}

function corrupt(path: string): {
  readonly kind: "failure";
  readonly result: Result;
} {
  return {
    kind: "failure",
    result: resultFor("runtime.state_corrupt", {
      why: ["A persisted memory candidate does not satisfy its contract."],
      evidence: [{ kind: "artifact", ref: path }],
    }),
  };
}
