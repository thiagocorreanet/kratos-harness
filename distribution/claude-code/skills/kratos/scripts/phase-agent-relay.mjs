import { fileURLToPath } from "node:url";

import {
  defaultModelRouting,
  relaySelectedPhase as relay,
} from "../../../runtime/source/packages/adapters/src/index.js";
import { createPhaseRuntimeTransport } from "./phase-agent-runtime.mjs";

export const host = "claude-code";

export async function relaySelectedPhase(input) {
  const modelRouting =
    input.modelRouting ?? (await defaultModelRouting().observe("claude"));
  const runtime = createPhaseRuntimeTransport({
    root: input.root,
    host,
    runtimeEntry: fileURLToPath(
      new URL("../../../runtime/kratos.mjs", import.meta.url),
    ),
    ...(input.spawnRuntime === undefined
      ? {}
      : { spawnRuntime: input.spawnRuntime }),
  });
  return relay(host, { ...input, modelRouting, runtime });
}
