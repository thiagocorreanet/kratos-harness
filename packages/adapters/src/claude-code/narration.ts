import type {
  BeatKind,
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
} from "@kratos/contracts";

const CLAUDE_CODE_MARKERS: Readonly<Record<BeatKind, string>> = Object.freeze({
  work: "● [WORK]",
  milestone: "◆ [MILESTONE]",
  resumption: "▲ [RESUME]",
  warning: "⚠️ [WARN]",
  waiting: "⏳ [WAIT]",
  stop: "🛑 [STOP]",
});

function formatClaudeCodeBeat(beat: BeatV1): string {
  const marker = CLAUDE_CODE_MARKERS[beat.kind];
  const evidence =
    beat.evidenceRefs.length > 0
      ? ` (evidence: ${beat.evidenceRefs.join(", ")})`
      : "";
  return `${marker} ${beat.subject}: ${beat.sentence}${evidence}`;
}

function formatClaudeCodePendingProgress(
  progress: ClockDerivedProgress,
): string {
  const elapsedSec = Math.floor(progress.elapsedMs / 1000);
  return `⏱ [IN PROGRESS] ${progress.operation} (elapsed: ${String(elapsedSec)}s) [clock-derived]`;
}

export function renderClaudeCodeNarration(narration: NarrationV1): string {
  const lines: string[] = narration.beats.map(formatClaudeCodeBeat);
  if (narration.pendingProgress !== null) {
    lines.push(formatClaudeCodePendingProgress(narration.pendingProgress));
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
