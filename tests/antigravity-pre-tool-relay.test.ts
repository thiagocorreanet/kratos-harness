import type { OperationResultV1 } from "@kratos/contracts";
import { describe, expect, it } from "vitest";

import {
  normalizeAntigravityHook,
  normalizeAntigravityPreToolUse,
  relayAntigravityPreToolUse,
  type GuardExecutor,
} from "@kratos/adapters";

const validWriteInput = {
  tool_name: "write_to_file",
  tool_input: {
    TargetFile: "/workspace/src/index.ts",
    CodeContent: "console.log('hello');",
    Description: "Add index file",
    toolSummary: "Index file",
    toolAction: "Writing file",
  },
};

const validReplaceInput = {
  tool_name: "replace_file_content",
  tool_input: {
    TargetFile: "/workspace/src/index.ts",
    TargetContent: "console.log('hello');",
    ReplacementContent: "console.log('world');",
    Instruction: "Update greeting",
    Description: "Change hello to world",
    StartLine: 1,
    EndLine: 1,
    AllowMultiple: false,
    toolSummary: "Update greeting",
    toolAction: "Replacing content",
  },
};

describe("Antigravity pre-tool use normalization", () => {
  describe("write_to_file", () => {
    it("normalizes write_to_file without Overwrite as create", () => {
      const result = normalizeAntigravityPreToolUse(validWriteInput);
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "create",
              path: "/workspace/src/index.ts",
            },
          ],
        },
      });
    });

    it("normalizes write_to_file with Overwrite: false as create", () => {
      const result = normalizeAntigravityPreToolUse({
        ...validWriteInput,
        tool_input: {
          ...validWriteInput.tool_input,
          Overwrite: false,
        },
      });
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "create",
              path: "/workspace/src/index.ts",
            },
          ],
        },
      });
    });

    it("normalizes write_to_file with Overwrite: true as update", () => {
      const result = normalizeAntigravityPreToolUse({
        ...validWriteInput,
        tool_input: {
          ...validWriteInput.tool_input,
          Overwrite: true,
        },
      });
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "update",
              path: "/workspace/src/index.ts",
            },
          ],
        },
      });
    });

    it("supports Windows absolute paths in write_to_file", () => {
      const result = normalizeAntigravityPreToolUse({
        ...validWriteInput,
        tool_input: {
          ...validWriteInput.tool_input,
          TargetFile: "C:\\workspace\\src\\index.ts",
        },
      });
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "create",
              path: "C:\\workspace\\src\\index.ts",
            },
          ],
        },
      });
    });
  });

  describe("replace_file_content", () => {
    it("normalizes replace_file_content as update", () => {
      const result = normalizeAntigravityPreToolUse(validReplaceInput);
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "update",
              path: "/workspace/src/index.ts",
            },
          ],
        },
      });
    });

    it("accepts optional AllowMultiple omitted", () => {
      const inputWithoutAllowMultiple = {
        TargetFile: validReplaceInput.tool_input.TargetFile,
        TargetContent: validReplaceInput.tool_input.TargetContent,
        ReplacementContent: validReplaceInput.tool_input.ReplacementContent,
        Instruction: validReplaceInput.tool_input.Instruction,
        Description: validReplaceInput.tool_input.Description,
        StartLine: validReplaceInput.tool_input.StartLine,
        EndLine: validReplaceInput.tool_input.EndLine,
      };
      const result = normalizeAntigravityPreToolUse({
        tool_name: "replace_file_content",
        tool_input: inputWithoutAllowMultiple,
      });
      expect(result).toEqual({
        kind: "guard",
        request: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          mutations: [
            {
              kind: "update",
              path: "/workspace/src/index.ts",
            },
          ],
        },
      });
    });
  });

  describe("non-mutating tools pass-through", () => {
    const nonMutatingTools = [
      "view_file",
      "grep_search",
      "find_by_name",
      "list_dir",
      "run_command",
      "read_url_content",
      "ask_question",
      "send_message",
      "manage_task",
      "schedule",
      "invoke_subagent",
      "define_subagent",
      "manage_subagents",
      "generate_image",
      "search_web",
    ];

    it.each(nonMutatingTools)("passes through %s", (toolName) => {
      const result = normalizeAntigravityPreToolUse({
        tool_name: toolName,
        tool_input: { query: "test" },
      });
      expect(result).toEqual({ kind: "pass" });
    });
  });

  describe("fail-closed handling for malformed payloads", () => {
    const uninspectableExpected = {
      kind: "guard",
      request: {
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        mutations: [],
      },
    };

    it("fails closed when input is not an object", () => {
      expect(normalizeAntigravityPreToolUse(null)).toEqual(
        uninspectableExpected,
      );
      expect(normalizeAntigravityPreToolUse("invalid")).toEqual(
        uninspectableExpected,
      );
      expect(normalizeAntigravityPreToolUse(undefined)).toEqual(
        uninspectableExpected,
      );
    });

    it("fails closed when tool_name is missing or invalid", () => {
      expect(normalizeAntigravityPreToolUse({})).toEqual(
        uninspectableExpected,
      );
      expect(normalizeAntigravityPreToolUse({ tool_name: 123 })).toEqual(
        uninspectableExpected,
      );
    });

    it("fails closed for write_to_file with missing or relative TargetFile", () => {
      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            ...validWriteInput.tool_input,
            TargetFile: "relative/path.ts",
          },
        }),
      ).toEqual(uninspectableExpected);

      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            ...validWriteInput.tool_input,
            TargetFile: "",
          },
        }),
      ).toEqual(uninspectableExpected);

      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            ...validWriteInput.tool_input,
            TargetFile: 123,
          },
        }),
      ).toEqual(uninspectableExpected);
    });

    it("fails closed for write_to_file with missing CodeContent or Description", () => {
      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            TargetFile: "/workspace/src/index.ts",
            Description: "desc",
          },
        }),
      ).toEqual(uninspectableExpected);

      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            TargetFile: "/workspace/src/index.ts",
            CodeContent: "code",
          },
        }),
      ).toEqual(uninspectableExpected);
    });

    it("fails closed for write_to_file with non-boolean Overwrite", () => {
      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "write_to_file",
          tool_input: {
            ...validWriteInput.tool_input,
            Overwrite: "true",
          },
        }),
      ).toEqual(uninspectableExpected);
    });

    it("fails closed for replace_file_content with missing fields", () => {
      expect(
        normalizeAntigravityPreToolUse({
          tool_name: "replace_file_content",
          tool_input: {
            TargetFile: "/workspace/src/index.ts",
          },
        }),
      ).toEqual(uninspectableExpected);
    });

    it("fails closed for replace_file_content with invalid line numbers", () => {
      expect(
        normalizeAntigravityPreToolUse({
          ...validReplaceInput,
          tool_input: {
            ...validReplaceInput.tool_input,
            StartLine: 0,
          },
        }),
      ).toEqual(uninspectableExpected);

      expect(
        normalizeAntigravityPreToolUse({
          ...validReplaceInput,
          tool_input: {
            ...validReplaceInput.tool_input,
            StartLine: 5,
            EndLine: 3,
          },
        }),
      ).toEqual(uninspectableExpected);

      expect(
        normalizeAntigravityPreToolUse({
          ...validReplaceInput,
          tool_input: {
            ...validReplaceInput.tool_input,
            StartLine: 1.5,
          },
        }),
      ).toEqual(uninspectableExpected);
    });

    it("fails closed for replace_file_content with non-boolean AllowMultiple", () => {
      expect(
        normalizeAntigravityPreToolUse({
          ...validReplaceInput,
          tool_input: {
            ...validReplaceInput.tool_input,
            AllowMultiple: "true",
          },
        }),
      ).toEqual(uninspectableExpected);
    });
  });
});

