import { spawnSync } from "node:child_process";

function execute(spawnRuntime, runtimeEntry, args, input) {
  const result = spawnRuntime(process.execPath, [runtimeEntry, ...args], {
    encoding: "utf8",
    input,
  });
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/** Build the literal CLI transport used by both packaged phase relays. */
export function createPhaseRuntimeTransport({
  root,
  runtimeEntry,
  spawnRuntime = spawnSync,
}) {
  return Object.freeze({
    handoff: async () => {
      const rendering = execute(
        spawnRuntime,
        runtimeEntry,
        ["--json", "handoff", "--root", root],
        undefined,
      );
      if (rendering.exitCode !== 0) {
        return { kind: "refused", rendering };
      }
      return { kind: "ready", handoff: JSON.parse(rendering.stdout) };
    },
    record: async (message) => {
      if (message.messageType !== "request") {
        throw new Error("Expected an agent record request");
      }
      return execute(
        spawnRuntime,
        runtimeEntry,
        [
          "--json",
          "agent",
          "record",
          message.payload.ref,
          "--correlation-id",
          message.correlationId,
          "--root",
          root,
        ],
        `${JSON.stringify(message)}\n`,
      );
    },
  });
}
