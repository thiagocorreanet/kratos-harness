import {
  relayClaudeCodePreToolUse,
  relayCodexPreToolUse,
} from "@kratos/adapters";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderSummaryScope } from "@kratos/runtime/domain/write-guard";

import { buildPlugin, runtimeEntry } from "./support/built-plugin.js";
import { createRuntimeGuardExecutor } from "./support/runtime-guard-executor.js";

let root = "";

beforeAll(async () => {
  buildPlugin();
  root = await mkdtemp(join(tmpdir(), "kratos-host-parity-"));
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
  const scope = {
    contractVersion: "1.0.0" as const,
    stateContract: "1.0.0" as const,
    allow: ["allowed/**"],
    deny: [] as string[],
  };
  await writeFile(
    join(featureRoot, "scope.json"),
    `${JSON.stringify(scope)}\n`,
  );
  await writeFile(join(featureRoot, "03-summa.md"), renderSummaryScope(scope));
}, 60_000);

afterAll(async () => {
  if (root !== "") await rm(root, { force: true, recursive: true });
});

describe("host pre-tool operation-result parity", () => {
  it("publishes exactly identical runtime semantics for equivalent denial", () => {
    const common = {
      session_id: "session-parity",
      transcript_path: null,
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_use_id: "tool-parity",
    };
    const claude = relayClaudeCodePreToolUse(
      {
        ...common,
        tool_name: "Write",
        tool_input: {
          file_path: join(root, "outside/change.ts"),
          content: "change\n",
        },
      },
      createRuntimeGuardExecutor(runtimeEntry("claude-code")),
    );
    const codex = relayCodexPreToolUse(
      {
        ...common,
        tool_name: "apply_patch",
        tool_input: {
          command:
            "*** Begin Patch\n*** Add File: outside/change.ts\n+change\n*** End Patch",
        },
      },
      createRuntimeGuardExecutor(runtimeEntry("codex")),
    );

    expect(claude.operationResult).toEqual(codex.operationResult);
    expect(claude.operationResult).toMatchObject({
      contractVersion: "1.0.0",
      status: "failure",
      exitCode: 2,
      reasonCode: "guard.outside_allow",
      evidence: [{ kind: "artifact", ref: "outside/change.ts" }],
      stateChanged: false,
      retryable: true,
    });
  });
});