describe("Antigravity pre-tool relay execution", () => {
  const root = "/workspace";
  const nativeInput = {
    cwd: root,
    tool_name: "write_to_file",
    tool_input: {
      TargetFile: "/workspace/src/index.ts",
      CodeContent: "console.log('hello');",
      Description: "Add index file",
    },
  };

  it("passes through without invoking executor for non-mutating tool", () => {
    let called = false;
    const executor: GuardExecutor = () => {
      called = true;
      return { exitCode: 0, stdout: "" };
    };

    const result = relayAntigravityPreToolUse(
      { cwd: root, tool_name: "view_file", tool_input: { AbsolutePath: "/workspace/file.ts" } },
      executor,
    );

    expect(called).toBe(false);
    expect(result).toEqual({
      kind: "pass",
      guardRequest: null,
      operationResult: null,
      stdout: "",
      hostExitCode: 0,
    });
  });

  it("allows when guard execution succeeds", () => {
    const successResult: OperationResultV1 = {
      contractVersion: "1.0.0",
      status: "success",
      exitCode: 0,
      reasonCode: "runtime.orientation_ok",
      summary: "Orientation is valid",
      why: [],
      evidence: [],
      stateChanged: false,
      retryable: false,
      recovery: null,
    };
    const executor: GuardExecutor = () => ({
      exitCode: 0,
      stdout: JSON.stringify(successResult),
    });

    const result = relayAntigravityPreToolUse(nativeInput, executor);

    expect(result.kind).toBe("allow");
    expect(result.hostExitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.operationResult).toEqual(successResult);
  });

  it("denies when guard execution reports failure", () => {
    const failureResult: OperationResultV1 = {
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "guard.scope_deny",
      summary: "Scope denied",
      why: ["The active scope explicitly denies the requested write."],
      evidence: [],
      stateChanged: false,
      retryable: true,
      recovery: "Choose a permitted target or obtain an explicit reviewed change to the deny policy.",
    };
    const executor: GuardExecutor = () => ({
      exitCode: 2,
      stdout: JSON.stringify(failureResult),
    });

    const result = relayAntigravityPreToolUse(nativeInput, executor);

    expect(result.kind).toBe("deny");
    expect(result.hostExitCode).toBe(0);
    expect(result.operationResult).toEqual(failureResult);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
  });
});

