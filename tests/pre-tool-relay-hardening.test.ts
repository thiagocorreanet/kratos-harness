import {
  normalizeClaudeCodePreToolUse,
  normalizeCodexPreToolUse,
  relayClaudeCodePreToolUse,
  relayCodexPreToolUse,
  type GuardExecutor,
} from "@kratos/adapters";
import { describe, expect, it, vi } from "vitest";

const request = (mutations: readonly unknown[]): unknown => ({
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  mutations,
});

function codex(command: unknown): unknown {
  return {
    cwd: "/project",
    tool_name: "apply_patch",
    tool_input: { command },
  };
}

function claude(toolName: string, toolInput: unknown): unknown {
  return {
    cwd: "/project",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

describe("Codex native apply_patch normalization", () => {
  it("accepts native boundary whitespace, CRLF, and an environment preamble", () => {
    const native = [
      "  *** Begin Patch  ",
      "*** Environment ID: environment-17",
      "  *** Add File: src/file with spaces.ts  ",
      "+content",
      " *** End Patch ",
    ].join("\r\n");

    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([{ kind: "create", path: "src/file with spaces.ts" }]),
    });
  });

  it("preserves quoted-looking paths and native mixed mutation order", () => {
    const native = [
      "<<'EOF'",
      "*** Begin Patch",
      '*** Add File: "quoted file.ts"',
      "+*** Update File: body-not-a-header.ts",
      "*** Update File: src/existing file.ts",
      "*** Move to: src/moved file.ts",
      "@@ function old()",
      "-old",
      "+new",
      "*** Delete File: src/obsolete file.ts",
      "*** End Patch",
      "EOF",
    ].join("\n");

    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([
        { kind: "create", path: '"quoted file.ts"' },
        {
          kind: "move",
          source: "src/existing file.ts",
          destination: "src/moved file.ts",
        },
        { kind: "delete", path: "src/obsolete file.ts" },
      ]),
    });
  });

  it("does not mistake an update section body for action headers", () => {
    const native = [
      "*** Begin Patch",
      "*** Update File: src/existing.ts",
      "@@",
      " *** Delete File: body-context.ts",
      "+*** Add File: body-added.ts",
      "-*** Update File: body-removed.ts",
      "*** End of File",
      "*** End Patch",
    ].join("\n");

    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([{ kind: "update", path: "src/existing.ts" }]),
    });
  });

  it("matches native action-header whitespace rules in each parser state", () => {
    const native = [
      "*** Begin Patch",
      " *** Add File: src/added.ts   ",
      "+new",
      "  *** Delete File: src/deleted.ts  ",
      "*** Update File: src/updated.ts   ",
      "*** Move to: src/moved.ts   ",
      "@@",
      "-old",
      "+new",
      " *** Delete File: update-context-not-action.ts",
      "*** End Patch",
    ].join("\n");

    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([
        { kind: "create", path: "src/added.ts" },
        { kind: "delete", path: "src/deleted.ts" },
        {
          kind: "move",
          source: "src/updated.ts",
          destination: "src/moved.ts",
        },
      ]),
    });
  });

  it("normalizes a native-valid empty add section", () => {
    const native = [
      "*** Begin Patch",
      "*** Add File: src/empty.ts",
      "*** End Patch",
    ].join("\n");

    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([{ kind: "create", path: "src/empty.ts" }]),
    });
  });

  it.each([
    ["truncated", "*** Begin Patch\n*** Add File: src/new.ts\n+new"],
    [
      "empty update",
      "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch",
    ],
    [
      "empty update chunk",
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** End Patch",
    ],
    [
      "unknown action-looking line",
      "*** Begin Patch\n*** Rename File: src/a.ts\n*** End Patch",
    ],
    [
      "move after update content",
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** Move to: src/b.ts\n*** End Patch",
    ],
    ["empty target", "*** Begin Patch\n*** Delete File: \n*** End Patch"],
    [
      "non-native BOM marker padding",
      "\ufeff*** Begin Patch\n*** Delete File: src/a.ts\n*** End Patch",
    ],
  ])("fails closed for a %s patch", (_label, native) => {
    expect(normalizeCodexPreToolUse(codex(native))).toEqual({
      kind: "guard",
      request: request([]),
    });
  });
});

