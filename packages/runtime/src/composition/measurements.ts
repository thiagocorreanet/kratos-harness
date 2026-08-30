import type { RunUsageV1 } from "@kratos/contracts";

import type { WriteFilePrecondition } from "../domain/effects.js";
import { initialRunUsage } from "../domain/hooks/index.js";
import {
  parsePhaseMeasurementLog,
  type PhaseMeasurement,
} from "../domain/measurements/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { DurableEntry, RuntimePorts } from "../ports/index.js";

export const PHASE_MEASUREMENT_LOG = ".brain/03-memory/task_log.jsonl";

export interface PhaseMeasurementLogObservation {
  readonly content: string;
  readonly records: readonly PhaseMeasurement[];
  readonly expected: WriteFilePrecondition;
}

export async function observePhaseMeasurementLog(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseMeasurementLogObservation | null> {
  const entry = await ports.durableFileSystem.inspect(PHASE_MEASUREMENT_LOG);
  if (entry.kind === "missing") {
    return { content: "", records: [], expected: { kind: "missing" } };
  }
  if (entry.kind !== "file") return null;
  try {
    const content = await ports.durableFileSystem.readText(
      PHASE_MEASUREMENT_LOG,
    );
    return {
      content,
      records: parsePhaseMeasurementLog(content, registry),
      expected: precondition(entry),
    };
  } catch {
    return null;
  }
}

export async function observeRunUsage(
  feature: string,
  runId: string,
  now: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<RunUsageV1> {
  const path = `.brain/02-features/${feature}/runs/${runId}/usage.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") return initialRunUsage(runId, now);
  try {
    const validated = registry.validate({
      id: "state.run-usage",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    return validated.kind === "valid"
      ? validated.value
      : initialRunUsage(runId, now);
  } catch {
    return initialRunUsage(runId, now);
  }
}

function precondition(entry: DurableEntry): WriteFilePrecondition {
  return entry.kind === "file"
    ? { kind: "file", size: entry.size, sha256: entry.sha256 }
    : { kind: "missing" };
}
