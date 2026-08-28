import { types } from "node:util";

import type { EventV1_1 } from "@kratos/contracts";

import {
  EventIntegrityError,
  EVENT_STREAM_BYTES,
  replayEventStream,
  sealEvent,
  snapshotEventDraft,
  snapshotEventReducerRegistry,
  verifyEventStream,
  type CurrentEventDraft,
  type EventReducerRegistry,
  type EventServices,
  type JsonState,
} from "../domain/events/index.js";
import {
  canonicalizeJson,
  prepareContract,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { PathFingerprint } from "../domain/transactions/index.js";
import type {
  Digests,
  DurableEntry,
  DurableFileSystem,
} from "../ports/index.js";

import { TransactionFailure } from "./transactions.js";

const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
// The same grammar `state.feature` declares, so a location the event store
// accepts is one the feature contract could have produced.
const featurePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const encoder = new TextEncoder();

/** Private boundary sentinels prevent injected errors from gaining authority. */
class DependencyFailure extends Error {}
class IntegrityFailure extends Error {
  public constructor(
    public readonly reasonCode:
      | "contract.state_version_invalid"
      | "contract.state_version_unsupported"
      | null = null,
  ) {
    super();
  }
}
class RevisionConflict extends Error {
  public constructor(
    public readonly evidence: readonly {
      readonly kind: "event" | "artifact";
      readonly ref: string;
    }[],
  ) {
    super();
  }
}

class DependencyTracker {
  private failed = false;

  public constructor(
    private readonly isPromise: (value: object) => boolean = types.isPromise,
  ) {}

  public call<Value>(operation: () => Value): Value {
    try {
      const value = operation();
      if (
        typeof value === "object" &&
        value !== null &&
        this.isPromise(value)
      ) {
        void Promise.prototype.then.call(value, undefined, () => undefined);
        this.failed = true;
        throw new DependencyFailure();
      }
      return value;
    } catch {
      this.failed = true;
      throw new DependencyFailure();
    }
  }

  public assert(): void {
    if (this.failed) throw new DependencyFailure();
  }
}

export interface EventStorePaths {
  readonly events: string;
  readonly snapshot: string;
}

export interface EventAppendServices<State = JsonState> {
  readonly durableFileSystem: DurableFileSystem;
  readonly digests: Digests;
  readonly isProxy?: EventServices["isProxy"];
  readonly isPromise?: EventServices["isPromise"];
  readonly reducers: EventReducerRegistry<State>;
  readonly schemaRegistry: SchemaRegistry;
}

export interface PreparedEventWrite {
  readonly kind: "write_file";
  readonly path: string;
  readonly content: string;
}

export interface PreparedEventAppend {
  readonly paths: EventStorePaths;
  readonly event: EventV1_1;
  readonly effects: readonly [PreparedEventWrite, PreparedEventWrite];
  readonly expected: ReadonlyMap<string, PathFingerprint>;
}

/**
 * Which run a stream belongs to.
 *
 * A run belongs to the feature that opened it, and the frozen layout says so:
 * every run artifact lives under its feature. Naming both here is what keeps
 * the store from inventing a second place for a run to live.
 */
export interface RunLocation {
  readonly feature: string;
  readonly runId: string;
}

export function eventStorePaths(location: RunLocation): EventStorePaths {
  if (
    !featurePattern.test(location.feature) ||
    !runIdPattern.test(location.runId)
  ) {
    throw new EventIntegrityError("invalid_event");
  }
  const root = `.brain/02-features/${location.feature}/runs/${location.runId}`;
  return { events: `${root}/events.jsonl`, snapshot: `${root}/state.json` };
}

/**
 * Read and verify the current two-file state, then return the only two writes
 * required to append one sealed event. This function deliberately never writes.
 */
export async function prepareEventAppend<State = JsonState>(
  input: {
    readonly feature: string;
    readonly runId: string;
    readonly event: CurrentEventDraft;
  },
  services: EventAppendServices<State>,
): Promise<PreparedEventAppend> {
  let paths: EventStorePaths;
  let runId: string;
  let draft: CurrentEventDraft;
  let eventServices: EventServices;
  let reducers: EventReducerRegistry<State>;
  let tracker: DependencyTracker;
  let durableFileSystem: DurableFileSystem;
  try {
    tracker = new DependencyTracker();
    const trusted = trustedServices(services, tracker);
    const request = snapshotRequest(input, trusted.events.isProxy, tracker);
    paths = derivePaths(request);
    runId = request.runId;
    draft = request.event;
    eventServices = trusted.events;
    reducers = eventDomain(tracker, () =>
      snapshotEventReducerRegistry(
        tracker.call(() => services.reducers),
        {
          isProxy: eventServices.isProxy,
          isPromise: eventServices.isPromise,
          schemaRegistry: eventServices.schemaRegistry,
        },
      ),
    );
    durableFileSystem = trusted.durableFileSystem;
  } catch (error) {
    throw classifiedFailure(error, eventEvidenceForUnknownPath());
  }

  const evidence = eventEvidence(paths);
  try {
    const eventEntry = await storageCall(() =>
      durableFileSystem.inspect(paths.events),
    );
    const snapshotEntry = await storageCall(() =>
      durableFileSystem.inspect(paths.snapshot),
    );
    const expectedEvents = fileFingerprint(eventEntry, true);
    const expectedSnapshot = fileFingerprint(snapshotEntry, false);
    const expected = new Map<string, PathFingerprint>([
      [paths.events, expectedEvents],
      [paths.snapshot, expectedSnapshot],
    ]);

    if (
      expectedEvents.kind === "missing" &&
      expectedSnapshot.kind === "missing"
    ) {
      return prepareFirstAppend(
        paths,
        expected,
        runId,
        draft,
        reducers,
        eventServices,
        tracker,
      );
    }
    if (
      expectedEvents.kind === "missing" ||
      expectedSnapshot.kind === "missing"
    ) {
      throw stateCorrupt(evidence);
    }
    const eventsText = await readExact(
      paths.events,
      expectedEvents,
      durableFileSystem,
      eventServices.digests,
    );
    const snapshotText = await readExact(
      paths.snapshot,
      expectedSnapshot,
      durableFileSystem,
      eventServices.digests,
    );
    const verified = eventDomain(tracker, () =>
      verifyEventStream(eventsText, eventServices),
    );
    const replay = eventDomain(tracker, () =>
      replayEventStream(verified, reducers, {
        isProxy: eventServices.isProxy,
        isPromise: eventServices.isPromise,
        schemaRegistry: eventServices.schemaRegistry,
      }),
    );
    assertReplayRunId(replay.snapshot, runId);
    assertPersistedSnapshot(
      snapshotText,
      replay.canonical,
      eventServices.schemaRegistry,
      tracker,
    );

    const event = eventDomain(tracker, () =>
      sealEvent(draft, verified.cursor, eventServices),
    );
    const extended = eventDomain(tracker, () =>
      verifyEventStream(
        `${eventsText}${canonicalEventLine(event)}`,
        eventServices,
      ),
    );
    const nextReplay = eventDomain(tracker, () =>
      replayEventStream(extended, reducers, {
        isProxy: eventServices.isProxy,
        isPromise: eventServices.isPromise,
        schemaRegistry: eventServices.schemaRegistry,
      }),
    );
    assertReplayRunId(nextReplay.snapshot, runId);
    return prepared(paths, event, expected, eventsText, nextReplay.canonical);
  } catch (error) {
    throw classifiedFailure(error, evidence);
  }
}

function snapshotRequest(
  input: unknown,
  isProxy: EventServices["isProxy"],
  tracker: DependencyTracker,
): {
  readonly feature: string;
  readonly runId: string;
  readonly event: CurrentEventDraft;
} {
  if (typeof input !== "object" || input === null || isProxy(input)) {
    throw new IntegrityFailure();
  }
  const feature = ownData(input, "feature");
  const runId = ownData(input, "runId");
  const event = ownData(input, "event");
  if (typeof feature !== "string" || typeof runId !== "string") {
    throw new IntegrityFailure();
  }
  return {
    feature,
    runId,
    event: eventDomain(tracker, () => snapshotEventDraft(event, isProxy)),
  };
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new IntegrityFailure();
  }
  return descriptor.value;
}

