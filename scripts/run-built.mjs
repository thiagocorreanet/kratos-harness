import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const host = process.env.KRATOS_HOST ?? "codex";
if (host !== "codex" && host !== "claude-code") {
  throw new Error("KRATOS_HOST must be codex or claude-code");
}

const requested =
  process.env.KRATOS_BUILD_OUTPUT ?? join(tmpdir(), "kratos-plugin-build");
if (!isAbsolute(requested)) {
  throw new Error("KRATOS_BUILD_OUTPUT must be absolute");
}
const runtime = resolve(requested, host, "runtime/kratos.mjs");
try {
  accessSync(runtime);
} catch {
  throw new Error(
    `Kratos build is absent at ${runtime}. Run npm run build first.`,
  );
}

const result = spawnSync(
  process.execPath,
  [runtime, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
