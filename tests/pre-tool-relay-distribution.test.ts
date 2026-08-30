import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { relayCodexPreToolUse } from "@kratos/adapters";
import { renderSummaryScope } from "@kratos/runtime/domain/write-guard";

import {
  buildPlugin,
  hostPackage,
  repositoryRoot,
} from "./support/built-plugin.js";

interface PackagedRunner {
  readonly RUNTIME_GUARD_TIMEOUT_MS: number;
  readonly createRuntimeGuardExecutor: (
    runtimeEntry: string,
    timeoutMs?: number,
    spawnRuntime?: () => never,
  ) => (
    request: unknown,
    root: string,
  ) => {
    readonly exitCode: number | null;
    readonly stdout: string;
  };
}

let root = "";

async function project(persistScope = true): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "kratos-hook-package-"));
  const featureRoot = join(projectRoot, ".brain/02-features/relay");
  await mkdir(join(projectRoot, ".brain/transactions"), { recursive: true });
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
  if (persistScope) {
    await writeFile(
      join(featureRoot, "scope.json"),
      `${JSON.stringify(scope)}\n`,
    );
  }
  await writeFile(join(featureRoot, "03-summa.md"), renderSummaryScope(scope));
  return projectRoot;
}

function invocation(
  host: "claude-code" | "codex" | "antigravity",
  cwd: string,
): unknown {
  const common = {
    session_id: "session-package",
    transcript_path: null,
    cwd,
    hook_event_name: "PreToolUse",
    tool_use_id: "tool-package",
  };
  if (host === "claude-code") {
    return {
      ...common,
      tool_name: "Write",
      tool_input: {
        file_path: join(cwd, "outside/change.ts"),
        content: "change\n",
      },
    };
  }
  if (host === "antigravity") {
    return {
      ...common,
      tool_name: "write_to_file",
      tool_input: {
        TargetFile: join(cwd, "outside/change.ts"),
        CodeContent: "change\n",
        Description: "Add outside change",
      },
    };
  }
  return {
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
  it("ships one identical reviewer-to-code scope activation step", async () => {
    const sections = await Promise.all(
      (["claude-code", "codex", "antigravity"] as const).map(async (host) => {
        const skill = await readFile(
          join(hostPackage(host), "skills/kratos/SKILL.md"),
          "utf8",
        );
        const section = /## Scope activation\n\n([\s\S]+?)(?=\n## |\s*$)/u.exec(
          skill,
        )?.[1];
        expect(section, host).toBeDefined();
        return section;
      }),
    );

    expect(sections[0]).toBe(sections[1]);
    expect(sections[0]).toBe(sections[2]);
    expect(sections[0]).toContain(
      "`node scripts/kratos.mjs scope record --root <absolute-project-root>`",
    );
    expect(sections[0]).toMatch(
      /after valid reviewer prose[\s\S]+before any implementation/iu,
    );
    expect(sections[0]).toContain("The runtime alone");
  });

  it.each(["claude-code", "codex", "antigravity"] as const)(
    "records packaged %s reviewer scope before guarding code",
    async (host) => {
      const projectRoot = await project(false);
      try {
        const pluginRoot = hostPackage(host);
        const bridge = join(pluginRoot, "skills/kratos/scripts/kratos.mjs");
        const recorded = spawnSync(
          process.execPath,
          [bridge, "--json", "scope", "record", "--root", projectRoot],
          { cwd: join(pluginRoot, "skills/kratos"), encoding: "utf8" },
        );
        expect(recorded.status, `${recorded.stdout}${recorded.stderr}`).toBe(0);
        expect(JSON.parse(recorded.stdout)).toMatchObject({
          reasonCode: "trail.ok",
          stateChanged: true,
        });
        expect(
          JSON.parse(
            await readFile(
              join(projectRoot, ".brain/02-features/relay/scope.json"),
              "utf8",
            ),
          ),
        ).toMatchObject({ allow: ["allowed/**"], deny: [] });

        const target = join(projectRoot, "outside/change.ts");
        await expect(readFile(target, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const guarded = spawnSync(
          process.execPath,
          [join(pluginRoot, "hooks/pre-tool-use.mjs")],
          {
            cwd: projectRoot,
            encoding: "utf8",
            input: JSON.stringify(invocation(host, projectRoot)),
          },
        );
        expect(guarded.status).toBe(0);
        expect(
          JSON.parse(
            (
              JSON.parse(guarded.stdout) as {
                hookSpecificOutput: { permissionDecisionReason: string };
              }
            ).hookSpecificOutput.permissionDecisionReason,
          ),
        ).toMatchObject({ reasonCode: "guard.outside_allow" });
        await expect(readFile(target, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    },
  );

  it.each([
    ["claude-code", "Write|Edit|MultiEdit"],
    ["codex", "^apply_patch$"],
    ["antigravity", "write_to_file|replace_file_content"],
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

      const installedCommand = handler?.hooks?.[0]?.command;
      if (typeof installedCommand !== "string") {
        throw new Error("Packaged hook command is absent");
      }
      const result = spawnSync(installedCommand, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: pluginRoot,
          PLUGIN_ROOT: pluginRoot,
        },
        input: JSON.stringify(invocation(host, root)),
        shell: true,
      });

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

  it("gives the runtime a hard deadline below the outer host timeout", async () => {
    const runner = (await import(
      pathToFileURL(
        join(repositoryRoot, "distribution/shared/pre-tool-use-runner.mjs"),
      ).href
    )) as PackagedRunner;
    const directory = await mkdtemp(join(tmpdir(), "kratos-hook-timeout-"));
    try {
      const hangingRuntime = join(directory, "hang.mjs");
      await writeFile(hangingRuntime, "setInterval(() => {}, 1000);\n");
      const started = Date.now();
      const execution = runner.createRuntimeGuardExecutor(hangingRuntime, 25)(
        {},
        directory,
      );

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(execution.exitCode).toBeNull();
      expect(runner.RUNTIME_GUARD_TIMEOUT_MS).toBe(20_000);
      expect(30_000 - runner.RUNTIME_GUARD_TIMEOUT_MS).toBeGreaterThanOrEqual(
        10_000,
      );

      const denial = relayCodexPreToolUse(
        invocation("codex", directory),
        runner.createRuntimeGuardExecutor(hangingRuntime, 25),
      );
      expect(denial).toMatchObject({
        kind: "deny",
        operationResult: null,
        hostExitCode: 0,
      });
      expect(JSON.parse(denial.stdout)).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("returns a non-contract execution for a runtime spawn error", async () => {
    const runner = (await import(
      pathToFileURL(
        join(repositoryRoot, "distribution/shared/pre-tool-use-runner.mjs"),
      ).href
    )) as PackagedRunner;
    const execution = runner.createRuntimeGuardExecutor(
      "/missing/kratos-runtime.mjs",
      5_000,
    )({}, root);

    expect(execution).toEqual({ exitCode: 1, stdout: "" });

    const spawnFailure = runner.createRuntimeGuardExecutor(
      "/unused/runtime.mjs",
      25,
      () => {
        throw new Error("spawn failed");
      },
    )({}, root);
    expect(spawnFailure).toEqual({ exitCode: null, stdout: "" });
  });

  it.each(["claude-code", "codex", "antigravity"] as const)(
    "renders a native denial when the %s adapter cannot import",
    async (host) => {
      const temporary = await mkdtemp(join(tmpdir(), "kratos-hook-import-"));
      try {
        const packageRoot = join(temporary, host);
        await cp(hostPackage(host), packageRoot, { recursive: true });
        const adapter = join(
          packageRoot,
          "runtime/source/packages/adapters/src",
          host,
          "pre-tool-use.js",
        );
        await rm(adapter);

        const result = spawnSync(
          process.execPath,
          [join(packageRoot, "hooks/pre-tool-use.mjs")],
          {
            cwd: root,
            encoding: "utf8",
            input: JSON.stringify(invocation(host, root)),
          },
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
          },
        });
      } finally {
        await rm(temporary, { force: true, recursive: true });
      }
    },
  );
});
