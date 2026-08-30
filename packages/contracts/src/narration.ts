export type BeatKind =
  "work" | "milestone" | "resumption" | "warning" | "waiting" | "stop";

export interface BeatV1 {
  readonly contractVersion: "1.0.0";
  readonly beatId: string;
  readonly kind: BeatKind;
  readonly subject: string;
  readonly sentence: string;
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly revision: number;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly evidenceRefs: readonly string[];
}

export interface ClockDerivedProgress {
  readonly kind: "in_progress";
  readonly eventId: string;
  readonly operation: string;
  readonly elapsedMs: number;
  readonly startedAt: string;
  readonly asOf: string;
}

export interface NarrationV1 {
  readonly contractVersion: "1.0.0";
  readonly runId: string;
  readonly generatedAt: string;
  readonly beats: readonly BeatV1[];
  readonly pendingProgress: ClockDerivedProgress | null;
}
