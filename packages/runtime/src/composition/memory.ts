import type {
  CuratedMemoryV1,
  CuratedMemoryV1_1,
  FailureCandidateV1,
  FailureCandidateV1_1,
  MemoryCaptureV1_2,
  MemoryChangeV1_2,
  MemoryChangeV1_4,
  MemoryCurationV1_4,
} from "@kratos/contracts";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { FailureObservation } from "../domain/hooks/index.js";
import { captureCandidate, sanitizeDiagnostic } from "../domain/hooks/index.js";
import {
  classifyLegacyMemory,
  proposeMemoryCuration,
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
import { declaredContractVersion } from "./contract-version.js";

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

  if (invocation.command.path.join(" ") === "memory curate") {
    return observeMemoryCuration(invocation, anchored, registry);
  }

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
    const proposal = await readChangeProposal(
      invocation.positionals[0] ?? "",
      anchored,
      registry,
    );
    if (proposal.kind === "failure") return proposal;
    if (proposal.value.contractVersion === "1.4.0") {
      const current = await readCuratedStateV1_1(anchored, registry);
      if (current.kind === "failure") return current;
      return {
        kind: "observed",
        observation: {
          kind: "memory",
          operation: "current-change",
          candidates: candidates.value,
          ledger: current.value.ledger,
          ledgerExpected: current.value.ledgerExpected,
          projection: current.value.projection,
          projectionExpected: current.value.projectionExpected,
          candidateExpected: candidates.expected,
          proposal: proposal.value,
          proposalDigest: anchored.digests.sha256(
            canonicalizeJson(proposal.value),
          ),
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
    const state = await readCuratedState(anchored, registry);
    if (state.kind === "failure") return state;
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
      candidateExpected: candidates.expected,
    },
    ports: anchored,
  };
}

async function observeMemoryCuration(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedMemory> {
  const asOf = invocation.flags.get("--as-of");
  if (typeof asOf !== "string") {
    return {
      kind: "failure",
      result: usageFailure("Memory curation requires --as-of YYYY-MM-DD."),
    };
  }
  const state = await readCuratedStateV1_1(ports, registry);
  if (state.kind === "failure") return state;
  const presence = new Map<string, boolean>();
  for (const dependencyPath of [
    ...new Set(
      state.value.ledger.confirmed.flatMap(({ dependency }) =>
        dependency.kind === "path" ? [dependency.path] : [],
      ),
    ),
  ].sort()) {
    const entry = await ports.fileSystem.stat(dependencyPath);
    if (entry?.kind === "symlink") {
      return {
        kind: "failure",
        result: resultFor("runtime.state_corrupt", {
          why: ["A memory dependency path cannot be observed safely."],
          evidence: [{ kind: "artifact", ref: dependencyPath }],
        }),
      };
    }
    presence.set(dependencyPath, entry !== null);
  }
  let plan;
  try {
    plan = proposeMemoryCuration({
      ledger: state.value.ledger,
      asOf,
      dependencyPresence: presence,
      digest: (value) => ports.digests.sha256(value),
    });
  } catch {
    return {
      kind: "failure",
      result: usageFailure(
        "The curation date is invalid or precedes a lesson observation.",
      ),
    };
  }
  const approvalPath = invocation.positionals[0] ?? null;
  const approval =
    approvalPath === null
      ? null
      : await readCurationApproval(approvalPath, ports, registry);
  if (approval?.kind === "failure") return approval;
  const now =
    invocation.flags.get("--yes") === true &&
    typeof invocation.flags.get("--plan-time") === "string"
      ? (invocation.flags.get("--plan-time") as string)
      : ports.clock.now().toISOString();
  return {
    kind: "observed",
    observation: {
      kind: "memory",
      operation: "curate",
      ledger: state.value.ledger,
      ledgerExpected: state.value.ledgerExpected,
      projectionExpected: state.value.projectionExpected,
      plan,
      approval: approval?.value ?? null,
      approvalDigest:
        approval === null
          ? null
          : ports.digests.sha256(canonicalizeJson(approval.value)),
      approvalPath,
      now,
      digest: (value) => ports.digests.sha256(value),
    },
    ports,
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

export type PhaseMemoryBinding =
  | { readonly kind: "value"; readonly value: null | PhaseMemoryObservation }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        | "memory.migration_required"
        | "memory.projection_drift"
        | "runtime.state_corrupt";
    };

export interface PhaseMemoryObservation {
  readonly ref: ".brain/03-memory/gotchas.md";
  readonly sha256: string;
  readonly lessonIds: string[];
}

/**
 * Bind code and review work to the exact validated human projection.
 *
 * The projection is revalidated from the ledger on every observation; hosts
 * only relay this immutable observation and never decide whether it is safe.
 */
export async function observePhaseMemoryBinding(
  phase: "prd" | "spec" | "plan" | "code" | "review" | "acceptance",
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseMemoryBinding> {
  if (phase !== "code" && phase !== "review") {
    return { kind: "value", value: null };
  }
  const classification = await observeLegacyMemoryClassification(ports);
  if (classification === "migration_required") {
    return { kind: "refused", reasonCode: "memory.migration_required" };
  }
  if (classification === "corrupt") {
    return { kind: "refused", reasonCode: "runtime.state_corrupt" };
  }
  const state = await readCuratedState(ports, registry);
  if (state.kind === "failure") {
    const current = await readCuratedStateV1_1(ports, registry);
    if (current.kind === "value") {
      return {
        kind: "value",
        value: {
          ref: ".brain/03-memory/gotchas.md",
          sha256: ports.digests.sha256(current.value.projection),
          lessonIds: current.value.ledger.confirmed
            .map(({ lessonId }) => lessonId)
            .sort(),
        },
      };
    }
    return {
      kind: "refused",
      reasonCode:
        state.result.reasonCode === "memory.projection_drift"
          ? "memory.projection_drift"
          : "runtime.state_corrupt",
    };
  }
  return {
    kind: "value",
    value: {
      ref: ".brain/03-memory/gotchas.md",
      sha256: ports.digests.sha256(state.value.projection),
      lessonIds: state.value.ledger.confirmed
        .map(({ lessonId }) => lessonId)
        .sort(),
    },
  };
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

async function readCuratedStateV1_1(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "value";
      readonly value: {
        readonly ledger: CuratedMemoryV1_1;
        readonly ledgerExpected: WriteFilePrecondition;
        readonly projection: string;
        readonly projectionExpected: WriteFilePrecondition;
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
    if (ledgerEntry.kind !== "file" || projectionEntry.kind !== "file")
      return corrupt(ledgerPath);
    const parsed = JSON.parse(
      await ports.durableFileSystem.readText(ledgerPath),
    ) as unknown;
    if (declaredContractVersion(parsed, "stateContract", "1.0.0") !== "1.1.0") {
      return {
        kind: "failure",
        result: resultFor("memory.migration_required", {
          why: [
            "Deterministic curation requires curated-memory observation metadata.",
          ],
          evidence: [{ kind: "artifact", ref: ledgerPath }],
        }),
      };
    }
    const prepared = registry.validate({
      id: "state.curated-memory",
      version: "1.1.0",
      value: parsed,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (prepared.kind !== "valid") return corrupt(ledgerPath);
    const projection = await ports.durableFileSystem.readText(projectionPath);
    if (
      validateCuratedMemoryProjection(
        prepared.value as unknown as CuratedMemoryV1,
        projection,
        (value) => ports.digests.sha256(value),
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
  | {
      readonly kind: "value";
      readonly value: readonly (FailureCandidateV1 | FailureCandidateV1_1)[];
      readonly expected: ReadonlyMap<string, WriteFilePrecondition>;
    }
  | { readonly kind: "failure"; readonly result: Result };

export async function readCandidates(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<CandidateInbox> {
  const root = ".brain/03-memory/candidates";
  if ((await ports.durableFileSystem.inspect(root)).kind !== "directory") {
    return { kind: "value", value: [], expected: new Map() };
  }
  const candidates: (FailureCandidateV1 | FailureCandidateV1_1)[] = [];
  const expected = new Map<string, WriteFilePrecondition>();
  for (const name of await ports.durableFileSystem.list(root)) {
    if (!name.endsWith(".json")) continue;
    const path = `${root}/${name}`;
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind !== "file") continue;
    try {
      const parsed = JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown;
      const prepared = registry.validate({
        id: "state.failure-candidate",
        version: declaredContractVersion(parsed, "stateContract", "1.0.0"),
        value: parsed,
        structuralReasonCode: "runtime.state_corrupt",
      });
      if (prepared.kind !== "valid") return corrupt(path);
      candidates.push(prepared.value);
      expected.set(path, filePrecondition(entry));
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
    expected,
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
  | {
      readonly kind: "value";
      readonly value: MemoryChangeV1_2 | MemoryChangeV1_4;
    }
  | { readonly kind: "failure"; readonly result: Result }
> {
  try {
    const parsed = JSON.parse(await ports.fileSystem.read(path)) as unknown;
    const version = declaredContractVersion(parsed, "hostContract", "1.2.0");
    if (version !== "1.2.0" && version !== "1.4.0") {
      return {
        kind: "failure",
        result: usageFailure("The memory change proposal is invalid."),
      };
    }
    const prepared = registry.validate({
      id: "host.memory-change",
      version,
      value: parsed,
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

async function readCurationApproval(
  path: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "value";
      readonly value: Extract<
        MemoryCurationV1_4,
        { readonly kind: "approval" }
      >;
    }
  | { readonly kind: "failure"; readonly result: Result }
> {
  try {
    const prepared = registry.validate({
      id: "host.memory-curation",
      version: "1.4.0",
      value: JSON.parse(await ports.fileSystem.read(path)) as unknown,
      structuralReasonCode: "trail.uso",
    });
    return prepared.kind === "valid" && prepared.value.kind === "approval"
      ? { kind: "value", value: prepared.value }
      : {
          kind: "failure",
          result: usageFailure("The memory curation approval is invalid."),
        };
  } catch {
    return {
      kind: "failure",
      result: usageFailure("The memory curation approval is unreadable."),
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
