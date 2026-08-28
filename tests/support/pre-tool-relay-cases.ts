import type { FeatureScopeV1, PreToolUseV1 } from "@kratos/contracts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GuardExecutor, PreToolRelayResult } from "@kratos/adapters";
import { renderSummaryScope } from "@kratos/runtime/domain/write-guard";

import { buildPlugin, runtimeEntry } from "./built-plugin.js";
import { createRuntimeGuardExecutor } from "./runtime-guard-executor.js";

export type RelayHost = "claude-code" | "codex";

interface NativeToolCall {
  readonly toolName: string;
  readonly toolInput: unknown;
}

export interface PreToolRelayCase {
  readonly name: string;
  readonly allow: readonly string[];
  readonly deny?: readonly string[];
  readonly claudeCode: NativeToolCall | null;
  readonly codex: NativeToolCall | null;
  readonly expectedRequest: ((host: RelayHost, root: string) => unknown) | null;
  readonly expectedKind: PreToolRelayResult["kind"];
  readonly expectedReasonCode: string | null;
}

const request = (
  mutations: PreToolUseV1["mutations"] | readonly [],
): unknown => ({
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  mutations,
});

const claudePath = (root: string, path: string): string => join(root, path);

export const PRE_TOOL_RELAY_CASES: readonly PreToolRelayCase[] = [
  {
    name: "allowed create",
    allow: ["allowed/**"],
    claudeCode: {
      toolName: "Write",
      toolInput: { file_path: "allowed/new.ts", content: "export {};\n" },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Add File: allowed/new.ts\n+export {};\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "create",
          path:
            host === "claude-code"
              ? claudePath(root, "allowed/new.ts")
              : "allowed/new.ts",
        },
      ]),
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "allowed update",
    allow: ["allowed/**"],
    claudeCode: {
      toolName: "Edit",
      toolInput: {
        file_path: "allowed/existing.ts",
        old_string: "old",
        new_string: "new",
      },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Update File: allowed/existing.ts\n@@\n-old\n+new\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "update",
          path:
            host === "claude-code"
              ? claudePath(root, "allowed/existing.ts")
              : "allowed/existing.ts",
        },
      ]),
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "allowed delete",
    allow: ["allowed/**"],
    claudeCode: null,
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Delete File: allowed/obsolete.ts\n*** End Patch",
      },
    },
    expectedRequest: (host) =>
      host === "codex"
        ? request([{ kind: "delete", path: "allowed/obsolete.ts" }])
        : null,
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "feature denied path",
    allow: [],
    deny: ["forbidden/**"],
    claudeCode: {
      toolName: "Write",
      toolInput: { file_path: "forbidden/secret.ts", content: "secret\n" },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Add File: forbidden/secret.ts\n+secret\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "create",
          path:
            host === "claude-code"
              ? claudePath(root, "forbidden/secret.ts")
              : "forbidden/secret.ts",
        },
      ]),
    expectedKind: "deny",
    expectedReasonCode: "guard.scope_deny",
  },
  {
    name: "outside a non-empty allowlist",
    allow: ["allowed/**"],
    claudeCode: {
      toolName: "Edit",
      toolInput: {
        file_path: "outside/change.ts",
        old_string: "old",
        new_string: "new",
      },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Update File: outside/change.ts\n@@\n-old\n+new\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "update",
          path:
            host === "claude-code"
              ? claudePath(root, "outside/change.ts")
              : "outside/change.ts",
        },
      ]),
    expectedKind: "deny",
    expectedReasonCode: "guard.outside_allow",
  },
  {
    name: "deny wins over allow",
    allow: ["src/**"],
    deny: ["src/private/**"],
    claudeCode: {
      toolName: "Write",
      toolInput: {
        file_path: "src/private/secret.ts",
        content: "secret\n",
      },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Add File: src/private/secret.ts\n+secret\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "create",
          path:
            host === "claude-code"
              ? claudePath(root, "src/private/secret.ts")
              : "src/private/secret.ts",
        },
      ]),
    expectedKind: "deny",
    expectedReasonCode: "guard.scope_deny",
  },
  {
    name: "specification path bypasses allow membership",
    allow: ["src/**"],
    claudeCode: {
      toolName: "Edit",
      toolInput: {
        file_path: ".brain/02-features/relay/03-summa.md",
        old_string: "old",
        new_string: "new",
      },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Update File: .brain/02-features/relay/03-summa.md\n@@\n-old\n+new\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "update",
          path:
            host === "claude-code"
              ? claudePath(root, ".brain/02-features/relay/03-summa.md")
              : ".brain/02-features/relay/03-summa.md",
        },
      ]),
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "state path bypasses allow membership",
    allow: ["src/**"],
    claudeCode: {
      toolName: "Write",
      toolInput: {
        file_path: ".brain/02-features/relay/scope.json",
        content: "{}\n",
      },
    },
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command:
          "*** Begin Patch\n*** Add File: .brain/02-features/relay/evidence.json\n+{}\n*** End Patch",
      },
    },
    expectedRequest: (host, root) =>
      request([
        {
          kind: "create",
          path:
            host === "claude-code"
              ? claudePath(root, ".brain/02-features/relay/scope.json")
              : ".brain/02-features/relay/evidence.json",
        },
      ]),
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "mixed apply_patch preserves mutation order",
    allow: ["allowed/**"],
    claudeCode: null,
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command: [
          "*** Begin Patch",
          "*** Add File: allowed/new.ts",
          "+new",
          "*** Update File: allowed/existing.ts",
          "@@",
          "-old",
          "+new",
          "*** Delete File: allowed/obsolete.ts",
          "*** Update File: allowed/source.ts",
          "*** Move to: allowed/destination.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
      },
    },
    expectedRequest: (host) =>
      host === "codex"
        ? request([
            { kind: "create", path: "allowed/new.ts" },
            { kind: "update", path: "allowed/existing.ts" },
            { kind: "delete", path: "allowed/obsolete.ts" },
            {
              kind: "move",
              source: "allowed/source.ts",
              destination: "allowed/destination.ts",
            },
          ])
        : null,
    expectedKind: "allow",
    expectedReasonCode: "runtime.orientation_ok",
  },
  {
    name: "move checks both ordered endpoints",
    allow: ["allowed/**"],
    deny: ["allowed/destination.ts"],
    claudeCode: null,
    codex: {
      toolName: "apply_patch",
      toolInput: {
        command: [
          "*** Begin Patch",
          "*** Update File: allowed/source.ts",
          "*** Move to: allowed/destination.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
      },
    },
    expectedRequest: (host) =>
      host === "codex"
        ? request([
            {
              kind: "move",
              source: "allowed/source.ts",
              destination: "allowed/destination.ts",
            },
          ])
        : null,
    expectedKind: "deny",
    expectedReasonCode: "guard.scope_deny",
  },
  {
    name: "malformed recognized mutation fails closed through runtime",
    allow: [],
    claudeCode: { toolName: "Write", toolInput: { content: "missing path" } },
    codex: {
      toolName: "apply_patch",
      toolInput: { command: "*** Begin Patch\n*** Add File:\n*** End Patch" },
    },
    expectedRequest: () => request([]),
    expectedKind: "deny",
    expectedReasonCode: "guard.target_uninspectable",
  },
  {
    name: "unrelated tool passes through without invoking runtime",
    allow: [],
    claudeCode: { toolName: "Bash", toolInput: { command: "printf safe" } },
    codex: { toolName: "Bash", toolInput: { command: "printf safe" } },
    expectedRequest: null,
    expectedKind: "pass",
    expectedReasonCode: null,
  },
];

