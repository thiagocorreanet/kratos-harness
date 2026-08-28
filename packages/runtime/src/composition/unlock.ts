import type { GateFactsV1, RunUsageV1 } from "@kratos/contracts";

import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { WriteFilePrecondition } from "../domain/effects.js";
import { initialRunUsage } from "../domain/hooks/index.js";
import { usageFailure } from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { DurableEntry, RuntimePorts } from "../ports/index.js";

import type { Observed } from "./init.js";
import { anchorPorts, resolveCommandRoot } from "./root.js";

export async function observeStopLossUnlock(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  const feature = await line(".brain/02-features/active", anchored);
  if (feature === null) return failure("No active feature can be unlocked.");
  const runId = await line(
    `.brain/02-features/${feature}/active-run`,
    anchored,
  );
  if (runId === null) return failure("No active run can be unlocked.");
  const now = anchored.clock.now().toISOString();
  const runRoot = `.brain/02-features/${feature}/runs/${runId}`;
  const usagePath = `${runRoot}/usage.json`;
  const usageEntry = await anchored.durableFileSystem.inspect(usagePath);
  const usage = await validated<RunUsageV1>(
    usagePath,
    "state.run-usage",
    usageEntry,
    anchored,
    registry,
  );
  const gatesPath = `${runRoot}/gates.json`;
  const gatesEntry = await anchored.durableFileSystem.inspect(gatesPath);
  const gates = await validated<GateFactsV1>(
    gatesPath,
    "state.gates",
    gatesEntry,
    anchored,
    registry,
  );
  if (gates === null) return failure("The run has no readable gate facts.");
  const observation: CommandObservation = {
    kind: "stop-loss-unlock",
    feature,
    runId,
    now,
    confirmation: await anchored.standardInput.read(),
    usage: usage ?? initialRunUsage(runId, now),
    usageExpected: precondition(usageEntry),
    gates,
    gatesExpected: precondition(gatesEntry),
  };
  return { kind: "observed", observation, ports: anchored };
}

async function line(path: string, ports: RuntimePorts): Promise<string | null> {
  if ((await ports.durableFileSystem.inspect(path)).kind !== "file")
    return null;
  const value = (await ports.durableFileSystem.readText(path))
    .split("\n")[0]
    ?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

async function validated<T>(
  path: string,
  id: "state.run-usage" | "state.gates",
  entry: DurableEntry,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<T | null> {
  if (entry.kind !== "file") return null;
  try {
    const result = registry.validate({
      id,
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return result.kind === "valid" ? (result.value as T) : null;
  } catch {
    return null;
  }
}

function precondition(entry: DurableEntry): WriteFilePrecondition {
  return entry.kind === "file"
    ? { kind: "file", size: entry.size, sha256: entry.sha256 }
    : { kind: "missing" };
}

function failure(why: string): Extract<Observed, { kind: "failure" }> {
  return { kind: "failure", result: usageFailure(why) };
}
