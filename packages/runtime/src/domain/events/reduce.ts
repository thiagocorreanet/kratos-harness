import type { EventV1, SnapshotV1 } from "@mestre-yoda/contracts";

import {
  canonicalizeJson,
  prepareContract,
  type SchemaRegistry,
} from "../schema/index.js";
import { EventIntegrityError, type EventChainCursor } from "./model.js";
import type { VerifiedEventStream } from "./verify.js";

export type JsonState = unknown;

export interface EventReducerRegistry<State = JsonState> {
  readonly seed: State;
  readonly reducers: Readonly<
    Record<string, (state: State, event: EventV1) => State>
  >;
  materialize(state: State, cursor: EventChainCursor): SnapshotV1;
}

export interface ReplayResult<State = JsonState> {
  readonly state: State;
  readonly snapshot: SnapshotV1;
  readonly canonical: string;
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(canonicalizeJson(value)) as Value;
}

function invalidEvent(): never {
  throw new EventIntegrityError("invalid_event");
}

function reducerFor<State>(
  registry: EventReducerRegistry<State>,
  policyVersion: string,
): (state: State, event: EventV1) => State {
  const descriptor = Object.getOwnPropertyDescriptor(
    registry.reducers,
    policyVersion,
  );
  if (descriptor === undefined) {
    throw new EventIntegrityError("unsupported_policy");
  }
  if (!("value" in descriptor) || typeof descriptor.value !== "function") {
    invalidEvent();
  }
  return descriptor.value as (state: State, event: EventV1) => State;
}

function reduceOnce<State>(
  reducer: (state: State, event: EventV1) => State,
  state: State,
  event: EventV1,
): { readonly canonical: string; readonly result: State } {
  const stateInput = cloneJson(state);
  const eventInput = cloneJson(event);
  const stateBefore = canonicalizeJson(stateInput);
  const eventBefore = canonicalizeJson(eventInput);
  let result: State;
  try {
    result = reducer(stateInput, eventInput);
  } catch {
    return invalidEvent();
  }
  if (
    canonicalizeJson(stateInput) !== stateBefore ||
    canonicalizeJson(eventInput) !== eventBefore
  ) {
    return invalidEvent();
  }
  return { canonical: canonicalizeJson(result), result };
}

function materializeOnce<State>(
  materialize: EventReducerRegistry<State>["materialize"],
  state: State,
  cursor: EventChainCursor,
): string {
  const stateInput = cloneJson(state);
  const cursorInput = cloneJson(cursor);
  const stateBefore = canonicalizeJson(stateInput);
  const cursorBefore = canonicalizeJson(cursorInput);
  let snapshot: SnapshotV1;
  try {
    snapshot = materialize(stateInput, cursorInput);
  } catch {
    return invalidEvent();
  }
  if (
    canonicalizeJson(stateInput) !== stateBefore ||
    canonicalizeJson(cursorInput) !== cursorBefore
  ) {
    return invalidEvent();
  }
  return canonicalizeJson(snapshot);
}

function hasFinalBindings(
  snapshot: SnapshotV1,
  stream: VerifiedEventStream,
): boolean {
  const event = stream.events.at(-1);
  return (
    event !== undefined &&
    snapshot.eventCursor === stream.cursor.revision &&
    snapshot.eventHash === stream.cursor.hash &&
    snapshot.policyVersion === event.policyVersion &&
    snapshot.updatedAt === event.occurredAt
  );
}

export function replayEventStream<State = JsonState>(
  stream: VerifiedEventStream,
  registry: EventReducerRegistry<State>,
  schemaRegistry: SchemaRegistry,
): ReplayResult<State> {
  try {
    if (stream.events.length === 0) invalidEvent();

    let state = cloneJson(registry.seed);
    for (const event of stream.events) {
      const reducer = reducerFor(registry, event.policyVersion);
      const first = reduceOnce(reducer, state, event);
      const second = reduceOnce(reducer, state, event);
      if (first.canonical !== second.canonical) invalidEvent();
      state = cloneJson(first.result);
    }

    const firstSnapshot = materializeOnce(
      (materializedState, materializedCursor) =>
        registry.materialize(materializedState, materializedCursor),
      state,
      stream.cursor,
    );
    const secondSnapshot = materializeOnce(
      (materializedState, materializedCursor) =>
        registry.materialize(materializedState, materializedCursor),
      state,
      stream.cursor,
    );
    if (firstSnapshot !== secondSnapshot) invalidEvent();

    const snapshot = JSON.parse(firstSnapshot) as SnapshotV1;
    if (!hasFinalBindings(snapshot, stream)) invalidEvent();

    const prepared = prepareContract(schemaRegistry, {
      id: "state.snapshot",
      version: "1.0.0",
      value: snapshot,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (prepared.kind === "invalid") invalidEvent();

    return {
      state: cloneJson(state),
      snapshot: cloneJson(prepared.value),
      canonical: prepared.canonical,
    };
  } catch (error: unknown) {
    if (error instanceof EventIntegrityError) throw error;
    throw new EventIntegrityError("invalid_event");
  }
}
