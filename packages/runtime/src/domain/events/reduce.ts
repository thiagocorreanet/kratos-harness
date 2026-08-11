import type { EventV1, SnapshotV1 } from "@mestre-yoda/contracts";

import {
  canonicalizeJson,
  prepareContract,
  type SchemaRegistry,
} from "../schema/index.js";
import { EventIntegrityError, type EventChainCursor } from "./model.js";
import { isVerifiedEventStream, type VerifiedEventStream } from "./verify.js";

export type JsonState = unknown;

export interface ReplayServices {
  readonly isProxy: (value: object) => boolean;
  readonly isPromise: (value: object) => boolean;
  readonly schemaRegistry: SchemaRegistry;
}

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

const MISSING_REDUCER = Symbol("missing reducer");
const recognizedReducerRegistryFailures = new WeakSet<EventIntegrityError>();

interface TrackedViews {
  attempted: boolean;
  readonly rawByView: WeakMap<object, object>;
  readonly viewByRaw: WeakMap<object, object>;
}

interface InertRegistry<State> {
  readonly materialize: EventReducerRegistry<State>["materialize"];
  readonly reducers: ReadonlyMap<
    string,
    (state: State, event: EventV1) => State
  >;
  readonly seed: State;
}

function invalidEvent(): never {
  const error = new EventIntegrityError("invalid_event");
  recognizedReducerRegistryFailures.add(error);
  throw error;
}

/** The composition boundary must not trust caller-forged integrity errors. */
export function isRecognizedReducerRegistryFailure(
  error: unknown,
): error is EventIntegrityError {
  return (
    error instanceof EventIntegrityError &&
    recognizedReducerRegistryFailures.has(error)
  );
}

function isProxy(value: object, services: ReplayServices): boolean {
  try {
    return services.isProxy(value);
  } catch {
    return invalidEvent();
  }
}

function isPromise(value: object, services: ReplayServices): boolean {
  try {
    return services.isPromise(value);
  } catch {
    return invalidEvent();
  }
}

function ownData(value: object, key: PropertyKey): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) invalidEvent();
  return descriptor;
}

function plainObject(value: object, services: ReplayServices): void {
  if (isProxy(value, services) || Array.isArray(value)) invalidEvent();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidEvent();
}

function snapshotJson(
  value: unknown,
  services: ReplayServices,
  tracked?: TrackedViews,
): JsonState {
  return snapshotValue(value, services, tracked, new WeakSet<object>());
}

function normalizeJson(
  value: unknown,
  services: ReplayServices,
  tracked?: TrackedViews,
): JsonState {
  return JSON.parse(
    canonicalizeJson(snapshotJson(value, services, tracked)),
  ) as JsonState;
}

function snapshotValue(
  value: unknown,
  services: ReplayServices,
  tracked: TrackedViews | undefined,
  active: WeakSet<object>,
): JsonState {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidEvent();
    return value;
  }
  if (typeof value !== "object") invalidEvent();

  if (tracked?.rawByView.has(value) === true) {
    return snapshotValue(
      tracked.rawByView.get(value),
      services,
      tracked,
      active,
    );
  }
  if (isProxy(value, services) || active.has(value)) invalidEvent();
  active.add(value);
  try {
    if (Array.isArray(value))
      return snapshotArray(value, services, tracked, active);
    return snapshotObject(value, services, tracked, active);
  } finally {
    active.delete(value);
  }
}

function snapshotArray(
  value: unknown[],
  services: ReplayServices,
  tracked: TrackedViews | undefined,
  active: WeakSet<object>,
): JsonState {
  if (
    isProxy(value, services) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    invalidEvent();
  }
  const keys = Reflect.ownKeys(value);
  const entries = new Set<string>();
  let hasLength = false;
  for (const key of keys) {
    if (typeof key === "symbol") invalidEvent();
    if (key === "length") {
      hasLength = true;
    } else {
      entries.add(key);
    }
  }
  if (entries.size !== value.length || !hasLength) invalidEvent();

  const copy: JsonState[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!entries.has(key)) invalidEvent();
    const descriptor = ownData(value, key);
    if (!descriptor.enumerable) invalidEvent();
    copy.push(snapshotValue(descriptor.value, services, tracked, active));
  }
  return copy;
}

