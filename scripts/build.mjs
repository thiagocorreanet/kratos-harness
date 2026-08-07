import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pluginDirectory = join(repositoryRoot, "dist/plugin");
const artifact = join(pluginDirectory, "runtime/yoda.mjs");
const metadataFile = join(repositoryRoot, "dist/build-meta.json");

await rm(pluginDirectory, { force: true, recursive: true });
await mkdir(dirname(artifact), { recursive: true });

const result = await build({
  absWorkingDir: repositoryRoot,
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  entryPoints: ["packages/runtime/src/main.ts"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  minify: true,
  outfile: "dist/plugin/runtime/yoda.mjs",
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await writeFile(
  metadataFile,
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(pluginDirectory, "unexpected.txt"),
  "intentional package failure\n",
  "utf8",
);

if (process.platform !== "win32") {
  await chmod(artifact, 0o755);
}
