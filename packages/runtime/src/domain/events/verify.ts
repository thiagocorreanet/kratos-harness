import type { EventV1 } from "@mestre-yoda/contracts";

import { canonicalizeJson } from "../schema/index.js";
import {
  EventIntegrityError,
  type EventChainCursor,
  type EventServices,
} from "./model.js";
import { parseEventLines } from "./parse.js";
import { unsignedEvent } from "./seal.js";

export interface VerifiedEventStream {
  readonly events: readonly EventV1[];
  readonly cursor: EventChainCursor;
  readonly canonical: string;
}

export function verifyEventStream(
  text: string,
  services: EventServices,
): VerifiedEventStream {
  const events = parseEventLines(text, services.schemaRegistry);
  let cursor: EventChainCursor = { revision: 0, hash: null };
  for (const event of events) {
    if (
      event.priorRevision !== cursor.revision ||
      event.resultingRevision !== cursor.revision + 1 ||
      event.previousHash !== cursor.hash
    ) {
      throw new EventIntegrityError("invalid_sequence");
    }
    const expected = services.digests.sha256(
      canonicalizeJson(unsignedEvent(event)),
    );
    if (event.eventHash !== expected) {
      throw new EventIntegrityError("invalid_event");
    }
    cursor = { revision: event.resultingRevision, hash: event.eventHash };
  }
  return { events, cursor, canonical: text };
}