function snapshotObject(
  value: object,
  services: ReplayServices,
  tracked: TrackedViews | undefined,
  active: WeakSet<object>,
): JsonState {
  plainObject(value, services);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) invalidEvent();

  const copy = Object.create(null) as Record<string, JsonState>;
  for (const key of keys) {
    const descriptor = ownData(value, key);
    if (!descriptor.enumerable) invalidEvent();
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(descriptor.value, services, tracked, active),
      writable: true,
    });
  }
  return copy;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  services: ReplayServices,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) invalidEvent();
  plainObject(value, services);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    invalidEvent();
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = ownData(value, key);
    if (!descriptor.enumerable) invalidEvent();
    copy[key] = descriptor.value;
  }
  return copy;
}

function snapshotRegistry<State>(
  value: EventReducerRegistry<State>,
  services: ReplayServices,
): InertRegistry<State> {
  const root = exactDataRecord(
    value,
    ["seed", "reducers", "materialize"],
    services,
  );
  const reducersValue = root.reducers;
  if (typeof reducersValue !== "object" || reducersValue === null)
    invalidEvent();
  plainObject(reducersValue, services);
  const reducers = new Map<string, (state: State, event: EventV1) => State>();
  for (const key of Reflect.ownKeys(reducersValue)) {
    if (typeof key !== "string") invalidEvent();
    const descriptor = ownData(reducersValue, key);
    const reducer: unknown = descriptor.value;
    if (!descriptor.enumerable || typeof reducer !== "function") invalidEvent();
    if (isProxy(reducer, services)) invalidEvent();
    reducers.set(key, reducer as (state: State, event: EventV1) => State);
  }
  if (
    typeof root.materialize !== "function" ||
    isProxy(root.materialize, services)
  ) {
    invalidEvent();
  }
  return {
    materialize: root.materialize as EventReducerRegistry<State>["materialize"],
    reducers,
    seed: normalizeJson(root.seed, services) as State,
  };
}

/** Create the closed, immutable registry view used by replay. */
export function snapshotEventReducerRegistry<State>(
  value: EventReducerRegistry<State>,
  services: ReplayServices,
): EventReducerRegistry<State> {
  const inert = snapshotRegistry(value, services);
  const reducers = Object.create(null) as Record<
    string,
    (state: State, event: EventV1) => State
  >;
  for (const [key, reducer] of inert.reducers) reducers[key] = reducer;
  return Object.freeze({
    seed: freezeJson(inert.seed) as State,
    reducers: Object.freeze(reducers),
    materialize: inert.materialize,
  });
}

function freezeJson(value: JsonState): JsonState {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function snapshotStream(stream: VerifiedEventStream): {
  readonly cursor: EventChainCursor;
  readonly events: readonly EventV1[];
} {
  if (stream.events.length === 0) invalidEvent();
  return {
    cursor: stream.cursor,
    events: stream.events,
  };
}

function trackedViews(): TrackedViews {
  return {
    attempted: false,
    rawByView: new WeakMap<object, object>(),
    viewByRaw: new WeakMap<object, object>(),
  };
}

function trackedView<Value>(value: Value, tracked: TrackedViews): Value {
  if (typeof value !== "object" || value === null) return value;
  const existing = tracked.viewByRaw.get(value);
  if (existing !== undefined) return existing as Value;
  const view = new Proxy(value, {
    defineProperty: () => {
      tracked.attempted = true;
      return false;
    },
    deleteProperty: () => {
      tracked.attempted = true;
      return false;
    },
    get(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor !== undefined && "value" in descriptor) {
        const propertyValue: unknown = descriptor.value;
        return trackedView(propertyValue, tracked);
      }
      return Reflect.get(target, key, target);
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor === undefined || !("value" in descriptor))
        return descriptor;
      const propertyValue: unknown = descriptor.value;
      return { ...descriptor, value: trackedView(propertyValue, tracked) };
    },
    preventExtensions: () => {
      tracked.attempted = true;
      return false;
    },
    set: () => {
      tracked.attempted = true;
      return false;
    },
    setPrototypeOf: () => {
      tracked.attempted = true;
      return false;
    },
  });
  tracked.rawByView.set(view, value);
  tracked.viewByRaw.set(value, view);
  return view;
}

