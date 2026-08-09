import type { EffectPlan } from "../domain/effects.js";
import {
  nodeClock,
  nodeEnvironment,
  nodeFileSystem,
  nodeGit,
  nodeIds,
  nodeLocks,
  nodeOutput,
} from "../infra/node/index.js";
import type { RuntimePorts } from "../ports/index.js";

export { configurationValidator, createSchemaRegistry } from "./schema.js";
export {
  executeManagedMutation,
  inspectManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  type TransactionReceipt,
  type TransactionServices,
  type TransactionSummary,
} from "./transactions.js";

/**
 * The one place effect implementations are chosen.
 *
 * Overrides come from an explicit caller argument and nothing else: there is no
 * environment check and no test-mode branch, so production code has no path to
 * a fake at all. A key that is absent keeps the real implementation; a key that
 * is present replaces exactly that port.
 */
export function createRuntime(
  overrides: Partial<RuntimePorts> = {},
): RuntimePorts {
  const root = overrides.environment?.workingDirectory() ?? process.cwd();
  return createRuntimeAt(root, overrides);
}

/** Compose mutation ports only after project discovery selects a root. */
export function createRuntimeAt(
  root: string,
  overrides: Partial<RuntimePorts> = {},
): RuntimePorts {
  return {
    clock: nodeClock(),
    ids: nodeIds(),
    fileSystem: nodeFileSystem(root),
    git: nodeGit(root),
    locks: nodeLocks(root),
    environment: nodeEnvironment(),
    output: nodeOutput(),
    ...overrides,
  };
}

/** Where `append_event` effects are recorded, relative to the project root. */
const eventLogPath = ".brain/events.jsonl";

/**
 * Perform an effect plan in declared order.
 *
 * The switch is exhaustive, so adding an effect variant without handling it
 * fails the type check rather than being silently skipped. A failing effect
 * stops the run instead of being stepped over; making the already-applied
 * prefix roll back is `RUN-05`'s transaction boundary, not this function's.
 */
export async function applyPlan(
  plan: EffectPlan,
  ports: RuntimePorts,
): Promise<void> {
  for (const effect of plan.effects) {
    switch (effect.kind) {
      case "write_file":
        await ports.fileSystem.write(effect.path, effect.content);
        break;
      case "delete_file":
        await ports.fileSystem.remove(effect.path);
        break;
      case "create_directory":
        await ports.fileSystem.makeDirectory(effect.path);
        break;
      case "append_event": {
        // Distinguish "no log yet" from "the log could not be read". Catching
        // every failure and writing an empty prefix would replace an existing
        // log with a single line on any transient error -- silent,
        // unrecoverable data loss in the precursor to the event store.
        const present = (await ports.fileSystem.stat(eventLogPath)) !== null;
        const existing = present
          ? await ports.fileSystem.read(eventLogPath)
          : "";
        await ports.fileSystem.write(
          eventLogPath,
          `${existing}${effect.event}\n`,
        );
        break;
      }
      case "emit":
        if (effect.channel === "structured")
          ports.output.structured(effect.text);
        else ports.output.human(effect.text);
        break;
      /* v8 ignore start -- unreachable by construction; see below */
      default: {
        // Without this the switch carries no exhaustiveness obligation, because
        // the function returns void. A new effect kind would then be silently
        // no-op'd, which is the worst possible failure for an effect applier.
        //
        // It is unreachable while `Effect` is fully handled, so it is excluded
        // from coverage rather than kept alive by a test that would have to
        // defeat the type system to reach it. Its real assertion is at compile
        // time: adding a variant makes `never` fail to accept it.
        const unhandled: never = effect;
        throw new Error(`Unhandled effect kind: ${JSON.stringify(unhandled)}`);
      }
      /* v8 ignore stop */
    }
  }
}
