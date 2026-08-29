import type { EventV1, EventV1_1 } from "@kratos/contracts";

import type { Digests } from "../../ports/index.js";
import type { SchemaRegistry } from "../schema/index.js";

export type ReadableEvent = EventV1 | EventV1_1;
export type CurrentEventDraft = Omit<EventV1_1, "previousHash" | "eventHash">;
export type LegacyEventDraft = Omit<EventV1, "previousHash" | "eventHash">;
/** Transitional producer surface; sealing still rejects legacy drafts. */
export type EventDraftV1 = LegacyEventDraft | CurrentEventDraft;

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
