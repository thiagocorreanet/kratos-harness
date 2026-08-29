import { describe, expect, it } from "vitest";
import type { NarrationV1 } from "@kratos/contracts";
import {
  renderClaudeCodeNarration,
  renderCodexNarration,
} from "@kratos/adapters";

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

  const comprehensiveNarration: NarrationV1 = {
    contractVersion: "1.0.0",
    runId: "run-comprehensive",
    generatedAt: "2026-08-29T12:10:00.000Z",
    beats: [
      {
        contractVersion: "1.0.0",
        beatId: "b-work",
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
        beatId: "b-milestone",
        kind: "milestone",
        subject: "phase:spec",
        sentence: "Specification completed.",
        reasonCode: "workflow.phase_completed",
        occurredAt: "2026-08-29T12:01:00.000Z",
        eventId: "e-2",
        revision: 2,
        facts: {},
        evidenceRefs: ["docs/specs/spec.md"],
      },
      {
        contractVersion: "1.0.0",
        beatId: "b-resume",
        kind: "resumption",
        subject: "phase:code",
        sentence: "Resuming phase implementation.",
        reasonCode: "workflow.phase_resumed",
        occurredAt: "2026-08-29T12:02:00.000Z",
        eventId: "e-3",
        revision: 3,
        facts: {},
        evidenceRefs: [],
      },
      {
        contractVersion: "1.0.0",
        beatId: "b-warn",
        kind: "warning",
        subject: "gate:drift",
        sentence: "File drift detected before verification.",
        reasonCode: "gate.drift_detected",
        occurredAt: "2026-08-29T12:03:00.000Z",
        eventId: "e-4",
        revision: 4,
        facts: {},
        evidenceRefs: ["logs/drift.log"],
      },
      {
        contractVersion: "1.0.0",
        beatId: "b-wait",
        kind: "waiting",
        subject: "gate:approval",
        sentence: "Waiting on human approval before merging.",
        reasonCode: "gate.approval_required",
        occurredAt: "2026-08-29T12:04:00.000Z",
        eventId: "e-5",
        revision: 5,
        facts: {},
        evidenceRefs: ["approvals/request-01.json"],
      },
      {
        contractVersion: "1.0.0",
        beatId: "b-stop",
        kind: "stop",
        subject: "task:test",
        sentence: "Execution stopped due to test failure.",
        reasonCode: "test.suite_failed",
        occurredAt: "2026-08-29T12:05:00.000Z",
        eventId: "e-6",
        revision: 6,
        facts: {},
        evidenceRefs: ["evidence/test-summary.json", "logs/junit.xml"],
      },
    ],
    pendingProgress: {
      kind: "in_progress",
      eventId: "e-7",
      operation: "task:verify",
      elapsedMs: 4200,
      startedAt: "2026-08-29T12:05:00.000Z",
      asOf: "2026-08-29T12:05:04.200Z",
    },
  };

  it("renders equivalent beats in identical order for Claude Code and Codex", () => {
    const claudeOutput = renderClaudeCodeNarration(sampleNarration);
    const codexOutput = renderCodexNarration(sampleNarration);

    expect(claudeOutput).toContain("Authoring specification.");
    expect(claudeOutput).toContain("Specification completed.");
    expect(codexOutput).toContain("Authoring specification.");
    expect(codexOutput).toContain("Specification completed.");

    // Sequence order: first beat appears before second beat in both renderers
    const claudeFirstIdx = claudeOutput.indexOf("Authoring specification.");
    const claudeSecondIdx = claudeOutput.indexOf("Specification completed.");
    expect(claudeFirstIdx).toBeGreaterThanOrEqual(0);
    expect(claudeSecondIdx).toBeGreaterThan(claudeFirstIdx);

    const codexFirstIdx = codexOutput.indexOf("Authoring specification.");
    const codexSecondIdx = codexOutput.indexOf("Specification completed.");
    expect(codexFirstIdx).toBeGreaterThanOrEqual(0);
    expect(codexSecondIdx).toBeGreaterThan(codexFirstIdx);
  });

  it("renders all beat kinds and symbols appropriately in Claude Code", () => {
    const claudeOutput = renderClaudeCodeNarration(comprehensiveNarration);

    expect(claudeOutput).toContain(
      "● [WORK] phase:spec: Authoring specification.",
    );
    expect(claudeOutput).toContain(
      "◆ [MILESTONE] phase:spec: Specification completed. (evidence: docs/specs/spec.md)",
    );
    expect(claudeOutput).toContain(
      "▲ [RESUME] phase:code: Resuming phase implementation.",
    );
    expect(claudeOutput).toContain(
      "⚠️ [WARN] gate:drift: File drift detected before verification. (evidence: logs/drift.log)",
    );
    expect(claudeOutput).toContain(
      "⏳ [WAIT] gate:approval: Waiting on human approval before merging. (evidence: approvals/request-01.json)",
    );
    expect(claudeOutput).toContain(
      "🛑 [STOP] task:test: Execution stopped due to test failure. (evidence: evidence/test-summary.json, logs/junit.xml)",
    );
    expect(claudeOutput).toContain(
      "⏱ [IN PROGRESS] task:verify (elapsed: 4s) [clock-derived]",
    );
  });

  it("renders structured blocks with reason codes, subjects, sentences, and evidence in Codex", () => {
    const codexOutput = renderCodexNarration(comprehensiveNarration);

    expect(codexOutput).toContain(
      "[BEAT:WORK]\nsubject: phase:spec\nsentence: Authoring specification.\nreason: workflow.phase_started",
    );
    expect(codexOutput).toContain(
      "[BEAT:MILESTONE]\nsubject: phase:spec\nsentence: Specification completed.\nreason: workflow.phase_completed\nevidence: docs/specs/spec.md",
    );
    expect(codexOutput).toContain(
      "[BEAT:RESUME]\nsubject: phase:code\nsentence: Resuming phase implementation.\nreason: workflow.phase_resumed",
    );
    expect(codexOutput).toContain(
      "[BEAT:WARN]\nsubject: gate:drift\nsentence: File drift detected before verification.\nreason: gate.drift_detected\nevidence: logs/drift.log",
    );
    expect(codexOutput).toContain(
      "[BEAT:WAIT]\nsubject: gate:approval\nsentence: Waiting on human approval before merging.\nreason: gate.approval_required\nevidence: approvals/request-01.json",
    );
    expect(codexOutput).toContain(
      "[BEAT:STOP]\nsubject: task:test\nsentence: Execution stopped due to test failure.\nreason: test.suite_failed\nevidence: evidence/test-summary.json, logs/junit.xml",
    );
    expect(codexOutput).toContain(
      "[PROGRESS:IN_PROGRESS]\noperation: task:verify\nelapsed: 4s\nstatus: clock-derived",
    );
  });

  it("preserves identical beat sequence order across all beats in both hosts", () => {
    const claudeOutput = renderClaudeCodeNarration(comprehensiveNarration);
    const codexOutput = renderCodexNarration(comprehensiveNarration);

    let lastClaudePos = -1;
    let lastCodexPos = -1;

    for (const beat of comprehensiveNarration.beats) {
      const claudePos = claudeOutput.indexOf(beat.sentence);
      const codexPos = codexOutput.indexOf(beat.sentence);

      expect(claudePos).toBeGreaterThan(lastClaudePos);
      expect(codexPos).toBeGreaterThan(lastCodexPos);

      // Verify subject and evidence are present in both outputs
      expect(claudeOutput).toContain(beat.subject);
      expect(codexOutput).toContain(beat.subject);
      for (const ref of beat.evidenceRefs) {
        expect(claudeOutput).toContain(ref);
        expect(codexOutput).toContain(ref);
      }

      lastClaudePos = claudePos;
      lastCodexPos = codexPos;
    }
  });

  it("does not emit ANSI escape sequences in either host renderer", () => {
    const claudeOutput = renderClaudeCodeNarration(comprehensiveNarration);
    const codexOutput = renderCodexNarration(comprehensiveNarration);

    expect(claudeOutput.includes("\u001b")).toBe(false);
    expect(codexOutput.includes("\u001b")).toBe(false);
  });

  it("renders empty narration gracefully as empty string", () => {
    const emptyNarration: NarrationV1 = {
      contractVersion: "1.0.0",
      runId: "run-empty",
      generatedAt: "2026-08-29T12:00:00.000Z",
      beats: [],
      pendingProgress: null,
    };

    expect(renderClaudeCodeNarration(emptyNarration)).toBe("");
    expect(renderCodexNarration(emptyNarration)).toBe("");
  });
});
