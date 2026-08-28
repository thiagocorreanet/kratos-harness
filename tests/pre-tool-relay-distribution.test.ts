import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderSummaryScope } from "@kratos/runtime/domain/write-guard";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";

let root = "";

async function project(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "kratos-hook-package-"));
  const featureRoot = join(projectRoot, ".brain/02-features/relay");
  await mkdir(featureRoot, { recursive: true });
  await writeFile(join(projectRoot, ".brain/02-features/active"), "relay\n");
  await writeFile(
    join(projectRoot, ".brain/guardrails.json"),
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
  return projectRoot;
}

function invocation(host: "claude-code" | "codex", cwd: string): unknown {
  const common = {
    session_id: "session-package",
    transcript_path: null,
    cwd,
    hook_event_name: "PreToolUse",
    tool_use_id: "tool-package",
  };
  return host === "claude-code"
    ? {
        ...common,
        tool_name: "Write",
        tool_input: {
          file_path: join(cwd, "outside/change.ts"),
          content: "change\n",
        },
      }
    : {
        ...common,
        turn_id: "turn-package",
        tool_name: "apply_patch",
        tool_input: {
          command:
            "*** Begin Patch\n*** Add File: outside/change.ts\n+change\n*** End Patch",
        },
      };
}

beforeAll(async () => {
  buildPlugin();
  root = await project();
}, 60_000);

afterAll(async () => {
  if (root !== "") await rm(root, { force: true, recursive: true });
});

describe("packaged synchronous pre-tool relays", () => {
  it.each([
    ["claude-code", "Write|Edit|MultiEdit"],
    ["codex", "^apply_patch$"],
  ] as const)(
    "installs the %s native matcher and executable",
    async (host, matcher) => {
      const pluginRoot = hostPackage(host);
      const hooks = JSON.parse(
        await readFile(join(pluginRoot, "hooks/hooks.json"), "utf8"),
      ) as {
        readonly hooks?: {
          readonly PreToolUse?: readonly {
            readonly matcher?: unknown;
            readonly hooks?: readonly {
              readonly type?: unknown;
              readonly command?: unknown;
              readonly timeout?: unknown;
              readonly async?: unknown;
            }[];
          }[];
        };
      };
      const handler = hooks.hooks?.PreToolUse?.[0];

      expect(handler?.matcher).toBe(matcher);
      expect(handler?.hooks).toEqual([
        {
          type: "command",
          command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs"',
          timeout: 30,
        },
      ]);

      const result = spawnSync(
        process.execPath,
        [join(pluginRoot, "hooks/pre-tool-use.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: pluginRoot,
            PLUGIN_ROOT: pluginRoot,
          },
          input: JSON.stringify(invocation(host, root)),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as {
        readonly hookSpecificOutput: {
          readonly permissionDecision: unknown;
          readonly permissionDecisionReason: string;
        };
      };
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(
        JSON.parse(output.hookSpecificOutput.permissionDecisionReason),
      ).toMatchObject({
        contractVersion: "1.0.0",
        status: "failure",
        exitCode: 2,
        reasonCode: "guard.outside_allow",
        evidence: [{ kind: "artifact", ref: "outside/change.ts" }],
        stateChanged: false,
      });
    },
  );

  it("binds the Codex manifest to its packaged hook configuration", async () => {
    const manifest = JSON.parse(
      await readFile(
        join(hostPackage("codex"), ".codex-plugin/plugin.json"),
        "utf8",
      ),
    ) as { readonly hooks?: unknown };

    expect(manifest.hooks).toBe("./hooks/hooks.json");
  });
});
