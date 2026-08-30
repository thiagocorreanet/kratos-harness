import type {
  BeatKind,
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
  ReadableEvent,
} from "@kratos/contracts";

export interface ProjectNarrationOptions {
  readonly runId?: string;
  readonly asOf?: string;
}

export type {
  BeatKind,
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
  ReadableEvent,
};
