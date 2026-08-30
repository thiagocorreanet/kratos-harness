import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

interface Definition {
  readonly hooks: readonly {
    readonly id: string;
    readonly event: string;
  }[];
}

interface Manifest {
  readonly hooks: Readonly<
    Record<
      string,
      readonly {
        readonly hooks: readonly { readonly command: string }[];
      }[]
    >
  >;
}

describe("workflow hook distribution", () => {
  it("renders all host manifests from the shared declarative definition", async () => {
    const renderer = (await import(
      new URL("../scripts/render-hooks.mjs", import.meta.url).href
    )) as {
      hookDefinition(): Promise<Definition>;
      renderHooks(definition: Definition, host: string): string;
    };
    const definition = await renderer.hookDefinition();
    for (const host of ["claude-code", "codex", "antigravity"]) {
      const committed = await readFile(
        join(root, "distribution", host, "hooks/hooks.json"),
        "utf8",
      );
      expect(committed).toBe(renderer.renderHooks(definition, host));
      const manifest = JSON.parse(committed) as Manifest;
      expect(Object.keys(manifest.hooks)).toEqual(
        definition.hooks.map(({ event }) => event),
      );
    }
  });

  it("keeps observation hooks model- and network-free", async () => {
    const sources = await Promise.all([
      readFile(
        join(root, "distribution/shared/workflow-hook-runner.mjs"),
        "utf8",
      ),
      readFile(
        join(root, "distribution/claude-code/hooks/workflow-hook.mjs"),
        "utf8",
      ),
      readFile(
        join(root, "distribution/codex/hooks/workflow-hook.mjs"),
        "utf8",
      ),
      readFile(
        join(root, "distribution/antigravity/hooks/workflow-hook.mjs"),
        "utf8",
      ),
    ]);
    const joined = sources.join("\n");
    expect(joined).not.toMatch(
      /fetch\(|https?:|openai|anthropic|model[_-]?call/iu,
    );
    expect(joined).not.toMatch(/node:(?:http|https|net|tls|dgram)/u);
  });

  it.each([
    ["claude-code", "tool.before"],
    ["claude-code", "tool.failed"],
    ["claude-code", "session.sample"],
    ["claude-code", "session.end"],
    ["codex", "tool.before"],
    ["codex", "tool.failed"],
    ["codex", "session.sample"],
    ["codex", "session.end"],
    ["antigravity", "tool.before"],
    ["antigravity", "tool.failed"],
    ["antigravity", "session.sample"],
    ["antigravity", "session.end"],
  ] as const)(
    "runs %s %s inertly without state and relays with state",
    async (host, kind) => {
      const temporary = await mkdtemp(join(tmpdir(), "kratos-hook-matrix-"));
      try {
        const project = join(temporary, "project");
        await mkdir(project);
        const runtime = join(temporary, "runtime.mjs");
        await writeFile(
          runtime,
          'import {readFileSync,writeFileSync} from "node:fs";writeFileSync("capture.json",readFileSync(0));\n',
        );
        const harness = join(temporary, "harness.mjs");
        const runnerUrl = new URL(
          "../distribution/shared/workflow-hook-runner.mjs",
          import.meta.url,
        ).href;
        await writeFile(
          harness,
          `import {runWorkflowHookProcess} from ${JSON.stringify(runnerUrl)};runWorkflowHookProcess({host:${JSON.stringify(host)},kind:${JSON.stringify(kind)},runtimeEntry:${JSON.stringify(runtime)},normalize:(_kind,input)=>input});\n`,
        );
        const observation = {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          kind,
          sessionId: "session-a",
          occurredAt: "2026-08-28T12:00:00Z",
        };
        const absent = spawnSync(process.execPath, [harness], {
          cwd: project,
          encoding: "utf8",
          input: JSON.stringify(observation),
        });
        expect(absent.status).toBe(0);
        expect(absent.stdout).toBe("");
        expect(absent.stderr).toBe("");
        expect(await readdir(project)).toEqual([]);

        await mkdir(join(project, ".brain"));
        const present = spawnSync(process.execPath, [harness], {
          cwd: project,
          encoding: "utf8",
          input: JSON.stringify(observation),
        });
        expect(present.status).toBe(0);
        const operation = JSON.parse(
          await readFile(join(project, "capture.json"), "utf8"),
        ) as { payload: { host: string; hook: string; artifact: unknown } };
        expect(operation.payload).toMatchObject({ host, hook: kind });
        expect(operation.payload.artifact).toBeTypeOf("object");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
});
