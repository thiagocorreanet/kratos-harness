import type { PreToolUseV1 } from "@kratos/contracts";

import {
  preToolRequest,
  record,
  relayPreToolUse,
  uninspectablePreToolRequest,
  type GuardExecutor,
  type NormalizedPreToolUse,
  type PreToolRelayResult,
} from "../pre-tool-use.js";

type Mutation = PreToolUseV1["mutations"][number];

function actionPath(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const path = line.slice(prefix.length);
  return path.length === 0 ? null : path;
}

function parsePatch(command: string): readonly Mutation[] | null {
  const lines = command.split(/\r?\n/u);
  while (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") {
    return null;
  }

  const mutations: Mutation[] = [];
  let current: number | null = null;
  for (const line of lines) {
    const create = actionPath(line, "*** Add File: ");
    if (create !== null) {
      mutations.push({ kind: "create", path: create });
      current = mutations.length - 1;
      continue;
    }
    const update = actionPath(line, "*** Update File: ");
    if (update !== null) {
      mutations.push({ kind: "update", path: update });
      current = mutations.length - 1;
      continue;
    }
    const remove = actionPath(line, "*** Delete File: ");
    if (remove !== null) {
      mutations.push({ kind: "delete", path: remove });
      current = mutations.length - 1;
      continue;
    }
    const destination = actionPath(line, "*** Move to: ");
    if (destination !== null) {
      if (current === null) return null;
      const source = mutations[current];
      if (source?.kind !== "update") return null;
      mutations[current] = {
        kind: "move",
        source: source.path,
        destination,
      };
      continue;
    }
    if (line === "*** End of File") continue;
    if (line.startsWith("*** ")) return null;
  }
  return mutations.length === 0 ? null : mutations;
}

export function normalizeCodexPreToolUse(input: unknown): NormalizedPreToolUse {
  const native = record(input);
  const toolName = native?.tool_name;
  if (typeof toolName === "string" && toolName !== "apply_patch") {
    return { kind: "pass" };
  }
  if (toolName !== "apply_patch") {
    return { kind: "guard", request: uninspectablePreToolRequest() };
  }
  const command = record(native?.tool_input)?.command;
  const mutations = typeof command === "string" ? parsePatch(command) : null;
  if (mutations === null) {
    return { kind: "guard", request: uninspectablePreToolRequest() };
  }
  return {
    kind: "guard",
    request: preToolRequest(mutations as PreToolUseV1["mutations"]),
  };
}

export function relayCodexPreToolUse(
  input: unknown,
  execute: GuardExecutor,
): PreToolRelayResult {
  return relayPreToolUse(input, normalizeCodexPreToolUse(input), execute);
}
