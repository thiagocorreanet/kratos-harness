import type { AgentOutputV1 } from "@kratos/contracts";

import {
  checkAgentOutput,
  describeAgentOutputFailure,
  describeAgentOutputRefusal,
  describeBlockMalformation,
  type AgentOutputObservation,
} from "../agent/index.js";
import { planOf, type Effect } from "../effects.js";
import { resultFor, type Result } from "../result/index.js";
import {
  decideRecordFact,
  workflowReducerRegistry,
  type WorkflowDecision,
} from "../workflow/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

export const agentRecordCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["agent", "record"],
    summary: "Extract, validate, and persist one agent reply's machine block.",
    flags: [
      {
        name: "--correlation-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this idempotency correlation identifier.",
      },
      {
        name: "--host",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the host that observed this operation.",
      },
      {
        name: "--model",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the model that observed this operation.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
    ],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => decideRecord(observation),
);

/**
 * Turn one agent reply into recorded, typed run state.
 *
 * The reply is model output, so the order here is the whole point: extract the
 * block, validate it against its published contract, check that it does not
 * contradict itself, and only then let any of it reach a decision. Every step
 * before the last one can only refuse; none of them can advance the run.
 */
function decideRecord(observation: Observation): Decision {
  const unusable = unusableState(observation);
  if (unusable !== null) return unusable;

  const observed = observation.agentOutput;
  if (observed.kind !== "valid") return refuseReply(observed);

  const refusal = checkAgentOutput(observed.value);
  if (refusal !== null) {
    return invalidOutput(observed.ref, describeAgentOutputRefusal(refusal));
  }

  const phase =
    observation.workflow.kind === "present"
      ? observation.workflow.state.currentStep
      : null;
  if (observed.value.agent !== phase) {
    return invalidOutput(
      observed.ref,
      `The ${observed.value.agent} agent addressed a run in the ${phase ?? "unselected"} phase.`,
    );
  }

  const path = outputPath(observation, observed.value.agent);
  const recorded = observation.agentOutputs.find(
    (candidate) => candidate.agent === observed.value.agent,
  );
  if (
    recorded !== undefined &&
    serialize(recorded) === serialize(observed.value)
  ) {
    return settled(
      `The ${observed.value.agent} agent output was already recorded.`,
      [path],
    );
  }

  return commit(
    observation,
    [
      {
        kind: "write_file",
        path,
        content: serialize(observed.value),
      },
    ],
    `Recorded the ${observed.value.agent} agent output as ${observed.value.outcome.status}.`,
    [path],
  );
}

/**
 * Report a reply the runtime cannot route on.
 *
 * The three answers stay apart on purpose. "Nothing was emitted", "something
 * was emitted that is not a block", and "a block was emitted that is not the
 * contract" are three different things to fix, and collapsing them would make
 * the caller guess which one happened.
 */
function refuseReply(
  observed: Exclude<AgentOutputObservation, { readonly kind: "valid" }>,
): Decision {
  switch (observed.kind) {
    case "none":
      return usage(["No agent reply was supplied to record."]);
    case "unreadable":
      return usage(["The agent reply could not be read as text."]);
    case "absent":
      return invalidOutput(observed.ref, "The reply carries no machine block.");
    case "malformed":
      return invalidOutput(
        observed.ref,
        describeBlockMalformation(observed.reason),
      );
    case "invalid":
      return invalidOutput(observed.ref, describeAgentOutputFailure(observed));
  }
}

/**
 * Persisted blocks are written exactly as validated, so reading one back
 * through the same contract yields the value the decision saw.
 */
function serialize(value: AgentOutputV1): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runRoot(observation: Observation): string {
  return `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`;
}

function outputPath(observation: Observation, agent: string): string {
  return `${runRoot(observation)}/agent-output/${agent}.json`;
}

function commit(
  observation: Observation,
  effects: readonly Effect[],
  summary: string,
  artifactRefs: readonly string[],
): Decision {
  const workflow = decideRecordFact(observation.workflow, {
    feature: observation.configuration.feature,
    runId: observation.configuration.runId,
    correlationId: observation.correlationId,
    eventId: observation.eventId,
    occurredAt: observation.occurredAt,
    expectedRevision:
      observation.workflow.kind === "present"
        ? observation.workflow.state.revision
        : 0,
    operation: "agent.record",
    artifactRefs,
    observedIdentity: observation.observedIdentity,
  });
  if (workflow.kind === "refused") return refused(workflow, observation);
  if (workflow.kind === "unchanged") {
    return settled(
      "The recording was already reflected in the run history.",
      artifactRefs,
    );
  }
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: true,
      evidence: [
        ...artifactRefs.map((ref) => ({ kind: "artifact" as const, ref })),
        { kind: "event" as const, ref: `${runRoot(observation)}/events.jsonl` },
      ],
    }),
    plan: planOf(...effects, {
      kind: "append_event",
      feature: observation.configuration.feature,
      runId: observation.configuration.runId,
      event: workflow.event,
    }),
    humanStdout: null,
    payload: null,
    eventReducers: workflowReducerRegistry(observation.configuration),
  };
}

/** Why this run cannot record an agent output right now, or null when it can. */
function unusableState(observation: Observation): Decision | null {
  if (
    observation.workflow.kind === "corrupt" ||
    !observation.agentOutputsReadable
  ) {
    return decisionOf(
      resultFor("runtime.state_corrupt", {
        why: ["The recorded agent output could not be read as its contract."],
        evidence: [{ kind: "artifact", ref: ".brain/02-features" }],
      }),
    );
  }
  if (observation.workflow.kind === "absent") {
    return decisionOf(
      resultFor("blocked.context_unreadable", {
        why: ["No active run exists to record an agent output against."],
        evidence: [{ kind: "artifact", ref: ".brain/02-features/active" }],
      }),
    );
  }
  return null;
}

function settled(summary: string, refs: readonly string[]): Decision {
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: false,
      evidence: refs.map((ref) => ({ kind: "artifact" as const, ref })),
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function invalidOutput(ref: string, why: string): Decision {
  return decisionOf(
    resultFor("trail.output_invalido", {
      why: [why],
      evidence: [{ kind: "observation", ref }],
    }),
  );
}

function usage(why: readonly string[]): Decision {
  return decisionOf(resultFor("trail.uso", { why: [...why], evidence: [] }));
}

function refused(
  workflow: Extract<WorkflowDecision, { readonly kind: "refused" }>,
  observation: Observation,
): Decision {
  return decisionOf(
    resultFor(workflow.reasonCode, {
      why: ["The run refused to record the agent output."],
      evidence:
        workflow.reasonCode === "trail.uso"
          ? []
          : [{ kind: "artifact", ref: `${runRoot(observation)}/state.json` }],
    }),
  );
}

function decisionOf(result: Result): Decision {
  return { result, plan: planOf(), humanStdout: null, payload: null };
}
