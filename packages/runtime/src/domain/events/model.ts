import type { EventV1 } from "@mestre-yoda/contracts";

import type { Digests } from "../../ports/index.js";
import type { SchemaRegistry } from "../schema/index.js";

export type EventDraftV1 = Omit<EventV1, "previousHash" | "eventHash">;

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
  readonly digests: Digests;
  readonly schemaRegistry: SchemaRegistry;
}
