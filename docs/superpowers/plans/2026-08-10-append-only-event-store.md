# Append-Only Event Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issue #21 as a run-scoped, canonical, hash-linked event store whose verified stream and derived snapshot commit through one recoverable transaction.

**Architecture:** Pure event modules snapshot and seal closed `EventV1` drafts, parse canonical JSON Lines, verify revision/hash continuity, and replay through a closed `policyVersion` reducer registry. Composition derives `.brain/runs/<run-id>/events.jsonl` and `state.json`, validates persisted state, prepares an exact-prefix append plus derived `SnapshotV1`, and delegates both writes to the existing `RUN-05` transaction manager.

**Tech Stack:** TypeScript 6.0.2, Node.js `>=24.18.0 <25`, npm 11.16.0, Vitest 4.1.10, existing Ajv-backed schema registry, existing canonical JSON and SHA-256 ports.

## Global Constraints

- Preserve `stateContract: 1.0.0`; published schemas, fixtures, generated declarations, canonicalization, and compatibility windows are immutable.
- Add no runtime or development dependency.
- Keep domain code free of Node builtins, Ajv, schema files, composition, filesystem, clock, environment, Git, host, and network access.
- Persist only the closed metadata-only `EventV1`; never add a raw payload, prompt, source-content, exception, environment, or credential field.
- Derive paths only as `.brain/runs/<run-id>/events.jsonl` and `.brain/runs/<run-id>/state.json`; callers never supply event-store destinations.
- Hash canonical unsigned event bytes containing every `EventV1` field except `eventHash`, including `previousHash`.
- Store one canonical JSON object per line, terminated by exactly one LF byte; reject CRLF, blank records, non-canonical bytes, and an unterminated final record.
- Limit a record to 64 KiB, a stream to 64 MiB, and a stream to 100,000 events before replay.
- Keep all source, tests, fixtures, documentation, errors, comments, commit messages, and PR text in English.
- Follow strict RED → verify failure → GREEN → verify pass → REFACTOR for every behavior.

---

### Task 1: Seal a validated event with a golden canonical hash

**Files:**

- Create: `packages/runtime/src/domain/events/model.ts`
- Create: `packages/runtime/src/domain/events/redaction.ts`
- Create: `packages/runtime/src/domain/events/seal.ts`
- Create: `packages/runtime/src/domain/events/index.ts`
- Create: `tests/fixtures/events/golden-event-v1.json`
- Create: `tests/event-sealing.test.ts`
- Modify: `packages/runtime/package.json`

**Interfaces:**

- Consumes: `EventV1`, `SchemaRegistry`, `Digests`, and `canonicalizeJson`.
- Produces: `EventDraftV1`, `EventChainCursor`, `EventIntegrityError`, `snapshotEventDraft()`, `unsignedEvent()`, and `sealEvent()` for every later task.

- [ ] **Step 1: Add the golden fixture and failing public API test**

Create `tests/fixtures/events/golden-event-v1.json` with the exact content:

```json
{
  "draft": {
    "contractVersion": "1.0.0",
    "stateContract": "1.0.0",
    "eventId": "event-01",
    "eventType": "transition",
    "occurredAt": "2026-08-10T00:01:00Z",
    "operation": "sdd.continue",
    "policyVersion": "policy-01",
    "priorRevision": 0,
    "resultingRevision": 1,
    "reasonCode": "ok",
    "effect": "state",
    "artifactRefs": [".brain/features/feature-01/00-prd.md"],
    "evidenceRefs": [".brain/evidence/event-01.json"],
    "observedIdentity": { "host": "codex", "model": "gpt-5" }
  },
  "unsignedCanonical": "{\"artifactRefs\":[\".brain/features/feature-01/00-prd.md\"],\"contractVersion\":\"1.0.0\",\"effect\":\"state\",\"eventId\":\"event-01\",\"eventType\":\"transition\",\"evidenceRefs\":[\".brain/evidence/event-01.json\"],\"observedIdentity\":{\"host\":\"codex\",\"model\":\"gpt-5\"},\"occurredAt\":\"2026-08-10T00:01:00Z\",\"operation\":\"sdd.continue\",\"policyVersion\":\"policy-01\",\"previousHash\":null,\"priorRevision\":0,\"reasonCode\":\"ok\",\"resultingRevision\":1,\"stateContract\":\"1.0.0\"}",
  "eventHash": "c6f58e1d3427cfee3331856b509b0bbbc67b5d4d8cc3549ed026029fb47826b1"
}
```