function prepareFirstAppend<State>(
  paths: EventStorePaths,
  expected: ReadonlyMap<string, PathFingerprint>,
  runId: string,
  draft: CurrentEventDraft,
  reducers: EventReducerRegistry<State>,
  eventServices: EventServices,
  tracker: DependencyTracker,
): PreparedEventAppend {
  const event = eventDomain(tracker, () =>
    sealEvent(draft, { revision: 0, hash: null }, eventServices),
  );
  const extended = eventDomain(tracker, () =>
    verifyEventStream(canonicalEventLine(event), eventServices),
  );
  const replay = eventDomain(tracker, () =>
    replayEventStream(extended, reducers, {
      isProxy: eventServices.isProxy,
      isPromise: eventServices.isPromise,
      schemaRegistry: eventServices.schemaRegistry,
    }),
  );
  assertReplayRunId(replay.snapshot, runId);
  return prepared(paths, event, expected, "", replay.canonical);
}

function assertReplayRunId(
  snapshot: { readonly runId: string },
  runId: string,
): void {
  if (snapshot.runId !== runId) throw new IntegrityFailure();
}

function derivePaths(location: RunLocation): EventStorePaths {
  if (
    !featurePattern.test(location.feature) ||
    !runIdPattern.test(location.runId)
  ) {
    throw new IntegrityFailure();
  }
  const root = `.brain/02-features/${location.feature}/runs/${location.runId}`;
  return { events: `${root}/events.jsonl`, snapshot: `${root}/state.json` };
}

