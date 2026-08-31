import type {
  EventV1_1,
  EventV1_2,
  EventV1_3,
  EventV1_4,
} from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";
import {
  EventIntegrityError,
  type EventChainCursor,
  type CurrentEventDraft,
  type EventServices,
  type PreviousEventDraft,
  type ResolutionEventDraft,
  type UpgradeEventDraft,
  type ReadableEvent,
} from "./model.js";
import { snapshotEventDraft } from "./redaction.js";

export function unsignedEvent<Event extends ReadableEvent>(
  event: Event,
): Omit<Event, "eventHash"> {
  const { eventHash, ...unsigned } = event;
  void eventHash;
  return unsigned;
}

export function sealEvent(
  input: UpgradeEventDraft,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_4;
export function sealEvent(
  input: ResolutionEventDraft,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_3;
export function sealEvent(
  input: CurrentEventDraft,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_2;
export function sealEvent(
  input: PreviousEventDraft,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_1;
export function sealEvent(
  input: CurrentEventDraft | ResolutionEventDraft | UpgradeEventDraft,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_2 | EventV1_3 | EventV1_4;
export function sealEvent(
  input: unknown,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_1 | EventV1_2 | EventV1_3 | EventV1_4;
export function sealEvent(
  input: unknown,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1_1 | EventV1_2 | EventV1_3 | EventV1_4 {
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
    version: event.stateContract,
    value: event,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (validated.kind === "invalid") {
    throw new EventIntegrityError("invalid_event");
  }
  return validated.value;
}