Create `tests/event-sealing.test.ts`:

```ts
import golden from "./fixtures/events/golden-event-v1.json" with { type: "json" };
import {
  sealEvent,
  unsignedEvent,
  type EventDraftV1,
} from "@mestre-yoda/runtime/domain/events";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

describe("event sealing", () => {
  it("matches the committed first-event golden vector", () => {
    const event = sealEvent(golden.draft as EventDraftV1, { revision: 0, hash: null }, {
      digests: sha256Digests(),
      schemaRegistry: createSchemaRegistry(),
    });

    expect(canonicalizeJson(unsignedEvent(event))).toBe(golden.unsignedCanonical);
    expect(event.eventHash).toBe(golden.eventHash);
    expect(event.previousHash).toBeNull();
  });
});
```

Add `"./domain/events": "./src/domain/events/index.ts"` to the runtime package exports.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/event-sealing.test.ts
```

Expected: FAIL because `@mestre-yoda/runtime/domain/events` is not exported.

- [ ] **Step 3: Implement the closed model, inert draft snapshot, and sealing rule**

Create `model.ts` with these exact public types:

```ts
import type { EventV1 } from "@mestre-yoda/contracts";
import type { SchemaRegistry } from "../schema/index.js";
import type { Digests } from "../../ports/index.js";

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
  | "contract.state_version_invalid"
  | "contract.state_version_unsupported";

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
```

Implement `snapshotEventDraft(value: unknown): EventDraftV1` in `redaction.ts` by checking an exact key list, copying every scalar, copying both reference arrays, and copying `observedIdentity` without spreading or reading an accessor. On any invalid descriptor, extra key, wrong primitive, array hole, or mutable nested shape, throw `new EventIntegrityError("invalid_event")`. Use `Object.getOwnPropertyDescriptor()` for each value and never include rejected content in the error.

Implement `seal.ts`:

```ts
import { CONTRACT_IDENTITIES, type EventV1 } from "@mestre-yoda/contracts";
import { canonicalizeJson } from "../schema/index.js";
import {
  EventIntegrityError,
  type EventChainCursor,
  type EventDraftV1,
  type EventServices,
} from "./model.js";
import { snapshotEventDraft } from "./redaction.js";

export function unsignedEvent(event: EventV1): Omit<EventV1, "eventHash"> {
  const { eventHash: _eventHash, ...unsigned } = event;
  return unsigned;
}