type Relay = (input: unknown, execute: GuardExecutor) => PreToolRelayResult;

const roots: string[] = [];

export async function createPreToolRelayProject(
  testCase: PreToolRelayCase,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-host-relay-"));
  const featureRoot = join(root, ".brain/02-features/relay");
  await mkdir(featureRoot, { recursive: true });
  await writeFile(join(root, ".brain/02-features/active"), "relay\n");
  await writeFile(
    join(root, ".brain/guardrails.json"),
    `${JSON.stringify({
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      policyMode: "standard",
      snapshots: true,
      managedPaths: [".brain"],
      writeBlocks: [],
    })}\n`,
  );
  const scope: FeatureScopeV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    allow: [...testCase.allow],
    deny: [...(testCase.deny ?? [])],
  };
  await writeFile(
    join(featureRoot, "scope.json"),
    `${JSON.stringify(scope)}\n`,
  );
  await writeFile(join(featureRoot, "03-summa.md"), renderSummaryScope(scope));
  return root;
}

export function nativePreToolRelayInput(
  host: RelayHost,
  root: string,
  toolCall: NativeToolCall,
): unknown {
  const toolInput =
    host === "claude-code" &&
    typeof toolCall.toolInput === "object" &&
    toolCall.toolInput !== null &&
    "file_path" in toolCall.toolInput &&
    typeof toolCall.toolInput.file_path === "string"
      ? {
          ...toolCall.toolInput,
          file_path: join(root, toolCall.toolInput.file_path),
        }
      : toolCall.toolInput;
  return {
    session_id: "session-relay",
    transcript_path: null,
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: toolCall.toolName,
    tool_input: toolInput,
    tool_use_id: "tool-relay",
  };
}

function denialResult(output: string): unknown {
  const rendered = JSON.parse(output) as {
    readonly hookSpecificOutput?: {
      readonly hookEventName?: unknown;
      readonly permissionDecision?: unknown;
      readonly permissionDecisionReason?: unknown;
    };
  };
  expect(rendered.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(typeof rendered.hookSpecificOutput?.permissionDecisionReason).toBe(
    "string",
  );
  return JSON.parse(
    rendered.hookSpecificOutput?.permissionDecisionReason as string,
  ) as unknown;
}

export function describePreToolRelayConformance(
  host: RelayHost,
  relay: Relay,
): void {
  let execute: GuardExecutor;

  beforeAll(() => {
    buildPlugin();
    execute = createRuntimeGuardExecutor(runtimeEntry(host));
  }, 60_000);

  afterAll(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  describe(`${host} pre-tool relay conformance`, () => {
    for (const testCase of PRE_TOOL_RELAY_CASES) {
      const toolCall =
        host === "claude-code" ? testCase.claudeCode : testCase.codex;
      if (toolCall === null) continue;

      it(testCase.name, async () => {
        const root = await createPreToolRelayProject(testCase);
        roots.push(root);
        let executionCount = 0;
        const countedExecution: GuardExecutor = (guardRequest, projectRoot) => {
          executionCount += 1;
          return execute(guardRequest, projectRoot);
        };
        const result = relay(
          nativePreToolRelayInput(host, root, toolCall),
          countedExecution,
        );

        expect(result.kind).toBe(testCase.expectedKind);
        expect(executionCount).toBe(testCase.expectedKind === "pass" ? 0 : 1);
        expect(result.hostExitCode).toBe(0);
        expect(result.guardRequest).toEqual(
          testCase.expectedRequest?.(host, root) ?? null,
        );
        expect(result.operationResult?.reasonCode ?? null).toBe(
          testCase.expectedReasonCode,
        );

        if (result.kind === "deny") {
          expect(denialResult(result.stdout)).toEqual(result.operationResult);
        } else {
          expect(result.stdout).toBe("");
        }
      });
    }
  });
}