function eventDomain<Value>(
  tracker: DependencyTracker,
  operation: () => Value,
): Value {
  try {
    const value = operation();
    tracker.assert();
    return value;
  } catch (error) {
    if (error instanceof DependencyFailure) throw error;
    try {
      tracker.assert();
    } catch {
      throw new DependencyFailure();
    }
    if (error instanceof EventIntegrityError) {
      throw new IntegrityFailure(error.reasonCode);
    }
    throw error;
  }
}

async function storageCall<Value>(
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch {
    throw new DependencyFailure();
  }
}

function trustedServices<State>(
  services: EventAppendServices<State>,
  tracker: DependencyTracker,
): {
  readonly durableFileSystem: DurableFileSystem;
  readonly events: EventServices;
} {
  const isProxy = tracker.call(() => services.isProxy ?? types.isProxy);
  const isPromise = tracker.call(() => services.isPromise ?? types.isPromise);
  const rawDigests = tracker.call(() => services.digests);
  const rawSchemaRegistry = tracker.call(() => services.schemaRegistry);
  return {
    durableFileSystem: tracker.call(() => services.durableFileSystem),
    events: {
      digests: {
        sha256: (text) => tracker.call(() => rawDigests.sha256(text)),
      },
      isProxy: (value) => tracker.call(() => isProxy(value)),
      isPromise: (value) => tracker.call(() => isPromise(value)),
      schemaRegistry: {
        validate: (request) =>
          tracker.call(() => rawSchemaRegistry.validate(request)),
      },
    },
  };
}

function prepared(
  paths: EventStorePaths,
  event: EventV1_1,
  expected: ReadonlyMap<string, PathFingerprint>,
  priorEvents: string,
  snapshotCanonical: string,
): PreparedEventAppend {
  const events = `${priorEvents}${canonicalEventLine(event)}`;
  const snapshot = `${snapshotCanonical}\n`;
  const effects: readonly [PreparedEventWrite, PreparedEventWrite] = [
    Object.freeze({ kind: "write_file", path: paths.events, content: events }),
    Object.freeze({
      kind: "write_file",
      path: paths.snapshot,
      content: snapshot,
    }),
  ];
  return Object.freeze({
    paths: Object.freeze({ ...paths }),
    event: freezeEvent(event),
    effects: Object.freeze(effects),
    expected: readonlyMap(expected),
  });
}

function freezeEvent(event: EventV1_1): EventV1_1 {
  return Object.freeze({
    ...event,
    artifactRefs: Object.freeze([...event.artifactRefs]),
    evidenceRefs: Object.freeze([...event.evidenceRefs]),
    observedIdentity: Object.freeze({ ...event.observedIdentity }),
    ...(event.resolvedAssignment === undefined
      ? {}
      : {
          resolvedAssignment: Object.freeze({ ...event.resolvedAssignment }),
        }),
  }) as EventV1_1;
}