function reduceOnce<State>(
  reducer: (state: State, event: EventV1) => State,
  state: State,
  event: EventV1,
  services: ReplayServices,
): State {
  const tracked = trackedViews();
  const stateInput = trackedView(
    normalizeJson(state, services) as State,
    tracked,
  );
  const eventInput = trackedView(
    normalizeJson(event, services) as EventV1,
    tracked,
  );
  const result = reducer(stateInput, eventInput);
  rejectPromise(result, services, tracked);
  if (tracked.attempted) invalidEvent();
  return normalizeJson(result, services, tracked) as State;
}

function materializeOnce<State>(
  materialize: EventReducerRegistry<State>["materialize"],
  state: State,
  cursor: EventChainCursor,
  services: ReplayServices,
): SnapshotV1 {
  const tracked = trackedViews();
  const stateInput = trackedView(
    normalizeJson(state, services) as State,
    tracked,
  );
  const cursorInput = trackedView(
    normalizeJson(cursor, services) as EventChainCursor,
    tracked,
  );
  const result = materialize(stateInput, cursorInput);
  rejectPromise(result, services, tracked);
  if (tracked.attempted) invalidEvent();
  return normalizeJson(result, services, tracked) as SnapshotV1;
}

function rejectPromise(
  value: unknown,
  services: ReplayServices,
  tracked: TrackedViews,
): void {
  if (typeof value !== "object" || value === null) return;
  if (tracked.rawByView.has(value)) return;
  if (isProxy(value, services)) invalidEvent();
  if (!isPromise(value, services)) return;
  try {
    void Promise.prototype.then.call(value, undefined, () => undefined);
  } catch {
    invalidEvent();
  }
  invalidEvent();
}

function hasFinalBindings(
  snapshot: SnapshotV1,
  stream: {
    readonly cursor: EventChainCursor;
    readonly events: readonly EventV1[];
  },
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

function replay<State>(
  stream: VerifiedEventStream,
  registry: EventReducerRegistry<State>,
  services: ReplayServices,
): ReplayResult<State> | typeof MISSING_REDUCER {
  const verified = snapshotStream(stream);
  const inert = snapshotRegistry(registry, services);
  let state = inert.seed;
  for (const event of verified.events) {
    const reducer = inert.reducers.get(event.policyVersion);
    if (reducer === undefined) return MISSING_REDUCER;
    const first = reduceOnce(reducer, state, event, services);
    const second = reduceOnce(reducer, state, event, services);
    if (canonicalizeJson(first) !== canonicalizeJson(second)) invalidEvent();
    state = normalizeJson(first, services) as State;
  }

  const firstSnapshot = materializeOnce(
    inert.materialize,
    state,
    verified.cursor,
    services,
  );
  const secondSnapshot = materializeOnce(
    inert.materialize,
    state,
    verified.cursor,
    services,
  );
  const firstCanonical = canonicalizeJson(firstSnapshot);
  if (firstCanonical !== canonicalizeJson(secondSnapshot)) invalidEvent();
  if (!hasFinalBindings(firstSnapshot, verified)) invalidEvent();

  const prepared = prepareContract(services.schemaRegistry, {
    id: "state.snapshot",
    version: "1.0.0",
    value: firstSnapshot,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (prepared.kind === "invalid") invalidEvent();
  return {
    canonical: prepared.canonical,
    snapshot: normalizeJson(prepared.value, services) as SnapshotV1,
    state: normalizeJson(state, services) as State,
  };
}

export function replayEventStream<State = JsonState>(
  stream: VerifiedEventStream,
  registry: EventReducerRegistry<State>,
  services: ReplayServices,
): ReplayResult<State> {
  let result: ReplayResult<State> | typeof MISSING_REDUCER;
  try {
    if (!isVerifiedEventStream(stream)) invalidEvent();
    result = replay(stream, registry, services);
  } catch {
    throw new EventIntegrityError("invalid_event");
  }
  if (result === MISSING_REDUCER) {
    throw new EventIntegrityError("unsupported_policy");
  }
  return result;
}
