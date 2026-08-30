import { planOf, type Effect, type WriteFilePrecondition } from "../effects.js";
import {
  projectCuratedMemory,
  reduceMemoryChange,
  type MemoryChangeReduction,
} from "../memory/index.js";
import { resultFor } from "../result/index.js";
import { canonicalizeJson } from "../schema/index.js";

import { observingCommand } from "./observed.js";
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
    if (!decision.write) {
      return {
        result: resultFor("runtime.orientation_ok", {
          summary: "The matching local memory candidate already exists.",
          evidence: [
            {
              kind: "artifact",
              ref: `.brain/03-memory/candidates/${decision.candidate.candidateId}.json`,
            },
          ],
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    const path = `.brain/03-memory/candidates/${decision.candidate.candidateId}.json`;
    return {
      result: resultFor("trail.ok", {
        summary: "The local memory candidate was captured.",
        evidence: [{ kind: "artifact", ref: path }],
      }),
      plan: planOf(write(path, decision.candidate, { kind: "missing" })),
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
      if (observation.operation !== "change") return internal();
      if (observation.proposal.operation !== path[1]) return usage();
      const reduction = reduceMemoryChange(
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
              `Apply command: ${renderMemoryApplyCommand(invocation, observation.proposalDigest, planDigest, observation.now)}`,
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
        reduction.ledger,
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
  const quote = (value: string): string =>
    /^[A-Za-z0-9_./:@=-]+$/u.test(value)
      ? value
      : `'${value.replaceAll("'", "'\\''")}'`;
  const root = invocation.flags.get("--root");
  return [
    "kratos",
    ...invocation.command.path,
    typeof root === "string" ? "--root" : null,
    typeof root === "string" ? quote(root) : null,
    quote(invocation.positionals[0] ?? "<proposal>"),
    "--yes",
    "--proposal-digest",
    proposalDigest,
    "--plan-digest",
    planDigest,
    "--plan-time",
    planTime,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
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
