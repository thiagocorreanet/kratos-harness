import { CONTRACT_VERSIONS } from "@kratos/contracts";

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
  resultFor,
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

import { applyPlan, previewPlan, type MutationPreview } from "./index.js";
import { declaredContractVersion } from "./contract-version.js";
import { observeInitialization } from "./init.js";
import { observeHostOperation } from "./host.js";
import { observeStopLossUnlock } from "./unlock.js";
import { observeMigration } from "./migration.js";
import { observeObjective } from "./objective.js";
import { observeWorkflow } from "./workflow.js";
import { renderPhaseHandoffHuman } from "../domain/cli/diagnostics.js";
import { planOf } from "../domain/effects.js";
import { createSchemaRegistry } from "./schema.js";
import { TransactionFailure } from "./transactions.js";
import { observeGuardWrite, observeScopeRecord } from "./write-guard.js";
import { observeMemory } from "./memory.js";

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
  const version = declaredContractVersion(
    payload,
    "hostContract",
    CONTRACT_VERSIONS["host.adapter-message"],
  );
  const prepared = prepareContract(registry, {
    id: "host.adapter-message",
    version,
    value: payload,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    throw new Error("Command payload does not satisfy its declared contract");
  }
  validatePublicText(prepared.canonical);
  return `${prepared.canonical}\n`;
}

function preparePhaseHandoffPayload(
  payload: unknown,
  registry: SchemaRegistry,
): {
  readonly canonical: string;
  readonly value: Parameters<typeof renderPhaseHandoffHuman>[0];
} {
  const version = declaredContractVersion(
    payload,
    "hostContract",
    CONTRACT_VERSIONS["host.phase-handoff"],
  );
  const prepared = prepareContract(registry, {
    id: "host.phase-handoff",
    version,
    value: payload,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    throw new Error("Command payload does not satisfy its declared contract");
  }
  validatePublicText(prepared.canonical);
  return { canonical: prepared.canonical, value: prepared.value };
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
      // One shape, one failure path. Each observer collects what its command
      // declared and returns the ports the plan must be committed through,
      // because a command may target a directory other than the one this
      // process started in.
      const observed =
        invocation.command.prerequisite === "initialization"
          ? await observeInitialization(invocation, ports, schemaRegistry)
          : invocation.command.prerequisite === "objective"
            ? await observeObjective(invocation, ports, schemaRegistry)
            : invocation.command.prerequisite === "write-guard"
              ? await observeGuardWrite(invocation, ports, schemaRegistry)
              : invocation.command.prerequisite === "scope-record"
                ? await observeScopeRecord(invocation, ports, schemaRegistry)
                : invocation.command.prerequisite === "memory"
                  ? await observeMemory(invocation, ports, schemaRegistry)
                  : invocation.command.prerequisite === "host-operation"
                    ? await observeHostOperation(
                        invocation,
                        ports,
                        schemaRegistry,
                      )
                    : invocation.command.prerequisite === "stop-loss-unlock"
                      ? await observeStopLossUnlock(
                          invocation,
                          ports,
                          schemaRegistry,
                        )
                      : invocation.command.prerequisite === "migration"
                        ? await observeMigration(
                            invocation,
                            ports,
                            schemaRegistry,
                          )
                        : await observeWorkflow(
                            invocation,
                            ports,
                            schemaRegistry,
                          );
      if (observed.kind === "failure") {
        return publish(observed.result, json, ports);
      }
      invocation = { ...invocation, observation: observed.observation };
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
    } else if (invocation.command.jsonContract === "phase-handoff@1.2.0") {
      if (decision.payload === undefined) {
        throw new Error("Command payload is absent");
      }
      const handoff = preparePhaseHandoffPayload(
        decision.payload,
        schemaRegistry,
      );
      preparedOutput = json
        ? `${handoff.canonical}\n`
        : renderPhaseHandoffHuman(handoff.value);
    } else if (!json) {
      preparedOutput = decision.humanStdout ?? `${decision.result.summary}\n`;
      validatePublicText(preparedOutput);
    }
    let expectedPreview: MutationPreview | undefined;
    if (decision.revalidatePhaseAssignmentDigest !== undefined) {
      const refreshed = await observeWorkflow(
        invocation,
        applyPorts,
        schemaRegistry,
      );
      if (
        refreshed.kind !== "observed" ||
        refreshed.observation.kind !== "workflow" ||
        refreshed.observation.phaseAssignment.kind !== "resolved" ||
        refreshed.observation.phaseAssignment.value.assignmentDigest !==
          decision.revalidatePhaseAssignmentDigest
      ) {
        return publish(
          resultFor("model.assignment_stale", {
            why: [
              "The phase assignment changed before its event could be appended.",
            ],
            evidence: [
              {
                kind: "observation",
                ref: "model-routing/phase-execution",
              },
            ],
          }),
          json,
          ports,
        );
      }
    }
    if (decision.revalidateRepairDigest !== undefined) {
      const refreshed = await observeWorkflow(
        invocation,
        applyPorts,
        schemaRegistry,
      );
      if (
        refreshed.kind !== "observed" ||
        refreshed.observation.kind !== "workflow" ||
        refreshed.observation.repairPlan?.planDigest !==
          decision.revalidateRepairDigest
      ) {
        throw new TransactionFailure("runtime.revision_conflict", [
          {
            kind: "artifact",
            ref: `.brain/02-features/${
              invocation.observation.kind === "workflow"
                ? invocation.observation.configuration.feature
                : "active"
            }`,
          },
        ]);
      }
      expectedPreview = await previewPlan(decision.plan, applyPorts, {
        rootMode: decision.rootMode ?? "existing",
      });
    }
    const outcome = await applyPlan(
      decision.plan,
      applyPorts,
      decision.eventReducers === undefined
        ? expectedPreview === undefined
          ? { rootMode: decision.rootMode ?? "existing" }
          : {
              rootMode: decision.rootMode ?? "existing",
              expectPreview: expectedPreview,
            }
        : {
            rootMode: decision.rootMode ?? "existing",
            eventReducers: decision.eventReducers,
          },
    );
    if (
      outcome.kind === "committed" &&
      decision.cleanupCandidates !== undefined
    ) {
      for (const candidate of decision.cleanupCandidates) {
        try {
          await applyPlan(
            planOf({
              kind: "delete_file",
              path: candidate.path,
              expected: candidate.expected,
            }),
            applyPorts,
            { rootMode: "existing" },
          );
        } catch {
          // Candidate cleanup is deliberately best effort after authority commits.
        }
      }
    }
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
