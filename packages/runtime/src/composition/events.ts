import { types } from "node:util";

import type { EventV1 } from "@mestre-yoda/contracts";

import {
  EventIntegrityError,
  EVENT_STREAM_BYTES,
  replayEventStream,
  sealEvent,
  snapshotEventDraft,
  verifyEventStream,
  type EventDraftV1,
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
const encoder = new TextEncoder();

export interface EventStorePaths {
  readonly events: string;
  readonly snapshot: string;
}

export interface EventAppendServices<State = JsonState> {
  readonly durableFileSystem: DurableFileSystem;
  readonly digests: Digests;
  readonly isProxy?: EventServices["isProxy"];
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
  readonly event: EventV1;
  readonly effects: readonly [PreparedEventWrite, PreparedEventWrite];
  readonly expected: ReadonlyMap<string, PathFingerprint>;
}

export function eventStorePaths(runId: string): EventStorePaths {
  if (!runIdPattern.test(runId)) throw new EventIntegrityError("invalid_event");
  const root = `.brain/runs/${runId}`;
  return { events: `${root}/events.jsonl`, snapshot: `${root}/state.json` };
}

/**
 * Read and verify the current two-file state, then return the only two writes
 * required to append one sealed event. This function deliberately never writes.
 */
export async function prepareEventAppend<State = JsonState>(
  input: { readonly runId: string; readonly event: EventDraftV1 },
  services: EventAppendServices<State>,
): Promise<PreparedEventAppend> {
  let paths: EventStorePaths;
  let draft: EventDraftV1;
  let eventServices: EventServices;
  try {
    const request = snapshotRequest(input, services.isProxy ?? types.isProxy);
    paths = eventStorePaths(request.runId);
    draft = request.event;
    eventServices = {
      digests: services.digests,
      isProxy: services.isProxy ?? types.isProxy,
      schemaRegistry: services.schemaRegistry,
    };
  } catch (error) {
    throw classifiedFailure(error, eventEvidenceForUnknownPath());
  }

  const evidence = eventEvidence(paths);
  try {
    const eventEntry = await services.durableFileSystem.inspect(paths.events);
    const snapshotEntry = await services.durableFileSystem.inspect(
      paths.snapshot,
    );
    const expectedEvents = fileFingerprint(eventEntry, paths.events, true);
    const expectedSnapshot = fileFingerprint(
      snapshotEntry,
      paths.snapshot,
      false,
    );
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
        draft,
        services,
        eventServices,
      );
    }
    if (
      expectedEvents.kind === "missing" ||
      expectedSnapshot.kind === "missing"
    ) {
      throw stateCorrupt(evidence);
    }
    if (expectedEvents.kind !== "file" || expectedSnapshot.kind !== "file") {
      throw stateCorrupt(evidence);
    }

    const eventsText = await readExact(
      paths.events,
      expectedEvents,
      services.durableFileSystem,
      services.digests,
      true,
    );
    const snapshotText = await readExact(
      paths.snapshot,
      expectedSnapshot,
      services.durableFileSystem,
      services.digests,
      false,
    );
    const verified = verifyEventStream(eventsText, eventServices);
    const replay = replayEventStream(verified, services.reducers, {
      isProxy: eventServices.isProxy,
      schemaRegistry: services.schemaRegistry,
    });
    assertPersistedSnapshot(snapshotText, replay.canonical, services);

    const event = sealEvent(draft, verified.cursor, eventServices);
    const extended = verifyEventStream(
      `${eventsText}${canonicalEventLine(event)}`,
      eventServices,
    );
    const nextReplay = replayEventStream(extended, services.reducers, {
      isProxy: eventServices.isProxy,
      schemaRegistry: services.schemaRegistry,
    });
    return prepared(paths, event, expected, eventsText, nextReplay.canonical);
  } catch (error) {
    throw classifiedFailure(error, evidence);
  }
}