export function sealEvent(
  input: unknown,
  cursor: EventChainCursor,
  services: EventServices,
): EventV1 {
  const draft = snapshotEventDraft(input);
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
```

Export the model, redaction, and seal APIs from `index.ts`.

- [ ] **Step 4: Expand the tests for mutation safety and validation**

Add focused cases that:

- reverse object insertion order and retain the same hash;
- mutate each copied reference array after `sealEvent()` and prove the result is unchanged;
- reject revision gaps, a non-null first predecessor, extra keys, accessors, proxies, unsafe references, and `artifactRefs` or `evidenceRefs` longer than 256 entries;
- change each protected golden field and require a different hash.

Use `it.each()` with concrete field replacements and require only the sanitized `EventIntegrityError.kind`, never attacker text.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/event-sealing.test.ts tests/architecture.test.ts
```

Expected: both files PASS; architecture still reports no forbidden domain import.

- [ ] **Step 6: Commit the sealing boundary**

```bash
git add packages/runtime/package.json packages/runtime/src/domain/events tests/event-sealing.test.ts tests/fixtures/events/golden-event-v1.json
git commit -m "feat: seal canonical hash-linked events"
```

---

### Task 2: Parse canonical JSON Lines and verify the complete chain

**Files:**

- Create: `packages/runtime/src/domain/events/parse.ts`
- Create: `packages/runtime/src/domain/events/verify.ts`
- Modify: `packages/runtime/src/domain/events/index.ts`
- Create: `tests/event-chain.test.ts`
- Create: `tests/event-chain-properties.test.ts`

**Interfaces:**

- Consumes: Task 1 `EventServices`, `EventIntegrityError`, `unsignedEvent()`, and `sealEvent()`.
- Produces: `EVENT_RECORD_BYTES`, `EVENT_STREAM_BYTES`, `EVENT_STREAM_COUNT`, `parseEventLines()`, `verifyEventStream()`, and `VerifiedEventStream`.

- [ ] **Step 1: Write failing chain-verification tests**

Create `tests/event-chain.test.ts` with a local `draft(index)` builder and this core behavior:

```ts
const services = {
  digests: sha256Digests(),
  schemaRegistry: createSchemaRegistry(),
};
const first = sealEvent(draft(1), { revision: 0, hash: null }, services);
const second = sealEvent(draft(2), { revision: 1, hash: first.eventHash }, services);
const text = `${canonicalizeJson(first)}\n${canonicalizeJson(second)}\n`;

expect(verifyEventStream(text, services)).toEqual({
  events: [first, second],
  cursor: { revision: 2, hash: second.eventHash },
  canonical: text,
});
```

Add table cases for CRLF, missing final LF, a blank line, pretty JSON, a bad hash, bad predecessor, duplicate revision, gap, swapped records, malformed JSON, and an unsupported contract version. Each must throw the expected `EventIntegrityError.kind`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/event-chain.test.ts
```

Expected: FAIL because `verifyEventStream()` does not exist.

- [ ] **Step 3: Implement bounded parsing and ordered verification**

In `parse.ts`, export:

```ts
export const EVENT_RECORD_BYTES = 64 * 1024;
export const EVENT_STREAM_BYTES = 64 * 1024 * 1024;
export const EVENT_STREAM_COUNT = 100_000;
```

Implement `parseEventLines(text, schemaRegistry)` so it:

1. checks `TextEncoder().encode(text).byteLength <= EVENT_STREAM_BYTES`;
2. returns `[]` for `""`;
3. requires a final `\n` and rejects every `\r`;
4. removes exactly the final empty split element and rejects any other blank record;
5. checks the count and each line's UTF-8 byte length before `JSON.parse()`;
6. validates every parsed value as `state.event@1.0.0`; and
7. requires `canonicalizeJson(validated.value) === line`.

Map malformed JSON or structural schema failure to `invalid_event`, byte
spelling drift to `non_canonical`, and any limit to `resource_limit`. When the
schema registry returns a `version` diagnostic with
`contract.state_version_invalid` or `contract.state_version_unsupported`, copy
that exact value into `EventIntegrityError.reasonCode`; never copy diagnostic
wording or the rejected version.

In `verify.ts`, implement:

```ts
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
```

- [ ] **Step 4: Add the deterministic corruption property campaign**

Create `tests/event-chain-properties.test.ts` with the repository's seeded LCG pattern. Generate 200 streams of 1–32 events, seal each event against the prior cursor, and assert repeated verification returns identical canonical output and cursor. For each generated stream, mutate one byte inside each protected scalar in turn, delete every record position, duplicate one record, and swap every adjacent pair; require rejection and include `seed`, case, and record index in the assertion message.

- [ ] **Step 5: Run the event domain suite and verify GREEN**

```bash
npx vitest run tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-chain-properties.test.ts
```

Expected: 3 files PASS with all generated cases completing inside the default Vitest timeout.

- [ ] **Step 6: Commit parsing and verification**

```bash
git add packages/runtime/src/domain/events tests/event-chain.test.ts tests/event-chain-properties.test.ts
git commit -m "feat: verify canonical event hash chains"
```

---

### Task 3: Replay pure reducers and bind a validated snapshot

**Files:**

- Create: `packages/runtime/src/domain/events/reduce.ts`
- Modify: `packages/runtime/src/domain/events/index.ts`
- Create: `tests/event-reducer.test.ts`
- Create: `tests/event-reducer-properties.test.ts`

**Interfaces:**

- Consumes: Task 2 `VerifiedEventStream`, existing `prepareContract()`, and `SnapshotV1`.
- Produces: `JsonState`, `EventReducerRegistry`, `ReplayResult`, and `replayEventStream()`.

- [ ] **Step 1: Write the failing reducer and snapshot-binding test**

Use a concrete JSON state:

```ts
interface TestState {
  readonly projectId: string;
  readonly runId: string;
  readonly status: "idle" | "active";
  readonly currentStep: string | null;
  readonly lineage: { readonly prdDigest: string; readonly specDigest: string };
  readonly createdAt: string;
}
```

Define a registry whose `policy-01` reducer sets `status: "active"` and
`currentStep: event.operation`, then materializes all `SnapshotV1` fields. Verify:

```ts
const replay = replayEventStream(stream, registry, createSchemaRegistry());
expect(replay.snapshot.eventCursor).toBe(stream.cursor.revision);
expect(replay.snapshot.eventHash).toBe(stream.cursor.hash);
expect(replay.snapshot.policyVersion).toBe("policy-01");
expect(replay.snapshot.updatedAt).toBe(stream.events.at(-1)?.occurredAt);
expect(JSON.parse(replay.canonical)).toEqual(replay.snapshot);
```

Also prove a persisted snapshot with one changed field does not equal `replay.canonical` after canonicalization.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/event-reducer.test.ts
```

Expected: FAIL because `replayEventStream()` is not exported.

- [ ] **Step 3: Implement JSON-state cloning, closed reducer selection, and binding checks**

Create `reduce.ts` with these public interfaces:

```ts
export type JsonState = unknown;

export interface EventReducerRegistry<State = JsonState> {
  readonly seed: State;
  readonly reducers: Readonly<Record<string, (state: State, event: EventV1) => State>>;
  materialize(state: State, cursor: EventChainCursor): SnapshotV1;
}

export interface ReplayResult<State = JsonState> {
  readonly state: State;
  readonly snapshot: SnapshotV1;
  readonly canonical: string;
}
```

Implement `cloneJson(value)` as `JSON.parse(canonicalizeJson(value))`. For each
event, invoke the selected reducer twice from independent clones of the same
prior state and event, canonicalize both results, and reject byte differences as
`invalid_event`; advance with a clone of the first result. Reject a missing
reducer with `unsupported_policy`. Require a non-empty verified stream because
`SnapshotV1.eventHash` cannot represent an empty cursor. Materialize twice from
independent clones, require byte-identical results, then require exact bindings
to the final event/cursor before validating through
`prepareContract({ id: "state.snapshot", version: "1.0.0" })`. Any binding,
determinism, or schema failure is `invalid_event`.

- [ ] **Step 4: Add reducer determinism and mutation property tests**

Generate 200 bounded streams and replay each one three times with separately cloned seeds. Require byte-identical `canonical` values. Add hostile reducers that mutate their input, return an accessor, close over a changing counter, return `NaN`, or omit a snapshot binding; require deterministic sanitized refusal. Confirm the original registry seed and verified event objects remain unchanged.

- [ ] **Step 5: Run the reducer suite and verify GREEN**

```bash
npx vitest run tests/event-reducer.test.ts tests/event-reducer-properties.test.ts tests/event-chain.test.ts
```

Expected: 3 files PASS.

- [ ] **Step 6: Commit pure replay**

```bash
git add packages/runtime/src/domain/events tests/event-reducer.test.ts tests/event-reducer-properties.test.ts
git commit -m "feat: replay events into bound snapshots"
```

---

### Task 4: Prepare a run-scoped exact-prefix append from persisted state

**Files:**

- Create: `packages/runtime/src/composition/events.ts`
- Create: `tests/event-store-preparation.test.ts`
- Modify: `packages/runtime/package.json`
- Modify: `packages/runtime/src/composition/transactions.ts`
- Modify: `packages/runtime/src/domain/result/result.ts`

**Interfaces:**

- Consumes: Tasks 1–3 event APIs, `DurableFileSystem`, `prepareContract()`, and `PathFingerprint`.
- Produces: `eventStorePaths()`, `EventAppendServices`, `PreparedEventAppend`, and `prepareEventAppend()`.

- [ ] **Step 1: Write failing first-append and successor-preparation tests**

Create a fake store with `.brain`, `.brain/transactions`, `.brain/runs`, and `.brain/runs/run-01`. For the first append, require:

```ts
const prepared = await prepareEventAppend(
  { runId: "run-01", event: draft(1) },
  { durableFileSystem: storage.durableFileSystem, digests: storage.digests,
    schemaRegistry: createSchemaRegistry(), reducers },
);

expect(prepared.paths).toEqual({
  events: ".brain/runs/run-01/events.jsonl",
  snapshot: ".brain/runs/run-01/state.json",
});
expect(prepared.effects.map(({ path }) => path)).toEqual([
  prepared.paths.events,
  prepared.paths.snapshot,
]);
expect(prepared.expected.get(prepared.paths.events)).toEqual({ kind: "missing" });
```

Seed the resulting files into a second store, prepare event 2, and assert the new event text starts with the exact first text and contains exactly one additional LF-terminated line.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/event-store-preparation.test.ts
```

Expected: FAIL because the composition module does not exist.

- [ ] **Step 3: Implement path derivation and persisted-state inspection**

Export `"./composition/events": "./src/composition/events.ts"` and implement:

```ts
const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export function eventStorePaths(runId: string) {
  if (!runIdPattern.test(runId)) throw new EventIntegrityError("invalid_event");
  const root = `.brain/runs/${runId}`;
  return { events: `${root}/events.jsonl`, snapshot: `${root}/state.json` } as const;
}
```

Define `PreparedEventAppend` with `paths`, sealed `event`, `effects` containing exactly two `write_file` effects, and an `expected` map of both pre-read fingerprints. `prepareEventAppend()` must:

- inspect both paths before reading;
- reject directory, symlink, or special entries;
- use `DurableEntry.size` to reject an oversized stream before `readText()`;
- hash and measure each value returned by `readText()` and require it to match
  the fingerprint observed before the read;
- accept both files missing only for a first append;
- reject exactly one missing file;
- verify the existing stream, replay it, validate and canonicalize the persisted snapshot, and compare its bytes to replay;
- seal the draft against the verified cursor;
- replay the extended stream; and
- return old bytes plus one canonical sealed line and `${nextReplay.canonical}\n` for the snapshot file.

Compare persisted snapshot bytes to `${replay.canonical}\n`, preserving the
repository's one-final-LF file convention. Map structural event/schema/replay
integrity failures to
`TransactionFailure("runtime.state_corrupt", [{ kind: "event", ref: eventsPath }, { kind: "artifact", ref: snapshotPath }])`.
When schema validation returns `contract.state_version_invalid` or
`contract.state_version_unsupported`, preserve that catalog reason by extending
`TransactionFailure.reasonCode` and `TransactionFailureDetail.reasonCode` with
those exact two values. Map unexpected storage errors to
`runtime.internal_failure` without private text.

- [ ] **Step 4: Expand preparation security and drift tests**

Add cases for unsafe run IDs, missing pairs, non-file entries, oversized
`DurableEntry.size`, malformed chain, invalid and unsupported state versions,
snapshot cursor/hash/content drift, mutated inputs after call, throwing
accessors, and a persisted file changing between `inspect()` and `readText()`.
Require no write, directory creation, transaction marker, or output call.

- [ ] **Step 5: Run preparation and architecture tests**

```bash
npx vitest run tests/event-store-preparation.test.ts tests/architecture.test.ts tests/package-boundaries.test.ts
```

Expected: 3 files PASS and no composition import leaks into domain.

- [ ] **Step 6: Commit event-store preparation**

```bash
git add packages/runtime/package.json packages/runtime/src/composition/events.ts packages/runtime/src/composition/transactions.ts packages/runtime/src/domain/result/result.ts tests/event-store-preparation.test.ts
git commit -m "feat: prepare run-scoped event appends"
```

---

### Task 5: Commit `append_event` and snapshot in one managed transaction

**Files:**

- Modify: `packages/runtime/src/domain/effects.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/src/composition/events.ts`
- Modify: `tests/runtime-composition.test.ts`
- Create: `tests/event-store-transaction.test.ts`

**Interfaces:**

- Consumes: Task 4 `prepareEventAppend()` and existing `normalizeManagedMutationPlan()` / `executeManagedMutation()`.
- Produces: structured `AppendEventEffect`, `ApplyPlanOptions<State>`, and committed event-store behavior through `applyPlan()`.

- [ ] **Step 1: Replace the old refusal test with a failing atomic commit test**

Change the effect union to the wished-for API in the test:

```ts
planOf({
  kind: "append_event",
  runId: "run-01",
  event: draft(1),
})
```

Call `applyPlan(plan, ports, { rootMode: "existing", eventReducers: reducers })` and assert the committed transaction manifest has exactly these destination paths in order:

```ts
[
  ".brain/runs/run-01/events.jsonl",
  ".brain/runs/run-01/state.json",
]
```

Assert both persisted files validate and the snapshot cursor/hash equal the sealed event.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/runtime-composition.test.ts tests/event-store-transaction.test.ts
```

Expected: FAIL because `append_event.event` still requires a string and `applyPlan()` refuses it.

- [ ] **Step 3: Implement the structured effect and precondition-preserving expansion**

In `effects.ts`, define:

```ts
export interface AppendEventEffect {
  readonly kind: "append_event";
  readonly runId: string;
  readonly event: EventDraftV1;
}
```

Use it in `Effect`. In composition, define:

```ts
export interface ApplyPlanOptions<State = JsonState> {
  readonly rootMode: "existing" | "initialize";
  readonly eventReducers?: EventReducerRegistry<State>;
}
```

Update `snapshotEffect()` to call `snapshotEventDraft()` and copy `runId`. Reject more than one append, an append without `eventReducers`, and a caller write/delete targeting the selected event or snapshot path.

Before managed observation, call `prepareEventAppend()` and replace the append effect with its two write effects at the append's exact plan position. Treat append as managed for transaction preflight. After `observeManagedPaths()`, compare the two fresh fingerprints to `PreparedEventAppend.expected`; any difference is `TransactionFailure("runtime.revision_conflict", evidenceForChangedPaths)`. Only then normalize and execute the one combined managed transaction.

Retain the existing behavior for plans without `append_event`. Retain emit ordering after commit. Remove the provisional root `.brain/events.jsonl` refusal constant.

- [ ] **Step 4: Add exclusivity, stale-plan, no-op, and mixed-effect tests**

Test:

- a first append creates missing `.brain/runs/run-01` parents through explicit normalized directory operations;
- a successor append extends the exact prefix and updates the snapshot;
- two append effects are rejected before I/O;
- direct writes/deletes to the selected stream or snapshot are rejected;
- ordinary managed writes and one append share one manifest and declared order;
- a stale stream or snapshot observation produces `runtime.revision_conflict` before transaction creation;
- emit runs only after the event transaction reaches `committed`; and
- a missing reducer version is unsupported state and writes nothing.

- [ ] **Step 5: Run the integration slice and verify GREEN**

```bash
npx vitest run tests/event-store-transaction.test.ts tests/runtime-composition.test.ts tests/transaction-execution.test.ts tests/transaction-recovery.test.ts
```

Expected: 4 files PASS; all existing transaction behavior remains unchanged.

- [ ] **Step 6: Commit atomic event integration**

```bash
git add packages/runtime/src/domain/effects.ts packages/runtime/src/composition/index.ts packages/runtime/src/composition/events.ts tests/runtime-composition.test.ts tests/event-store-transaction.test.ts
git commit -m "feat: commit events and snapshots atomically"
```

---

### Task 6: Prove corruption detection, crash recovery, and Node path safety

**Files:**

- Create: `tests/event-store-corruption.test.ts`
- Create: `tests/event-store-fault-campaign.test.ts`
- Create: `tests/node-event-store.test.ts`
- Modify: `tests/runtime-distribution.test.ts`

**Interfaces:**

- Consumes: completed event domain/composition API and existing fake/Node durable-filesystem adapters.
- Produces: reproducible issue evidence for mutation, truncation, transaction divergence prevention, and real-filesystem behavior.

- [ ] **Step 1: Write a failing persisted-corruption matrix**

Build and commit a valid three-event stream and bound snapshot, then create table-driven corruptions:

```ts
const corruptions = [
  ["mutated protected byte", mutateProtectedByte],
  ["first record removed", removeFirstRecord],
  ["middle record removed", removeMiddleRecord],
  ["tail truncated with stale snapshot", removeTailRecord],
  ["records reordered", swapAdjacentRecords],
  ["record duplicated", duplicateRecord],
  ["previous hash changed", changePreviousHash],
  ["event hash changed", changeEventHash],
  ["snapshot cursor changed", changeSnapshotCursor],
  ["snapshot hash changed", changeSnapshotHash],
] as const;
```

For every case, attempt a fourth append and require `runtime.state_corrupt`, stable project-relative evidence, no reflected content, and byte-identical persisted files.

- [ ] **Step 2: Run the corruption suite and verify RED where coverage is missing**

```bash
npx vitest run tests/event-store-corruption.test.ts
```

Expected: at least one case FAIL until preparation maps every corruption path consistently.

- [ ] **Step 3: Close corruption gaps with the smallest production changes**

Adjust only `parse.ts`, `verify.ts`, `reduce.ts`, or `composition/events.ts` classifications required by the failing cases. Do not weaken a test, add a new public reason, or include rejected bytes in errors.

- [ ] **Step 4: Add the transaction fault campaign**

Use `memoryTransactionStorage.fail()` to enumerate before/after faults for every occurrence of:

```ts
[
  "inspect",
  "read_text",
  "create_directory_exclusive",
  "write_file",
  "sync_file",
  "replace_file",
  "sync_directory",
  "remove_file",
] as const
```

For each reachable boundary, rerun from a clean seed, record the thrown stable reason, inspect the transaction summary, invoke `recoverManagedMutation()` when recovery is required, and assert the terminal state is either the exact old pair or the exact new pair. Never accept one old and one new file after terminal recovery. Run recovery twice and require the same receipt/files.

- [ ] **Step 5: Add real Node filesystem integration and security cases**

Create a temporary project with real `.brain/transactions` and use `createRuntimeAt(root, overrides)` with fixed clock and sequential IDs. Commit two events, restart composition with fresh ports, verify replay, and append the third. Add platform-supported cases for a stream or snapshot symlink escaping the root, a special file, case-colliding run directory, read-only permission, and Unicode-safe identifiers. Require refusal without outside-root writes and clean up in `afterEach()`.

- [ ] **Step 6: Prove the bundle contains the event implementation**

Extend `tests/runtime-distribution.test.ts` to inspect `dist/build-meta.json` and require positive `bytesInOutput` for:

```ts
[
  "packages/runtime/src/domain/events/seal.ts",
  "packages/runtime/src/domain/events/parse.ts",
  "packages/runtime/src/domain/events/verify.ts",
  "packages/runtime/src/domain/events/reduce.ts",
  "packages/runtime/src/composition/events.ts",
]
```

Also retain the assertions that no schema is loaded from the checkout and the bundle has no runtime dependency import.

- [ ] **Step 7: Run the campaign and verify GREEN**

```bash
npx vitest run tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts tests/runtime-distribution.test.ts
```

Expected: 4 files PASS; every fault reaches a valid terminal old-or-new pair.

- [ ] **Step 8: Commit hardening evidence**

```bash
git add packages/runtime/src/domain/events packages/runtime/src/composition/events.ts tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts tests/runtime-distribution.test.ts
git commit -m "test: harden event store integrity and recovery"
```

---

### Task 7: Publish architecture, verification evidence, and run the repository gate

**Files:**

- Create: `docs/architecture/event-store.md`
- Create: `docs/verification/issue-21-event-store-evidence.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `README.md`
- Modify: `tests/architecture.test.ts`
- Modify: `tests/readme-honesty.test.ts`

**Interfaces:**

- Consumes: every implemented invariant and exact verification output from Tasks 1–6.
- Produces: public documentation, non-vacuous architecture assertions, issue evidence, and the final repository-wide verification result.

- [ ] **Step 1: Write failing documentation contract tests**

Require `docs/architecture/event-store.md` to contain all of:

```ts
[
  "events.jsonl",
  "state.json",
  "exact-prefix",
  "canonical JSON",
  "previousHash",
  "eventHash",
  "64 KiB",
  "64 MiB",
  "100,000",
  "runtime.state_corrupt",
  "runtime.revision_conflict",
  "runtime.recovery_required",
  "tamper evidence",
  "not authentication",
  "no raw prompts",
]
```

Require the README roadmap to mark only `RUN-06` delivered while preserving honest parity text. Update the architecture import expectation so it includes `./events.js` from composition and verifies all new domain event files in the repository sweep.

- [ ] **Step 2: Run documentation tests and verify RED**

```bash
npx vitest run tests/architecture.test.ts tests/readme-honesty.test.ts
```

Expected: FAIL because the event-store document and roadmap update are absent.

- [ ] **Step 3: Write the architecture and evidence documents**

Document:

- the run-scoped paths and ownership boundary;
- exact unsigned hash coverage and LF-terminated canonical line format;
- first/successor revision invariants;
- pure `policyVersion` reducer replay and snapshot bindings;
- physical replacement versus semantic append-only behavior;
- normal commit, pre-publication abort, and post-publication roll-forward;
- corruption taxonomy and existing public reason mappings;
- bounded input and metadata-only redaction boundary; and
- explicit statement that SHA-256 chaining is tamper evidence, not author authentication.

In the evidence record, include the exact focused commands already run, their
observed pass counts/durations, the corruption matrix, fault-boundary count, and
Node scenarios. Do not pre-write a final repository-gate result and do not claim
a compatibility row or checkbox without the corresponding recorded command.

- [ ] **Step 4: Run the focused documentation and event suites**

```bash
npx vitest run tests/architecture.test.ts tests/readme-honesty.test.ts tests/event-*.test.ts
npm run format:check
npm run spellcheck
npm run lint
npm run typecheck
```

Expected: all commands exit 0 with no warning.

- [ ] **Step 5: Run the complete repository verification gate**

```bash
npm run verify
```

Expected: exit 0 for formatting, spelling, lint, typecheck, full tests, coverage, oracle verification, parity inventory, result contract, contract generation drift, differential checks, build, and package verification.

- [ ] **Step 6: Record the successful full gate without inventing metrics**

Only after Step 5 exits 0, append this exact section to
`docs/verification/issue-21-event-store-evidence.md`:

````markdown
## Final repository gate

Command:

```bash
npm run verify
```

Result: exit 0. Formatting, spelling, lint, typecheck, full tests, coverage,
oracle verification, parity inventory, result-contract checks, contract drift,
differential checks, build, and package verification all completed
successfully. The command did not grant new parity credit.
````

Then run:

```bash
npx prettier --check docs/verification/issue-21-event-store-evidence.md
npx cspell --no-progress --show-suggestions docs/verification/issue-21-event-store-evidence.md
```

Expected: both commands exit 0.

- [ ] **Step 7: Inspect the final diff and requirement coverage**

```bash
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
rg -n '\b(T[O]DO|T[B]D|F[I]XME|X[X]X)\b' packages/runtime/src/domain/events packages/runtime/src/composition/events.ts tests/event-* docs/architecture/event-store.md docs/verification/issue-21-event-store-evidence.md || true
```

Expected: no whitespace errors, no unexpected untracked files, every intended source/test/doc is present, and no placeholder matches.

- [ ] **Step 8: Commit documentation and final evidence**

```bash
git add README.md docs/architecture/event-store.md docs/architecture/runtime-boundaries.md docs/verification/issue-21-event-store-evidence.md tests/architecture.test.ts tests/readme-honesty.test.ts
git commit -m "docs: publish event store integrity evidence"
```

- [ ] **Step 9: Run one fresh post-commit verification before completion claims**

```bash
npm run verify && git status --short --branch
```

Expected: verification exits 0 and the branch is clean and ahead of `origin/main` only by the intentional issue #21 commits.
