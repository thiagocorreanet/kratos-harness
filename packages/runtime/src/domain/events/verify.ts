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

const verifiedStreams = new WeakSet<object>();

/** Internal provenance check; intentionally not re-exported by the package API. */
export function isVerifiedEventStream(
  value: unknown,
): value is VerifiedEventStream {
  return (
    typeof value === "object" && value !== null && verifiedStreams.has(value)
  );
}

function deeplyFreeze<Value>(
  value: Value,
  seen = new WeakSet<object>(),
): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deeplyFreeze(child, seen);
  return Object.freeze(value);
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
  const verified = deeplyFreeze({ events, cursor, canonical: text });
  verifiedStreams.add(verified);
  return verified;
}