function readonlyMap(
  input: ReadonlyMap<string, PathFingerprint>,
): ReadonlyMap<string, PathFingerprint> {
  const values = new Map(
    [...input].map(([key, value]) => [key, Object.freeze({ ...value })]),
  );
  const readonly: ReadonlyMap<string, PathFingerprint> = {
    get size() {
      return values.size;
    },
    get: (key: string) => values.get(key),
    has: (key: string) => values.has(key),
    entries: () => values.entries(),
    keys: () => values.keys(),
    values: () => values.values(),
    forEach: (
      callback: (
        value: PathFingerprint,
        key: string,
        map: ReadonlyMap<string, PathFingerprint>,
      ) => void,
    ) => {
      values.forEach((value, key) => {
        callback(value, key, readonly);
      });
    },
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
  return Object.freeze(readonly);
}

function canonicalEventLine(event: EventV1_1): string {
  return `${canonicalizeJson(event)}\n`;
}

function fileFingerprint(
  entry: DurableEntry,
  stream: boolean,
): Exclude<PathFingerprint, { readonly kind: "directory" }> {
  if (entry.kind === "missing") return { kind: "missing" };
  if (entry.kind !== "file") throw new IntegrityFailure();
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    typeof entry.sha256 !== "string"
  ) {
    throw new IntegrityFailure();
  }
  if (stream && entry.size > EVENT_STREAM_BYTES) {
    throw new IntegrityFailure();
  }
  return { kind: "file", size: entry.size, sha256: entry.sha256 };
}

async function readExact(
  path: string,
  expected: Extract<PathFingerprint, { readonly kind: "file" }>,
  durableFileSystem: DurableFileSystem,
  digests: Pick<Digests, "sha256">,
): Promise<string> {
  const text = await storageCall(() => durableFileSystem.readText(path));
  const size = encoder.encode(text).byteLength;
  if (size !== expected.size || digests.sha256(text) !== expected.sha256) {
    throw new RevisionConflict(eventEvidenceFor(path));
  }
  return text;
}

function assertPersistedSnapshot(
  text: string,
  replayCanonical: string,
  schemaRegistry: SchemaRegistry,
  tracker: DependencyTracker,
): void {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new IntegrityFailure();
  }
  const contract = eventDomain(tracker, () =>
    prepareContract(schemaRegistry, {
      id: "state.snapshot",
      version: stateContractVersion(value),
      value,
      structuralReasonCode: "runtime.state_corrupt",
    }),
  );
  if (contract.kind === "invalid") {
    const reasonCode = contract.diagnostics
      .map(({ reasonCode }) => reasonCode)
      .find(
        (
          reason,
        ): reason is
          | "contract.state_version_invalid"
          | "contract.state_version_unsupported" =>
          reason === "contract.state_version_invalid" ||
          reason === "contract.state_version_unsupported",
      );
    throw new IntegrityFailure(reasonCode ?? null);
  }
  if (
    text !== `${replayCanonical}\n` ||
    contract.canonical !== replayCanonical
  ) {
    throw new IntegrityFailure();
  }
}

function stateContractVersion(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, "stateContract")?.value;
}

function stateCorrupt(
  evidence: readonly {
    readonly kind: "event" | "artifact";
    readonly ref: string;
  }[],
): IntegrityFailure {
  void evidence;
  return new IntegrityFailure();
}

function eventEvidence(
  paths: EventStorePaths,
): readonly [
  { readonly kind: "event"; readonly ref: string },
  { readonly kind: "artifact"; readonly ref: string },
] {
  return [
    { kind: "event", ref: paths.events },
    { kind: "artifact", ref: paths.snapshot },
  ];
}

function eventEvidenceFor(
  path: string,
): readonly [{ readonly kind: "event" | "artifact"; readonly ref: string }] {
  return [
    { kind: path.endsWith("events.jsonl") ? "event" : "artifact", ref: path },
  ];
}

function eventEvidenceForUnknownPath(): readonly [] {
  return [];
}

function classifiedFailure(
  error: unknown,
  evidence: readonly {
    readonly kind: "event" | "artifact";
    readonly ref: string;
  }[],
): TransactionFailure {
  if (error instanceof RevisionConflict) {
    return new TransactionFailure("runtime.revision_conflict", error.evidence);
  }
  if (error instanceof IntegrityFailure) {
    return new TransactionFailure(
      error.reasonCode ?? "runtime.state_corrupt",
      error.reasonCode === null ? evidence : [],
    );
  }
  return new TransactionFailure("runtime.internal_failure", []);
}
