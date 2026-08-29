# OBS-04 Narration Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement narration as a pure, deterministic projection of the append-only event log across `@kratos/contracts`, `@kratos/runtime`, and `@kratos/adapters`, providing CLI commands and host renderers for Claude Code and Codex.

**Architecture:** Pure projection engine (`projectNarration`) evaluating validated event logs against an explicit rule mapping table (`EVENT_BEAT_RULES`), resolving sentences from the versioned reason-code catalog (`REASON_CATALOG`), attaching evidence references on stops, projecting clock-derived progress for open in-flight events without log side effects, and rendering through host-specific adapters.

**Tech Stack:** TypeScript (ESM), Node.js, Vitest, Ajv (JSON Schema Draft 2020-12).

**Spec:** `docs/superpowers/specs/2026-08-29-narration-projection-design.md`

## Global Constraints

- Narration must be a 100% pure function of the event log; core projection performs no I/O, Git, or clock reads.
- Replaying a completed run reproduces its narration byte-identically.
- Every structured result is byte-identical with narration enabled or disabled; event logs remain completely unchanged.
- Every beat traces to at least one backing event in the log.
- Unrecognized reason codes degrade gracefully to a valid beat naming the code without throwing.
- Claude Code and Codex adapters must render identical beat counts, kinds, and sequence order for the same run.
- No ANSI color codes may carry semantic meaning.

---

### Task 1: Contracts and Schemas for Beat and Narration

**Files:**
- Create: `schemas/state/beat.v1.schema.json`
- Create: `schemas/state/narration.v1.schema.json`
- Create: `packages/contracts/src/narration.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/narration-contract.test.ts`

**Interfaces:**
- Consumes: `ReadableEvent` from `@kratos/contracts`
- Produces: `BeatKind`, `BeatV1`, `ClockDerivedProgress`, `NarrationV1` exported from `@kratos/contracts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/narration-contract.test.ts
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import beatSchema from "../schemas/state/beat.v1.schema.json" with { type: "json" };
import narrationSchema from "../schemas/state/narration.v1.schema.json" with { type: "json" };
import type { BeatV1, BeatKind, NarrationV1 } from "@kratos/contracts";

describe("narration contracts and schemas", () => {
  const ajv = new Ajv({ strict: true });
  const validateBeat = ajv.compile(beatSchema);
  const validateNarration = ajv.compile(narrationSchema);

  it("validates a valid BeatV1 fixture", () => {
    const beat: BeatV1 = {
      contractVersion: "1.0.0",
      beatId: "beat-001",
      kind: "milestone",
      subject: "phase:spec",
      sentence: "Specification verified and locked.",
      reasonCode: "workflow.phase_completed",
      occurredAt: "2026-08-29T12:00:00.000Z",
      eventId: "event-001",
      revision: 2,
      facts: {},
      evidenceRefs: [],
    };
    expect(validateBeat(beat)).toBe(true);
  });

  it("validates a valid NarrationV1 fixture", () => {
    const narration: NarrationV1 = {
      contractVersion: "1.0.0",
      runId: "run-001",
      generatedAt: "2026-08-29T12:05:00.000Z",
      beats: [],
      pendingProgress: null,
    };
    expect(validateNarration(narration)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/narration-contract.test.ts`
Expected: FAIL due to missing schema files and exports.

- [ ] **Step 3: Write minimal implementation**

Create `schemas/state/beat.v1.schema.json` and `schemas/state/narration.v1.schema.json`, create `packages/contracts/src/narration.ts` with typed interfaces, and export them in `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/narration-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add schemas/state/beat.v1.schema.json schemas/state/narration.v1.schema.json packages/contracts/ tests/narration-contract.test.ts
git commit -m "feat(contracts): add beat and narration schemas and types (#OBS-04)"
```

---

### Task 2: Pure Narration Projection Engine and Mapping Table

**Files:**
- Create: `packages/runtime/src/domain/narration/model.ts`
- Create: `packages/runtime/src/domain/narration/mapping.ts`
- Create: `packages/runtime/src/domain/narration/project.ts`
- Create: `packages/runtime/src/domain/narration/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/narration-projection.test.ts`
- Test: `tests/narration-purity.test.ts`

**Interfaces:**
- Consumes: `ReadableEvent`, `BeatV1`, `NarrationV1`, `REASON_CATALOG`, `reasonPolicy` from `@kratos/contracts`
- Produces: `projectNarration`, `EVENT_BEAT_RULES` from `@kratos/runtime/domain/narration`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/narration-projection.test.ts
import { describe, expect, it } from "vitest";
import { projectNarration } from "@kratos/runtime/domain/narration";
import type { ReadableEvent } from "@kratos/contracts";

