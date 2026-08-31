import type {
  EventV1,
  EventV1_1,
  EventV1_2,
  EventV1_3,
  EventV1_4,
} from "@kratos/contracts";

import type { Digests } from "../../ports/index.js";
import type { SchemaRegistry } from "../schema/index.js";

export type ReadableEvent =
  EventV1 | EventV1_1 | EventV1_2 | EventV1_3 | EventV1_4;
type UnsealedEventDraft<Event> = Omit<Event, "previousHash" | "eventHash"> & {
  readonly previousHash?: never;
  readonly eventHash?: never;
};
export type CurrentEventDraft = UnsealedEventDraft<EventV1_2>;
export type ResolutionEventDraft = UnsealedEventDraft<EventV1_3>;
export type UpgradeEventDraft = UnsealedEventDraft<EventV1_4>;
export type PreviousEventDraft = UnsealedEventDraft<EventV1_1>;
export type SealableEventDraft =
  | PreviousEventDraft
  | CurrentEventDraft
  | ResolutionEventDraft
  | UpgradeEventDraft;
export type LegacyEventDraft = UnsealedEventDraft<EventV1>;
/** Transitional producer surface; sealing still rejects legacy drafts. */
export type EventDraftV1 = LegacyEventDraft | SealableEventDraft;

export interface EventChainCursor {
  readonly revision: number;
  readonly hash: string | null;
}

export type EventIntegrityKind =
  | "invalid_event"
  | "invalid_sequence"
  | "non_canonical"
  | "resource_limit"
  | "unsupported_policy";

export type EventContractFailure =
  "contract.state_version_invalid" | "contract.state_version_unsupported";

export class EventIntegrityError extends Error {
  public constructor(
    public readonly kind: EventIntegrityKind,
    public readonly reasonCode: EventContractFailure | null = null,
  ) {
    super("Event stream integrity validation failed");
    this.name = "EventIntegrityError";
  }
}

export interface EventServices {
  /** Only sha256 is used inside the event store; a full Digests would be an
   * unused capability that no test could honestly exercise. */
  readonly digests: Pick<Digests, "sha256">;
  readonly isProxy: (value: object) => boolean;
  readonly isPromise: (value: object) => boolean;
  readonly schemaRegistry: SchemaRegistry;
}
