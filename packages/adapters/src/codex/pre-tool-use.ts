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

const beginPatch = "*** Begin Patch";
const endPatch = "*** End Patch";
const environmentId = "*** Environment ID:";
const addFile = "*** Add File: ";
const deleteFile = "*** Delete File: ";
const updateFile = "*** Update File: ";
const moveTo = "*** Move to: ";
const endOfFile = "*** End of File";

type ParserMode = "started" | "add" | "delete" | "update" | "ended";

interface UpdateState {
  readonly mutationIndex: number;
  chunks: { hasLines: boolean; endOfFile: boolean }[];
  moved: boolean;
}

function isRustWhitespace(code: number): boolean {
  return (
    (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function rustTrimEnd(value: string): string {
  let end = value.length;
  while (end > 0 && isRustWhitespace(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

function rustTrim(value: string): string {
  let start = 0;
  while (start < value.length && isRustWhitespace(value.charCodeAt(start))) {
    start += 1;
  }
  return rustTrimEnd(value.slice(start));
}

function boundedPatchLines(command: string): string[] | null {
  const text = rustTrim(command);
  if (text.length === 0) return null;
  const original = text.split(/\r?\n/u);
  const bounded = (lines: string[]): string[] | null => {
    const firstLine = lines[0];
    const lastLine = lines.at(-1);
    return firstLine !== undefined &&
      lastLine !== undefined &&
      rustTrim(firstLine) === beginPatch &&
      rustTrim(lastLine) === endPatch
      ? lines
      : null;
  };
  const direct = bounded(original);
  if (direct !== null) return direct;
  const first = original[0];
  const last = original.at(-1);
  if (
    original.length >= 4 &&
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    last?.endsWith("EOF") === true
  ) {
    return bounded(original.slice(1, -1));
  }
  return null;
}

/**
 * Extract targets with the same line-state distinctions as Codex's current
 * StreamingPatchParser. Content is validated only far enough to ensure that a
 * line which could change parser state can never be silently ignored.
 */
function parsePatch(command: string): readonly Mutation[] | null {
  const bounded = boundedPatchLines(command);
  if (bounded === null) return null;
  const lines = bounded.slice(1, -1);
  const mutations: Mutation[] = [];
  const state: { mode: ParserMode; update: UpdateState | null } = {
    mode: "started",
    update: null,
  };
  const updateIsComplete = (): boolean =>
    state.update !== null &&
    state.update.chunks.length > 0 &&
    state.update.chunks.at(-1)?.hasLines === true;

  const startHunk = (line: string): "handled" | "not-handled" | "invalid" => {
    if (state.mode === "started" && line.startsWith(environmentId)) {
      return "invalid";
    }
    if (line === endPatch) {
      if (state.mode === "update" && !updateIsComplete()) return "invalid";
      state.mode = "ended";
      state.update = null;
      return "handled";
    }
    for (const [marker, kind] of [
      [addFile, "create"],
      [deleteFile, "delete"],
      [updateFile, "update"],
    ] as const) {
      if (!line.startsWith(marker)) continue;
      if (state.mode === "update" && !updateIsComplete()) return "invalid";
      const path = line.slice(marker.length);
      if (path.length === 0) return "invalid";
      mutations.push({ kind, path });
      state.mode = kind === "create" ? "add" : kind;
      state.update =
        kind === "update"
          ? {
              mutationIndex: mutations.length - 1,
              chunks: [],
              moved: false,
            }
          : null;
      return "handled";
    }
    return "not-handled";
  };

  for (const line of lines) {
    if (state.mode === "ended") {
      if (rustTrim(line).length !== 0) return null;
      continue;
    }

    if (state.mode !== "update") {
      const header = startHunk(rustTrim(line));
      if (header === "invalid") return null;
      if (header === "handled") continue;
      if (state.mode === "add" && line.startsWith("+")) continue;
      return null;
    }

    const updateLine = rustTrimEnd(line);
    const header = startHunk(updateLine);
    if (header === "invalid") return null;
    if (header === "handled") continue;
    const update = state.update;
    if (update === null) return null;

    const lastChunk = update.chunks.at(-1);
    if (lastChunk?.endOfFile === true) {
      if (updateLine.length === 0) continue;
      if (updateLine !== "@@" && !updateLine.startsWith("@@ ")) return null;
    }

    if (
      update.chunks.length === 0 &&
      !update.moved &&
      updateLine.startsWith(moveTo)
    ) {
      const destination = updateLine.slice(moveTo.length);
      const source = mutations[update.mutationIndex];
      if (destination.length === 0 || source?.kind !== "update") return null;
      mutations[update.mutationIndex] = {
        kind: "move",
        source: source.path,
        destination,
      };
      update.moved = true;
      continue;
    }

    if (
      (updateLine === "@@" || updateLine.startsWith("@@ ")) &&
      lastChunk?.hasLines === false
    ) {
      return null;
    }
    if (updateLine === "@@" || updateLine.startsWith("@@ ")) {
      update.chunks.push({ hasLines: false, endOfFile: false });
      continue;
    }
    if (updateLine === endOfFile) {
      if (lastChunk?.hasLines === false) return null;
      if (lastChunk !== undefined) lastChunk.endOfFile = true;
      continue;
    }
    if (
      line.length === 0 ||
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-")
    ) {
      if (update.chunks.length === 0) {
        update.chunks.push({ hasLines: false, endOfFile: false });
      }
      const chunk = update.chunks.at(-1);
      if (chunk === undefined) return null;
      chunk.hasLines = true;
      continue;
    }
    return null;
  }

  if (state.mode === "update" && !updateIsComplete()) return null;
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