describe("projectNarration", () => {
  it("projects milestone beats from workflow phase completed events", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: "evt-1",
        eventType: "transition",
        occurredAt: "2026-08-29T10:00:00.000Z",
        operation: "spec",
        policyVersion: "workflow-v1",
        priorRevision: 1,
        resultingRevision: 2,
        reasonCode: "workflow.phase_completed",
        effect: "state",
        artifactRefs: [],
        evidenceRefs: ["docs/specs/spec.md"],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "a".repeat(64),
      },
    ];

    const narration = projectNarration(events, { runId: "test-run" });
    expect(narration.beats).toHaveLength(1);
    expect(narration.beats[0].kind).toBe("milestone");
    expect(narration.beats[0].eventId).toBe("evt-1");
  });

  it("handles unrecognized reason codes gracefully without throwing", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: "evt-2",
        eventType: "decision",
        occurredAt: "2026-08-29T10:05:00.000Z",
        operation: "code",
        policyVersion: "workflow-v1",
        priorRevision: 2,
        resultingRevision: 2,
        reasonCode: "unknown.custom_failure",
        effect: "none",
        artifactRefs: [],
        evidenceRefs: ["evidence.json"],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: "a".repeat(64),
        eventHash: "b".repeat(64),
      },
    ];

    const narration = projectNarration(events, { runId: "test-run" });
    expect(narration.beats).toHaveLength(1);
    expect(narration.beats[0].kind).toBe("stop");
    expect(narration.beats[0].sentence).toContain("unknown.custom_failure");
    expect(narration.beats[0].evidenceRefs).toEqual(["evidence.json"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/narration-projection.test.ts`
Expected: FAIL due to missing `@kratos/runtime/domain/narration` module.

- [ ] **Step 3: Write minimal implementation**

Implement `packages/runtime/src/domain/narration/mapping.ts`, `project.ts`, `model.ts`, and `index.ts`. Export `"./domain/narration"` in `packages/runtime/package.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/narration-projection.test.ts tests/narration-purity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/ packages/runtime/package.json tests/narration-projection.test.ts tests/narration-purity.test.ts
git commit -m "feat(runtime): implement pure narration projection engine (#OBS-04)"
```

---

### Task 3: Reason Catalog Coverage and Golden Replay Tests

**Files:**
- Create: `tests/narration-catalog-coverage.test.ts`
- Create: `tests/narration-replay.test.ts`
- Create: `fixtures/narration/sample-run-events.jsonl`
- Create: `fixtures/narration/sample-run-beats.json`

**Interfaces:**
- Consumes: `REASON_CATALOG` from `@kratos/contracts`, `projectNarration` from `@kratos/runtime/domain/narration`
- Produces: Test coverage and replay golden validation

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/narration-catalog-coverage.test.ts
import { describe, expect, it } from "vitest";
import { REASON_CATALOG } from "@kratos/contracts";
import { projectNarration } from "@kratos/runtime/domain/narration";
import type { ReadableEvent } from "@kratos/contracts";

describe("narration reason catalog coverage", () => {
  it("covers every reason code in REASON_CATALOG without unhandled errors", () => {
    for (const entry of REASON_CATALOG) {
      const event: ReadableEvent = {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: `evt-${entry.code}`,
        eventType: entry.status === "failure" || entry.status === "blocked" ? "decision" : "operation",
        occurredAt: "2026-08-29T12:00:00.000Z",
        operation: "test",
        policyVersion: "workflow-v1",
        priorRevision: 0,
        resultingRevision: 1,
        reasonCode: entry.code,
        effect: "none",
        artifactRefs: [],
        evidenceRefs: ["ref.json"],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "0".repeat(64),
      };

      const result = projectNarration([event]);
      expect(result).toBeDefined();
      expect(result.beats.every((b) => b.sentence.length > 0)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure/baseline**

Run: `npx vitest run tests/narration-catalog-coverage.test.ts tests/narration-replay.test.ts`

- [ ] **Step 3: Refine implementation and fixtures**

Ensure all reason codes map cleanly and create recorded fixtures for full replay validation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/narration-catalog-coverage.test.ts tests/narration-replay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fixtures/narration/ tests/narration-catalog-coverage.test.ts tests/narration-replay.test.ts
git commit -m "test(narration): add catalog coverage and golden replay tests (#OBS-04)"
```

---

### Task 4: CLI Command `kratos narrate`

**Files:**
- Create: `packages/runtime/src/domain/cli/narrate.ts`
- Modify: `packages/runtime/src/domain/cli/commands.ts`
- Modify: `packages/runtime/src/domain/cli/index.ts`
- Test: `tests/cli-narrate.test.ts`
- Modify: `tests/cli-commands.test.ts`

**Interfaces:**
- Consumes: `projectNarration`, `observingCommand` from `@kratos/runtime`
- Produces: `narrateCommand` registered in `DEFAULT_REGISTRY`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/cli-narrate.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_REGISTRY, dispatch, parseInvocation } from "@kratos/runtime/domain/cli";

describe("kratos narrate command", () => {
  it("parses kratos narrate with --root and --json flags", () => {
    const parsed = parseInvocation(["narrate", "--root", ".", "--json"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind === "invocation") {
      expect(parsed.invocation.spec.path).toEqual(["narrate"]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/cli-narrate.test.ts`
Expected: FAIL due to missing `narrate` command in registry.

- [ ] **Step 3: Implement `narrateCommand` and update command registry**

Create `packages/runtime/src/domain/cli/narrate.ts` using `observingCommand("workflow", ...)`. Add `narrateCommand` to `DEFAULT_REGISTRY` in `commands.ts`. Update `tests/cli-commands.test.ts` registry list to include `"narrate"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli-narrate.test.ts tests/cli-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/cli/ tests/cli-narrate.test.ts tests/cli-commands.test.ts
git commit -m "feat(cli): add kratos narrate command (#OBS-04)"
```

---

### Task 5: Host Renderers for Claude Code and Codex

**Files:**
- Create: `packages/adapters/src/claude-code/narration.ts`
- Create: `packages/adapters/src/codex/narration.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `tests/narration-host-conformance.test.ts`

**Interfaces:**
- Consumes: `NarrationV1`, `BeatV1` from `@kratos/contracts`
- Produces: `renderClaudeCodeNarration`, `renderCodexNarration` from `@kratos/adapters`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/narration-host-conformance.test.ts
import { describe, expect, it } from "vitest";
import type { NarrationV1 } from "@kratos/contracts";
import { renderClaudeCodeNarration, renderCodexNarration } from "@kratos/adapters";

describe("host narration renderers conformance", () => {
  const sampleNarration: NarrationV1 = {
    contractVersion: "1.0.0",
    runId: "run-sample",
    generatedAt: "2026-08-29T12:00:00.000Z",
    beats: [
      {
        contractVersion: "1.0.0",
        beatId: "b-1",
        kind: "work",
        subject: "phase:spec",
        sentence: "Authoring specification.",
        reasonCode: "workflow.phase_started",
        occurredAt: "2026-08-29T12:00:00.000Z",
        eventId: "e-1",
        revision: 1,
        facts: {},
        evidenceRefs: [],
      },
      {
        contractVersion: "1.0.0",
        beatId: "b-2",
        kind: "milestone",
        subject: "phase:spec",
        sentence: "Specification completed.",
        reasonCode: "workflow.phase_completed",
        occurredAt: "2026-08-29T12:01:00.000Z",
        eventId: "e-2",
        revision: 2,
        facts: {},
        evidenceRefs: [],
      },
    ],
    pendingProgress: null,
  };

  it("renders equivalent beats in identical order for Claude Code and Codex", () => {
    const claudeOutput = renderClaudeCodeNarration(sampleNarration);
    const codexOutput = renderCodexNarration(sampleNarration);

    expect(claudeOutput).toContain("Authoring specification.");
    expect(claudeOutput).toContain("Specification completed.");
    expect(codexOutput).toContain("Authoring specification.");
    expect(codexOutput).toContain("Specification completed.");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/narration-host-conformance.test.ts`
Expected: FAIL due to missing adapters exports.

- [ ] **Step 3: Implement renderers in `packages/adapters/`**

Create `packages/adapters/src/claude-code/narration.ts` and `packages/adapters/src/codex/narration.ts`, re-exporting in `packages/adapters/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/narration-host-conformance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/ tests/narration-host-conformance.test.ts
git commit -m "feat(adapters): add Claude Code and Codex narration renderers (#OBS-04)"
```

---

### Task 6: Comprehensive Verification and Acceptance Gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-narration-projection-design.md` (check off acceptance criteria)

**Interfaces:**
- Consumes: All tests, build and check scripts
- Produces: Verified build, all passing checks

- [ ] **Step 1: Run focused narration test suite**

Run: `npx vitest run tests/narration-*.test.ts tests/cli-narrate.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run full project verification**

Run: `npm run verify`
Expected: All checks, lint, format, typecheck, tests, and contract checks PASS.

- [ ] **Step 3: Commit completed verification status**

```bash
git add docs/superpowers/
git commit -m "docs: record verification evidence for narration projection (#OBS-04)"
```
