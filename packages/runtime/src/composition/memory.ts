import type {
  CuratedMemoryV1,
  FailureCandidateV1,
  MemoryCaptureV1_2,
  MemoryChangeV1_2,
} from "@kratos/contracts";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { FailureObservation } from "../domain/hooks/index.js";
import { captureCandidate, sanitizeDiagnostic } from "../domain/hooks/index.js";
import {
  classifyLegacyMemory,
  STOCK_GOTCHAS_TEMPLATE,
  validateCuratedMemoryProjection,
  validatesCuratedMemorySemantics,
} from "../domain/memory/index.js";
import { canonicalizeJson } from "../domain/schema/index.js";
import type { WriteFilePrecondition } from "../domain/effects.js";
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
  const migration = await observeLegacyMemoryClassification(anchored);
  if (migration === "migration_required") {
    return {
      kind: "failure",
      result: resultFor("memory.migration_required", {
        why: [
          "Existing gotchas content has not been explicitly mapped into curated memory.",
        ],
        evidence: [{ kind: "artifact", ref: ".brain/03-memory/gotchas.md" }],
      }),
    };
  }
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

  if (invocation.command.path[1] !== "capture") {
    const state = await readCuratedState(anchored, registry);
    if (state.kind === "failure") return state;
    const proposal = await readChangeProposal(
      invocation.positionals[0] ?? "",
      anchored,
      registry,
    );
    if (proposal.kind === "failure") return proposal;
    return {
      kind: "observed",
      observation: {
        kind: "memory",
        operation: "change",
        candidates: candidates.value,
        ...state.value,
        proposal: proposal.value,
        proposalDigest: anchored.digests.sha256(
          canonicalizeJson(proposal.value),
        ),
        // Apply replays the reviewed instant, while all bytes are observed now.
        now:
          invocation.flags.get("--yes") === true &&
          typeof invocation.flags.get("--plan-time") === "string"
            ? (invocation.flags.get("--plan-time") as string)
            : anchored.clock.now().toISOString(),
        digest: (value) => anchored.digests.sha256(value),
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

export async function observeLegacyMemoryClassification(
  ports: RuntimePorts,
): Promise<"adopted" | "safely_adoptable" | "migration_required" | "corrupt"> {
  const [ledger, gotchas] = await Promise.all([
    ports.durableFileSystem.inspect(".brain/03-memory/curated-memory.json"),
    ports.durableFileSystem.inspect(".brain/03-memory/gotchas.md"),
  ]);
  let content: string | null = null;
  if (gotchas.kind === "file") {
    try {
      content = await ports.durableFileSystem.readText(
        ".brain/03-memory/gotchas.md",
      );
    } catch {
      return "corrupt";
    }
  }
  return classifyLegacyMemory({
    ledger:
      ledger.kind === "file"
        ? "present"
        : ledger.kind === "missing"
          ? "missing"
          : "other",
    gotchas: content,
  });
}

async function readCuratedState(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "value";
      readonly value: {
        readonly ledger: CuratedMemoryV1;
        readonly ledgerExpected: WriteFilePrecondition;
        readonly projection: string;
        readonly projectionExpected: WriteFilePrecondition;
        readonly candidateExpected: ReadonlyMap<string, WriteFilePrecondition>;
      };
    }
  | { readonly kind: "failure"; readonly result: Result }
> {
  const ledgerPath = ".brain/03-memory/curated-memory.json";
  const projectionPath = ".brain/03-memory/gotchas.md";
  try {
    const ledgerEntry = await ports.durableFileSystem.inspect(ledgerPath);
    const projectionEntry =
      await ports.durableFileSystem.inspect(projectionPath);
    if (ledgerEntry.kind === "missing" && projectionEntry.kind === "file") {
      const projection = await ports.durableFileSystem.readText(projectionPath);
      if (projection === STOCK_GOTCHAS_TEMPLATE) {
        const empty: CuratedMemoryV1 = {
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          revision: 0,
          projectionDigest: "",
          updatedAt: "1970-01-01T00:00:00Z",
          confirmed: [],
          archive: [],
        };
        const digest = ports.digests.sha256(projection);
        return {
          kind: "value",
          value: {
            ledger: { ...empty, projectionDigest: digest },
            ledgerExpected: { kind: "missing" },
            projection,
            projectionExpected: filePrecondition(projectionEntry),
            candidateExpected: await candidatePreconditions(ports),
          },
        };
      }
    }
    if (ledgerEntry.kind !== "file" || projectionEntry.kind !== "file")
      return corrupt(ledgerPath);
    const prepared = registry.validate({
      id: "state.curated-memory",
      version: "1.0.0",
      value: JSON.parse(await ports.durableFileSystem.readText(ledgerPath)),
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (
      prepared.kind !== "valid" ||
      !validatesCuratedMemorySemantics(prepared.value, (value) =>
        ports.digests.sha256(value),
      )
    )
      return corrupt(ledgerPath);
    const projection = await ports.durableFileSystem.readText(projectionPath);
    if (
      validateCuratedMemoryProjection(prepared.value, projection, (value) =>
        ports.digests.sha256(value),
      ).kind !== "valid"
    ) {
      return {
        kind: "failure",
        result: resultFor("memory.projection_drift", {
          why: [
            "The rendered curated-memory projection does not match its ledger.",
          ],
          evidence: [
            { kind: "artifact", ref: ledgerPath },
            { kind: "artifact", ref: projectionPath },
          ],
        }),
      };
    }
    return {
      kind: "value",
      value: {
        ledger: prepared.value,
        ledgerExpected: filePrecondition(ledgerEntry),
        projection,
        projectionExpected: filePrecondition(projectionEntry),
        candidateExpected: await candidatePreconditions(ports),
      },
    };
  } catch {
    return corrupt(ledgerPath);
  }
}

function filePrecondition(entry: {
  readonly kind: "file";
  readonly size: number;
  readonly sha256: string;
}): WriteFilePrecondition {
  return { kind: "file", size: entry.size, sha256: entry.sha256 };
}

async function candidatePreconditions(
  ports: RuntimePorts,
): Promise<ReadonlyMap<string, WriteFilePrecondition>> {
  const candidates = new Map<string, WriteFilePrecondition>();
  const root = ".brain/03-memory/candidates";
  if ((await ports.durableFileSystem.inspect(root)).kind !== "directory")
    return candidates;
  for (const name of await ports.durableFileSystem.list(root)) {
    if (!name.endsWith(".json")) continue;
    const path = `${root}/${name}`;
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind === "file") candidates.set(path, filePrecondition(entry));
  }
  return candidates;
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
      left.candidateId < right.candidateId
        ? -1
        : left.candidateId > right.candidateId
          ? 1
          : 0,
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

async function readChangeProposal(
  path: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | { readonly kind: "value"; readonly value: MemoryChangeV1_2 }
  | { readonly kind: "failure"; readonly result: Result }
> {
  try {
    const prepared = registry.validate({
      id: "host.memory-change",
      version: "1.2.0",
      value: JSON.parse(await ports.fileSystem.read(path)) as unknown,
      structuralReasonCode: "trail.uso",
    });
    return prepared.kind === "valid"
      ? { kind: "value", value: prepared.value }
      : {
          kind: "failure",
          result: usageFailure("The memory change proposal is invalid."),
        };
  } catch {
    return {
      kind: "failure",
      result: usageFailure("The memory change proposal is unreadable."),
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
