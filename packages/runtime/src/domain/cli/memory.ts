import { planOf, type Effect, type WriteFilePrecondition } from "../effects.js";
import {
  projectCuratedMemory,
  applyMemoryCuration,
  reduceMemoryChange,
  reduceMemoryChangeV1_4,
  type MemoryChangeReduction,
} from "../memory/index.js";
import { resultFor } from "../result/index.js";
import { canonicalizeJson } from "../schema/index.js";

import { observingCommand } from "./observed.js";
import {
  renderApplyInstructions,
  renderPosixCommand,
} from "./shell-argument.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

const ROOT_FLAG: CommandSpec["flags"] = [
  {
    name: "--root",
    kind: "value",
    valueLabel: "<path>",
    summary: "Operate on the project rooted at this path.",
  },
];

export const memoryListCommand: CommandSpec = observingCommand(
  "memory",
  {
    path: ["memory", "list"],
    summary: "List local failure candidates without changing curated memory.",
    flags: ROOT_FLAG,
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => {
    if (observation.operation !== "list") return internal();
    const candidates = observation.candidates;
    return {
      result: resultFor("runtime.orientation_ok", {
        summary:
          candidates.length === 0
            ? "No local memory candidates are available."
            : `${String(candidates.length)} local memory candidate${candidates.length === 1 ? " is" : "s are"} available.`,
      }),
      plan: planOf(),
      humanStdout:
        candidates.length === 0
          ? "No local memory candidates are available.\n"
          : `${candidates.map((candidate) => `${candidate.candidateId} ${candidate.diagnostic}`).join("\n")}\n`,
      payload: null,
    };
  },
);

export const memoryCaptureCommand: CommandSpec = observingCommand(
  "memory",
  {
    path: ["memory", "capture"],
    summary: "Capture one validated local failure proposal as a candidate.",
    flags: ROOT_FLAG,
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => {
    if (observation.operation !== "capture") return internal();
    const decision = observation.capture;
    const path = `.brain/03-memory/candidates/${decision.candidate.candidateId}.json`;
    return {
      result: resultFor("trail.ok", {
        summary: "The local memory candidate was captured.",
        evidence: [{ kind: "artifact", ref: path }],
      }),
      plan: planOf(
        write(
          path,
          decision.candidate,
          observation.candidateExpected.get(path) ?? { kind: "missing" },
        ),
      ),
      humanStdout: null,
      payload: null,
    };
  },
);

const CHANGE_FLAGS: CommandSpec["flags"] = [
  ...ROOT_FLAG,
  {
    name: "--yes",
    kind: "boolean",
    summary: "Apply the exact reviewed memory change.",
  },
  {
    name: "--proposal-digest",
    kind: "value",
    valueLabel: "<sha256>",
    summary: "Bind apply to the reviewed proposal.",
  },
  {
    name: "--plan-digest",
    kind: "value",
    valueLabel: "<sha256>",
    summary: "Bind apply to the reviewed memory plan.",
  },
  {
    name: "--plan-time",
    kind: "value",
    valueLabel: "<instant>",
    summary: "Bind apply to the reviewed plan time.",
  },
];

export const memoryPromoteCommand = memoryChangeCommand(
  ["memory", "promote"],
  "Preview or explicitly promote local candidates into a reviewed lesson.",
);
export const memoryMergeCommand = memoryChangeCommand(
  ["memory", "merge"],
  "Preview or explicitly merge confirmed reviewed lessons.",
);
export const memoryArchiveCommand = memoryChangeCommand(
  ["memory", "archive"],
  "Preview or explicitly archive one obsolete confirmed lesson.",
);
export const memoryReinforceCommand = memoryChangeCommand(
  ["memory", "reinforce"],
  "Preview or explicitly reinforce a lesson from repeated local observations.",
);

export const memoryCurateCommand: CommandSpec = observingCommand(
  "memory",
  {
    path: ["memory", "curate"],
    summary:
      "Score deterministic curation proposals and apply a fully reviewed batch.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--as-of",
        kind: "value",
        valueLabel: "<YYYY-MM-DD>",
        summary: "Evaluate age at midnight UTC.",
      },
      {
        name: "--yes",
        kind: "boolean",
        summary: "Apply the exact reviewed curation batch.",
      },
      {
        name: "--plan-digest",
        kind: "value",
        valueLabel: "<sha256>",
        summary: "Bind apply to the scored plan.",
      },
      {
        name: "--approval-digest",
        kind: "value",
        valueLabel: "<sha256>",
        summary: "Bind apply to the complete approval.",
      },
      {
        name: "--plan-time",
        kind: "value",
        valueLabel: "<instant>",
        summary: "Bind apply to the reviewed publication time.",
      },
    ],
    positionals: { min: 0, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    if (observation.operation !== "curate") return internal();
    if (observation.approval === null) {
      return {
        result: resultFor("runtime.orientation_ok", {
          summary: `${String(observation.plan.proposals.length)} deterministic memory curation proposal${observation.plan.proposals.length === 1 ? " is" : "s are"} ready for review.`,
        }),
        plan: planOf(),
        humanStdout: `${JSON.stringify(observation.plan, null, 2)}\n`,
        payload: observation.plan,
      };
    }
    const reduction = applyMemoryCuration(
      observation.ledger,
      observation.plan,
      observation.approval,
      observation.now,
      observation.digest,
    );
    if (reduction.kind !== "ready")
      return result(
        reduction.kind === "candidate_missing"
          ? "memory.candidate_missing"
          : reduction.kind === "curation_required"
            ? "memory.curation_required"
            : "memory.confirmation_stale",
      );
    const approvalDigest = observation.approvalDigest;
    if (approvalDigest === null || observation.approvalPath === null)
      return internal();
    const projection = projectCuratedMemory(
      reduction.ledger as never,
      observation.digest,
    );
    const planDigest = observation.digest(
      canonicalizeJson({
        scoredPlan: observation.plan,
        approvalDigest,
        nextLedger: reduction.ledger,
        nextProjection: projection.content,
        now: observation.now,
      }),
    );
    const argv = memoryCurationApplyArgv(
      invocation,
      observation.plan.planDigest,
      approvalDigest,
      planDigest,
      observation.now,
    );
    if (invocation.flags.get("--yes") !== true) {
      return {
        result: resultFor("runtime.orientation_ok", {
          summary: `Memory curation batch ${planDigest} is ready.`,
        }),
        plan: planOf(),
        humanStdout:
          [
            `Scored plan digest: ${observation.plan.planDigest}`,
            `Approval digest: ${approvalDigest}`,
            `Plan digest: ${planDigest}`,
            `Plan time: ${observation.now}`,
            ...renderApplyInstructions(argv),
          ].join("\n") + "\n",
        payload: reduction.ledger,
      };
    }
    if (
      invocation.flags.get("--plan-digest") !== planDigest ||
      invocation.flags.get("--approval-digest") !== approvalDigest ||
      invocation.flags.get("--plan-time") !== observation.now
    )
      return result("memory.confirmation_stale");
    return {
      result: resultFor("trail.ok", {
        summary: "Committed the approved memory curation batch.",
        stateChanged: true,
        evidence: [
          { kind: "artifact", ref: ".brain/03-memory/curated-memory.json" },
          { kind: "artifact", ref: ".brain/03-memory/gotchas.md" },
        ],
      }),
      plan: planOf(
        write(
          ".brain/03-memory/curated-memory.json",
          reduction.ledger,
          observation.ledgerExpected,
        ),
        {
          kind: "write_file",
          path: ".brain/03-memory/gotchas.md",
          content: projection.content,
          expected: observation.projectionExpected,
        },
      ),
      humanStdout: null,
      payload: reduction.ledger,
    };
  },
);

function memoryChangeCommand(
  path: readonly string[],
  summary: string,
): CommandSpec {
  return observingCommand(
    "memory",
    {
      path,
      summary,
      flags: CHANGE_FLAGS,
      positionals: { min: 1, max: 1 },
      jsonContract: "result@1.0.0",
    },
    (invocation, observation) => {
      if (
        observation.operation !== "change" &&
        observation.operation !== "current-change"
      )
        return internal();
      if (observation.proposal.operation !== path[1]) return usage();
      const reduction =
        observation.operation === "current-change"
          ? reduceMemoryChangeV1_4(
              observation.ledger,
              observation.candidates,
              observation.proposal,
              observation.now,
              observation.digest,
            )
          : reduceMemoryChange(
              observation.ledger,
              observation.proposal,
              observation.now,
              observation.digest,
            );
      if (reduction.kind !== "ready") {
        return result(
          reduction.kind === "candidate_missing"
            ? "memory.candidate_missing"
            : reduction.kind === "curation_required"
              ? "memory.curation_required"
              : "memory.lesson_incomplete",
        );
      }
      if (observation.proposal.operation === "promote") {
        const missing = observation.proposal.candidateIds.some(
          (id) =>
            !observation.candidates.some(
              (candidate) => candidate.candidateId === id,
            ),
        );
        if (missing) return result("memory.candidate_missing");
      }
      const planDigest = changePlanDigest(observation, reduction);
      if (invocation.flags.get("--yes") !== true) {
        return {
          result: resultFor("runtime.orientation_ok", {
            summary: `Memory ${observation.proposal.operation} plan ${planDigest} is ready.`,
          }),
          plan: planOf(),
          humanStdout:
            [
              "Curated memory preview",
              `Proposal digest: ${observation.proposalDigest}`,
              `Plan digest: ${planDigest}`,
              `Plan time: ${observation.now}`,
              ...renderApplyInstructions(
                memoryApplyArgv(
                  invocation,
                  observation.proposalDigest,
                  planDigest,
                  observation.now,
                ),
              ),
            ].join("\n") + "\n",
          payload: null,
        };
      }
      if (
        invocation.flags.get("--proposal-digest") !==
          observation.proposalDigest ||
        invocation.flags.get("--plan-digest") !== planDigest ||
        invocation.flags.get("--plan-time") !== observation.now
      )
        return result("memory.confirmation_stale");
      const projection = projectCuratedMemory(
        reduction.ledger as never,
        observation.digest,
      );
      const effects: Effect[] = [
        write(
          ".brain/03-memory/curated-memory.json",
          reduction.ledger,
          observation.ledgerExpected,
        ),
        {
          kind: "write_file",
          path: ".brain/03-memory/gotchas.md",
          content: projection.content,
          expected: observation.projectionExpected,
        },
      ];
      const cleanupCandidates: {
        path: string;
        expected: Extract<WriteFilePrecondition, { kind: "file" }>;
      }[] = [];
      for (const candidateId of reduction.consumedCandidateIds) {
        const candidatePath = `.brain/03-memory/candidates/${candidateId}.json`;
        const expected = observation.candidateExpected.get(candidatePath);
        if (expected === undefined) return result("memory.confirmation_stale");
        if (expected.kind !== "file")
          return result("memory.confirmation_stale");
        cleanupCandidates.push({ path: candidatePath, expected });
      }
      effects.unshift(
        ...cleanupCandidates.map(({ path: candidatePath, expected }) => ({
          kind: "assert_file" as const,
          path: candidatePath,
          expected,
        })),
      );
      return {
        result: resultFor("trail.ok", {
          summary: `Committed curated memory ${observation.proposal.operation}.`,
          stateChanged: true,
          evidence: [
            { kind: "artifact", ref: ".brain/03-memory/curated-memory.json" },
            { kind: "artifact", ref: ".brain/03-memory/gotchas.md" },
          ],
        }),
        plan: planOf(...effects),
        humanStdout: null,
        payload: null,
        cleanupCandidates,
      };
    },
  );
}

function result(
  code:
    | "memory.candidate_missing"
    | "memory.confirmation_stale"
    | "memory.curation_required"
    | "memory.lesson_incomplete",
): Decision {
  return {
    result: resultFor(code, {
      why: ["The current curated-memory facts do not authorize this change."],
      evidence:
        code === "memory.lesson_incomplete"
          ? []
          : [{ kind: "artifact", ref: ".brain/03-memory/curated-memory.json" }],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function changePlanDigest(
  observation: Extract<
    CommandObservation,
    { readonly kind: "memory"; readonly operation: "change" }
  >,
  reduction: Extract<MemoryChangeReduction, { readonly kind: "ready" }>,
): string {
  return observation.digest(
    canonicalizeJson({
      proposalDigest: observation.proposalDigest,
      now: observation.now,
      ledger: observation.ledger,
      projection: observation.projection,
      candidateFingerprints: [...observation.candidateExpected].sort(
        ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
      ),
      next: reduction.ledger,
    }),
  );
}

export function renderMemoryApplyCommand(
  invocation: Invocation,
  proposalDigest: string,
  planDigest: string,
  planTime: string,
): string {
  return renderPosixCommand(
    memoryApplyArgv(invocation, proposalDigest, planDigest, planTime),
  );
}

function memoryCurationApplyArgv(
  invocation: Invocation,
  scoredPlanDigest: string,
  approvalDigest: string,
  planDigest: string,
  planTime: string,
): string[] {
  const approvalPath = invocation.positionals[0] ?? "";
  const argv = [
    "kratos",
    "memory",
    "curate",
    "--as-of",
    String(invocation.flags.get("--as-of")),
    approvalPath,
  ];
  const root = invocation.flags.get("--root");
  if (typeof root === "string") argv.push("--root", root);
  argv.push(
    "--yes",
    "--plan-digest",
    planDigest,
    "--approval-digest",
    approvalDigest,
    "--plan-time",
    planTime,
  );
  // The approval itself binds to the scored digest. Keep it visible in the
  // canonical replay even though it is not a separate authority flag.
  void scoredPlanDigest;
  return argv;
}

export function memoryApplyArgv(
  invocation: Invocation,
  proposalDigest: string,
  planDigest: string,
  planTime: string,
): string[] {
  const root = invocation.flags.get("--root");
  return [
    "kratos",
    ...invocation.command.path,
    typeof root === "string" ? "--root" : null,
    typeof root === "string" ? root : null,
    invocation.positionals[0] ?? "<proposal>",
    "--yes",
    "--proposal-digest",
    proposalDigest,
    "--plan-digest",
    planDigest,
    "--plan-time",
    planTime,
  ].filter((part): part is string => part !== null);
}

function write(
  path: string,
  value: unknown,
  expected: WriteFilePrecondition,
): Extract<Effect, { kind: "write_file" }> {
  return {
    path,
    content: `${JSON.stringify(value, null, 2)}\n`,
    expected,
    kind: "write_file",
  };
}

function internal(): Decision {
  return {
    result: resultFor("runtime.internal_failure"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function usage(): Decision {
  return {
    result: resultFor("trail.uso"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
