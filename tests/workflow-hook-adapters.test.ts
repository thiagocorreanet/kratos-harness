import { normalizeClaudeCodeHook, normalizeCodexHook } from "@kratos/adapters";
import { describe, expect, it } from "vitest";

const common = {
  session_id: "session-a",
  occurred_at: "2026-08-28T12:00:00Z",
  usage: { input_tokens: 80, output_tokens: 20 },
};

describe("workflow hook adapters", () => {
  it("normalizes equivalent trusted phase starts identically", () => {
    const lifecycle = {
      session_id: "session-a",
      correlation_id: "phase-start-a",
      occurred_at: "2026-08-28T12:00:00.000Z",
      assignment_digest: "a".repeat(64),
    };

    expect(normalizeClaudeCodeHook("phase.start", lifecycle)).toEqual(
      normalizeCodexHook("phase.start", lifecycle),
    );
    expect(normalizeCodexHook("phase.start", lifecycle)).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "phase.start",
      sessionId: "session-a",
      correlationId: "phase-start-a",
      occurredAt: "2026-08-28T12:00:00.000Z",
      assignmentDigest: "a".repeat(64),
    });
  });

  it("does not invent missing trusted phase session identity", () => {
    expect(
      normalizeClaudeCodeHook("phase.start", {
        correlation_id: "phase-start-a",
        occurred_at: "2026-08-28T12:00:00.000Z",
        assignment_digest: "a".repeat(64),
      }),
    ).toBeNull();
  });

  it.each([
    ["traversal session", { session_id: "../outside" }],
    ["space in session", { session_id: "session a" }],
    ["bad correlation", { correlation_id: "phase start a" }],
    ["bad timestamp", { occurred_at: "2026-08-30 12:00:00" }],
    ["bad digest", { assignment_digest: "not-a-sha" }],
    ["oversize identifier", { session_id: "a".repeat(129) }],
  ] as const)("rejects a phase start with %s", (_label, invalid) => {
    expect(
      normalizeCodexHook("phase.start", {
        session_id: "session-a",
        correlation_id: "phase-start-a",
        occurred_at: "2026-08-30T12:00:00.000Z",
        assignment_digest: "a".repeat(64),
        ...invalid,
      }),
    ).toBeNull();
  });

  it.each(["session.sample", "session.end"] as const)(
    "normalizes equivalent %s observations identically",
    (kind) => {
      expect(normalizeClaudeCodeHook(kind, common)).toEqual(
        normalizeCodexHook(kind, common),
      );
    },
  );

  it("normalizes equivalent failures identically", () => {
    const native = {
      ...common,
      tool_use_id: "tool-a",
      tool_name: "Bash",
      exit_code: 1,
      error: "command failed",
    };
    expect(normalizeClaudeCodeHook("tool.failed", native)).toEqual(
      normalizeCodexHook("tool.failed", native),
    );
  });

  it("normalizes equivalent structured writes identically", () => {
    const metadata = {
      session_id: "session-a",
      tool_use_id: "tool-a",
      occurred_at: "2026-08-28T12:00:00Z",
    };
    const claude = normalizeClaudeCodeHook("tool.before", {
      ...metadata,
      tool_name: "Write",
      tool_input: { file_path: "/project/new.ts", content: "export {};" },
    });
    const codex = normalizeCodexHook("tool.before", {
      ...metadata,
      tool_name: "apply_patch",
      tool_input: {
        command:
          "*** Begin Patch\n*** Add File: /project/new.ts\n+export {};\n*** End Patch",
      },
    });
    expect(codex).toEqual(claude);
  });

  it("counts gross input and output exactly once", () => {
    expect(normalizeCodexHook("session.sample", common)).toMatchObject({
      usage: { cumulativeGrossTokens: 100 },
    });
  });

  it("returns a measurement fault signal when usage is malformed", () => {
    expect(
      normalizeClaudeCodeHook("session.end", {
        ...common,
        usage: { input_tokens: -1 },
      }),
    ).toMatchObject({ usage: null });
  });
});
