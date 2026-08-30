# Objective Spec: Narration as an Event Log Projection

Date: 2026-08-29
Status: APPROVED
Approval source: GitHub issue OBS-04 and the approved narration projection design

## 1. Problem and Desired Outcome

A run produces a lot of output over a long stretch. Without a fixed vocabulary, the difference between work proceeding, work waiting on a person, and work stopped is buried in approximate, non-reproducible prose emitted as ad-hoc print side effects.

This feature implements narration as a deterministic, pure projection of the append-only event log (`schemas/state/event.v1.1.schema.json` and `schemas/state/event.v1.schema.json`). By mapping canonical `eventType` and versioned reason codes from `@kratos/contracts` to structured, typed beat values, any run reports the identical story on any host and long after it has finished.

## 2. Scope Boundary

### In Scope
- Contract definitions for typed beats (`BeatV1`, `BeatKind`, `NarrationV1`) in `@kratos/contracts`.
- Closed semantic beat taxonomy: `"work" | "milestone" | "resumption" | "warning" | "waiting" | "stop"`.
- Pure domain projection engine (`projectNarration`) in `@kratos/runtime/src/domain/narration/` without any I/O, Git, or clock access.
- Declarative mapping table (`EVENT_BEAT_RULES`) controlling beat density.
- Sentence resolution sourced exclusively from the reason-code catalog (`REASON_CATALOG`), with safe fallback for unrecognized reason codes.
- Evidence references (`evidenceRefs`) attached to every stop and waiting beat.
- Open (in-flight) event elapsed time handling, marked explicitly as clock-derived rather than a persistent beat.
- CLI command `kratos narrate` supporting both human text and structured JSON output.
- Host renderers for Claude Code and Codex in `@kratos/adapters`, providing host-specific symbols and markdown formatting while preserving identical beat values and ordering.
- Full verification suite: golden files, replay consistency, functional purity, reason catalog coverage, and host conformance.

### Out of Scope
- Changing the event schema or adding new `eventType` values.
- Generating intra-step beats or modifying event logs during narration.
- ANSI color codes carrying semantic meaning.
- Invoking LLM models or authoring beats in prompts.

## 3. Architecture and Data Contracts

### 3.1 Data Types (`@kratos/contracts`)

```typescript
export type BeatKind =
  | "work"
  | "milestone"
  | "resumption"
  | "warning"
  | "waiting"
  | "stop";

export interface BeatV1 {
  readonly contractVersion: "1.0.0";
  readonly beatId: string;
  readonly kind: BeatKind;
  readonly subject: string;
  readonly sentence: string;
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly revision: number;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly evidenceRefs: readonly string[];
}

export interface ClockDerivedProgress {
  readonly kind: "in_progress";
  readonly eventId: string;
  readonly operation: string;
  readonly elapsedMs: number;
  readonly startedAt: string;
  readonly asOf: string;
}

export interface NarrationV1 {
  readonly contractVersion: "1.0.0";
  readonly runId: string;
  readonly generatedAt: string;
  readonly beats: readonly BeatV1[];
  readonly pendingProgress: ClockDerivedProgress | null;
}
```

### 3.2 Projection Engine (`@kratos/runtime/src/domain/narration/`)

- `projectNarration(events: readonly ReadableEvent[], options?: ProjectNarrationOptions): NarrationV1`
- Iterates chronologically over validated event logs.
- Maps events via `EVENT_BEAT_RULES`. Unmapped fine-grained events return `null` to ensure high-signal milestones.
- Resolves sentences from `reasonPolicy(event.reasonCode)?.description`. If the code is unrecognized, gracefully formats `"Encountered reason <reasonCode>."`.
- If an open operation is in flight and `options.asOf` is provided, attaches `pendingProgress` calculated as `Date(asOf) - Date(occurredAt)`.

### 3.3 Host Presentation (`@kratos/adapters`)

- `renderClaudeCodeNarration(narration: NarrationV1): string`
- `renderCodexNarration(narration: NarrationV1): string`
- Both renderers consume the same `NarrationV1` object, rendering identical beat counts, reason codes, evidence references, and sequence order.

## 4. Acceptance Criteria

- [x] Narration is a pure function of the event log. The same events produce identical beats, and rendering performs no read of the filesystem, clock, or Git beyond caller-injected elapsed time.
- [x] Replaying a completed run reproduces its narration byte-identically.
- [x] Every structured result is byte-identical with narration enabled or disabled, and the event log is unchanged.
- [x] Every beat traces to at least one backing event in the log.
- [x] An unrecognized reason code degrades to a valid beat naming the code without throwing.
- [x] Both Claude Code and Codex hosts render the same run into equivalent beats in the same order.
- [x] Every human stop produces a waiting beat, and every terminal stop produces a stop beat carrying its evidence references.

## 5. Test Strategy and Failure Modes

- **Golden-File Tests:** Validate formatting for each `BeatKind` and full end-to-end recorded run narration.
- **Replay Tests:** Assert idempotency and identical output across repeated projection passes.
- **Purity Tests:** Assert zero I/O, zero network, and zero clock reads inside the core projection function.
- **Non-Interference Tests:** Assert stdout and event log consistency across runs with and without narration enabled.
- **Catalog Coverage Tests:** Iterate through all entries in `REASON_CATALOG` to guarantee every code has an explicit narration behavior.
- **Host Conformance Tests:** Assert semantic and ordering parity between Claude Code and Codex renderers.