describe("Claude Code native mutation payload normalization", () => {
  it.each([
    [
      "Write",
      { file_path: "/project/new.ts", content: "new\n" },
      { kind: "create", path: "/project/new.ts" },
    ],
    [
      "Edit",
      {
        file_path: "/project/existing.ts",
        old_string: "old",
        new_string: "new",
        replace_all: false,
      },
      { kind: "update", path: "/project/existing.ts" },
    ],
    [
      "MultiEdit",
      {
        file_path: "/project/existing.ts",
        edits: [
          { old_string: "old", new_string: "new" },
          { old_string: "before", new_string: "after", replace_all: true },
        ],
      },
      { kind: "update", path: "/project/existing.ts" },
    ],
  ])("accepts a complete %s payload", (toolName, toolInput, mutation) => {
    expect(normalizeClaudeCodePreToolUse(claude(toolName, toolInput))).toEqual({
      kind: "guard",
      request: request([mutation]),
    });
  });

  it.each([
    ["relative Write path", "Write", { file_path: "new.ts", content: "new" }],
    ["missing Write content", "Write", { file_path: "/project/new.ts" }],
    [
      "missing Edit old_string",
      "Edit",
      { file_path: "/project/a.ts", new_string: "new" },
    ],
    [
      "non-boolean replace_all",
      "Edit",
      {
        file_path: "/project/a.ts",
        old_string: "old",
        new_string: "new",
        replace_all: "yes",
      },
    ],
    [
      "empty MultiEdit edits",
      "MultiEdit",
      { file_path: "/project/a.ts", edits: [] },
    ],
    [
      "malformed MultiEdit entry",
      "MultiEdit",
      {
        file_path: "/project/a.ts",
        edits: [{ old_string: "old" }],
      },
    ],
  ])("fails closed for %s", (_label, toolName, toolInput) => {
    expect(normalizeClaudeCodePreToolUse(claude(toolName, toolInput))).toEqual({
      kind: "guard",
      request: request([]),
    });
  });
});

const validSuccess = {
  contractVersion: "1.0.0",
  status: "success",
  exitCode: 0,
  reasonCode: "runtime.orientation_ok",
  summary: "The runtime published orientation output without changing state.",
  why: [],
  evidence: [],
  stateChanged: false,
  retryable: false,
  recovery: null,
} as const;

function resultExecutor(
  value: unknown,
  exitCode: number | null = 0,
): GuardExecutor {
  return () => ({ exitCode, stdout: JSON.stringify(value) });
}

const validClaudeInput = claude("Write", {
  file_path: "/project/new.ts",
  content: "new\n",
});
const validCodexInput = codex(
  "*** Begin Patch\n*** Add File: new.ts\n+new\n*** End Patch",
);

describe("complete operation-result validation before host allow", () => {
  const relays = [
    ["Claude Code", relayClaudeCodePreToolUse, validClaudeInput],
    ["Codex", relayCodexPreToolUse, validCodexInput],
  ] as const;

  it.each(relays)("allows a canonical %s success", (_host, relay, input) => {
    expect(relay(input, resultExecutor(validSuccess)).kind).toBe("allow");
  });

  const invalidResults: readonly [string, unknown, number | null][] = [
    ["malformed JSON", "not-json", 0],
    ["extra field", { ...validSuccess, unexpected: true }, 0],
    ["null child exit", validSuccess, null],
    ["mismatched child exit", validSuccess, 2],
    [
      "failure reason disguised as success",
      { ...validSuccess, reasonCode: "trail.uso" },
      0,
    ],
    ["unknown reason", { ...validSuccess, reasonCode: "runtime.unknown" }, 0],
  ];

  for (const [host, relay, input] of relays) {
    it.each(invalidResults)(
      `${host} denies a %s result`,
      (_label, value, exitCode) => {
        const executor: GuardExecutor =
          value === "not-json"
            ? () => ({ exitCode, stdout: "not-json" })
            : resultExecutor(value, exitCode);
        const result = relay(input, executor);
        expect(result.kind).toBe("deny");
        expect(result.operationResult).toBeNull();
      },
    );
  }

  it.each(relays)("denies a %s executor exception", (_host, relay, input) => {
    expect(
      relay(input, () => {
        throw new Error("spawn failed");
      }),
    ).toMatchObject({ kind: "deny", operationResult: null, hostExitCode: 0 });
  });

  it.each([
    ["Claude Code", relayClaudeCodePreToolUse, claude("Read", {})],
    ["Codex", relayCodexPreToolUse, { tool_name: "shell", tool_input: {} }],
  ] as const)(
    "does not invoke the executor for unrelated %s tools",
    (_host, relay, input) => {
      const execute = vi.fn<GuardExecutor>();
      expect(relay(input, execute).kind).toBe("pass");
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