describe("Antigravity lifecycle hook normalization", () => {
  const common = {
    session_id: "session-ag",
    occurred_at: "2026-08-30T12:00:00Z",
    usage: { input_tokens: 150, output_tokens: 50 },
  };

  it("normalizes tool.before for write_to_file", () => {
    const input = {
      ...common,
      tool_use_id: "call-1",
      tool_name: "write_to_file",
      tool_input: {
        TargetFile: "/workspace/new.ts",
        CodeContent: "const x = 1;",
        Description: "Create new file",
      },
    };
    const result = normalizeAntigravityHook("tool.before", input);
    expect(result).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "tool.before",
      sessionId: "session-ag",
      occurredAt: "2026-08-30T12:00:00Z",
      toolUseId: "call-1",
      mutations: [
        {
          kind: "create",
          path: "/workspace/new.ts",
        },
      ],
    });
  });

  it("normalizes tool.before for replace_file_content", () => {
    const input = {
      ...common,
      tool_use_id: "call-2",
      tool_name: "replace_file_content",
      tool_input: {
        TargetFile: "/workspace/mod.ts",
        TargetContent: "const x = 1;",
        ReplacementContent: "const x = 2;",
        Instruction: "Update x",
        Description: "Change 1 to 2",
        StartLine: 1,
        EndLine: 1,
      },
    };
    const result = normalizeAntigravityHook("tool.before", input);
    expect(result).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "tool.before",
      sessionId: "session-ag",
      occurredAt: "2026-08-30T12:00:00Z",
      toolUseId: "call-2",
      mutations: [
        {
          kind: "update",
          path: "/workspace/mod.ts",
        },
      ],
    });
  });

  it("returns null for tool.before on non-mutating tool", () => {
    const input = {
      ...common,
      tool_use_id: "call-3",
      tool_name: "view_file",
      tool_input: { AbsolutePath: "/workspace/mod.ts" },
    };
    expect(normalizeAntigravityHook("tool.before", input)).toBeNull();
  });

  it("normalizes tool.failed with token usage and tool family", () => {
    const input = {
      ...common,
      tool_use_id: "call-4",
      tool_name: "run_command",
      exit_code: 127,
      error: "command not found: foobar",
    };
    const result = normalizeAntigravityHook("tool.failed", input);
    expect(result).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "tool.failed",
      sessionId: "session-ag",
      occurredAt: "2026-08-30T12:00:00Z",
      toolUseId: "call-4",
      toolFamily: "shell",
      failureClass: "nonzero_exit",
      exitCode: 127,
      diagnostic: "command not found: foobar",
      usage: { cumulativeGrossTokens: 200 },
    });
  });

  it("normalizes session.sample and session.end", () => {
    const sample = normalizeAntigravityHook("session.sample", common);
    expect(sample).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "session.sample",
      sessionId: "session-ag",
      occurredAt: "2026-08-30T12:00:00Z",
      usage: { cumulativeGrossTokens: 200 },
    });

    const end = normalizeAntigravityHook("session.end", common);
    expect(end).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "session.end",
      sessionId: "session-ag",
      occurredAt: "2026-08-30T12:00:00Z",
      usage: { cumulativeGrossTokens: 200 },
    });
  });
});
