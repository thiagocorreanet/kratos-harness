import type {
  BeatKind,
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
} from "@kratos/contracts";

const CODEX_KIND_TAGS: Readonly<Record<BeatKind, string>> = Object.freeze({
  work: "WORK",
  milestone: "MILESTONE",
  resumption: "RESUME",
  warning: "WARN",
  waiting: "WAIT",
  stop: "STOP",
});

function formatCodexBeat(beat: BeatV1): string {
  const tag = CODEX_KIND_TAGS[beat.kind];
  const lines: string[] = [
    `[BEAT:${tag}]`,
    `subject: ${beat.subject}`,
    `sentence: ${beat.sentence}`,
    `reason: ${beat.reasonCode}`,
  ];
  if (beat.evidenceRefs.length > 0) {
    lines.push(`evidence: ${beat.evidenceRefs.join(", ")}`);
  }
  return lines.join("\n");
}

function formatCodexPendingProgress(progress: ClockDerivedProgress): string {
  const elapsedSec = Math.floor(progress.elapsedMs / 1000);
  return [
    `[PROGRESS:IN_PROGRESS]`,
    `operation: ${progress.operation}`,
    `elapsed: ${String(elapsedSec)}s`,
    `status: clock-derived`,
  ].join("\n");
}

export function renderCodexNarration(narration: NarrationV1): string {
  const blocks: string[] = narration.beats.map(formatCodexBeat);
  if (narration.pendingProgress !== null) {
    blocks.push(formatCodexPendingProgress(narration.pendingProgress));
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}
