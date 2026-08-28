import { spawnSync } from "node:child_process";

import type { GuardExecutor } from "@kratos/adapters";

export function createRuntimeGuardExecutor(
  runtimeEntry: string,
): GuardExecutor {
  return (request, root) => {
    const execution = spawnSync(
      process.execPath,
      [runtimeEntry, "--json", "guard", "write", "--root", root],
      {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify(request),
        maxBuffer: 1024 * 1024,
      },
    );
    return { exitCode: execution.status, stdout: execution.stdout };
  };
}
