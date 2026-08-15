import { CONTRACT_IDENTITIES, type EventV1 } from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";
import {
  EventIntegrityError,
  type EventChainCursor,
  type EventServices,
} from "./model.js";
import { snapshotEventDraft } from "./redaction.js";

export function unsignedEvent(event: EventV1): Omit<EventV1, "eventHash"> {
  const { eventHash, ...unsigned } = event;
  void eventHash;
  return unsigned;
}

export function sealEvent(
  input: unknown,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1 {
  const draft = snapshotEventDraft(input, services.isProxy);
  if (
    draft.priorRevision !== cursor.revision ||
    draft.resultingRevision !== cursor.revision + 1 ||
    (cursor.revision === 0) !== (cursor.hash === null)
  ) {
    throw new EventIntegrityError("invalid_sequence");
  }
  const unsigned = { ...draft, previousHash: cursor.hash };
  const event = {
    ...unsigned,
    eventHash: services.digests.sha256(canonicalizeJson(unsigned)),
  };
  const validated = services.schemaRegistry.validate({
    id: "state.event",
    version: CONTRACT_IDENTITIES.state,
    value: event,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (validated.kind === "invalid") {
    throw new EventIntegrityError("invalid_event");
  }
  return validated.value;
}
