import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

export async function hookDefinition() {
  return JSON.parse(
    await readFile(
      join(repositoryRoot, "distribution/shared/hooks.v1.json"),
      "utf8",
    ),
  );
}

export function renderHooks(definition, host) {
  const hooks = {};
  for (const entry of definition.hooks) {
    const command =
      entry.kind === "guard"
        ? 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs"'
        : `node "\${CLAUDE_PLUGIN_ROOT}/hooks/workflow-hook.mjs" ${entry.id}`;
    hooks[entry.event] = [
      {
        matcher: entry.matchers[host],
        hooks: [{ type: "command", command, timeout: 30 }],
      },
    ];
  }
  return `${JSON.stringify({ description: definition.description, hooks }, null, 2)}\n`;
}

export async function renderHookFile(host, target) {
  await writeFile(target, renderHooks(await hookDefinition(), host));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const host of ["claude-code", "codex"]) {
    await renderHookFile(
      host,
      join(repositoryRoot, "distribution", host, "hooks/hooks.json"),
    );
  }
}