function snapshotRequest(
  input: unknown,
  isProxy: EventServices["isProxy"],
): { readonly runId: string; readonly event: EventDraftV1 } {
  if (typeof input !== "object" || input === null || isProxy(input)) {
    throw new EventIntegrityError("invalid_event");
  }
  const runId = ownData(input, "runId");
  const event = ownData(input, "event");
  if (typeof runId !== "string") throw new EventIntegrityError("invalid_event");
  return { runId, event: snapshotEventDraft(event, isProxy) };
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new EventIntegrityError("invalid_event");
  }
  return descriptor.value;
}

function prepareFirstAppend<State>(
  paths: EventStorePaths,
  expected: ReadonlyMap<string, PathFingerprint>,
  draft: EventDraftV1,
  services: EventAppendServices<State>,
  eventServices: EventServices,
): PreparedEventAppend {
  const event = sealEvent(draft, { revision: 0, hash: null }, eventServices);
  const extended = verifyEventStream(canonicalEventLine(event), eventServices);
  const replay = replayEventStream(extended, services.reducers, {
    isProxy: eventServices.isProxy,
    schemaRegistry: services.schemaRegistry,
  });
  return prepared(paths, event, expected, "", replay.canonical);
}

function prepared(
  paths: EventStorePaths,
  event: EventV1,
  expected: ReadonlyMap<string, PathFingerprint>,
  priorEvents: string,
  snapshotCanonical: string,
): PreparedEventAppend {
  const events = `${priorEvents}${canonicalEventLine(event)}`;
  const snapshot = `${snapshotCanonical}\n`;
  const effects: readonly [PreparedEventWrite, PreparedEventWrite] = [
    { kind: "write_file", path: paths.events, content: events },
    { kind: "write_file", path: paths.snapshot, content: snapshot },
  ];
  return { paths, event, effects, expected: new Map(expected) };
}

function canonicalEventLine(event: EventV1): string {
  return `${canonicalizeJson(event)}\n`;
}

function fileFingerprint(
  entry: DurableEntry,
  path: string,
  stream: boolean,
): PathFingerprint {
  if (entry.kind === "missing") return { kind: "missing" };
  if (entry.kind !== "file") throw stateCorrupt(eventEvidenceFor(path));
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    typeof entry.sha256 !== "string"
  ) {
    throw stateCorrupt(eventEvidenceFor(path));
  }
  if (stream && entry.size > EVENT_STREAM_BYTES) {
    throw stateCorrupt(eventEvidenceFor(path));
  }
  return { kind: "file", size: entry.size, sha256: entry.sha256 };
}

async function readExact(
  path: string,
  expected: Extract<PathFingerprint, { readonly kind: "file" }>,
  durableFileSystem: DurableFileSystem,
  digests: Digests,
  stream: boolean,
): Promise<string> {
  const text = await durableFileSystem.readText(path);
  const size = encoder.encode(text).byteLength;
  if (stream && size > EVENT_STREAM_BYTES)
    throw stateCorrupt(eventEvidenceFor(path));
  if (size !== expected.size || digests.sha256(text) !== expected.sha256) {
    throw new TransactionFailure(
      "runtime.revision_conflict",
      eventEvidenceFor(path),
    );
  }
  return text;
}

function assertPersistedSnapshot<State>(
  text: string,
  replayCanonical: string,
  services: EventAppendServices<State>,
): void {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new EventIntegrityError("invalid_event");
  }
  const contract = prepareContract(services.schemaRegistry, {
    id: "state.snapshot",
    version: stateContractVersion(value),
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
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
    throw new EventIntegrityError("invalid_event", reasonCode ?? null);
  }
  if (
    text !== `${replayCanonical}\n` ||
    contract.canonical !== replayCanonical
  ) {
    throw new EventIntegrityError("invalid_event");
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
): TransactionFailure {
  return new TransactionFailure("runtime.state_corrupt", evidence);
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
  if (error instanceof TransactionFailure) return error;
  if (error instanceof EventIntegrityError) {
    return new TransactionFailure(
      error.reasonCode ?? "runtime.state_corrupt",
      evidence,
    );
  }
  return new TransactionFailure("runtime.internal_failure", []);
}
