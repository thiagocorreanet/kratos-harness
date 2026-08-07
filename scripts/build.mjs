import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pluginDirectory = join(repositoryRoot, "dist/plugin");
const entryPath = join(pluginDirectory, "runtime/yoda.mjs");
const corePath = join(pluginDirectory, "runtime/yoda.core.mjs");
const manifestPath = join(pluginDirectory, "runtime/manifest.json");
const metadataFile = join(repositoryRoot, "dist/build-meta.json");
const preflightTemplate = join(
  repositoryRoot,
  "packages/runtime/src/boot/preflight.mjs",
);

/** The interpreter floor the preflight enforces and the manifest publishes. */
const minimumNode = "24.0.0";

/**
 * Embed a catalog string inside the preflight's source without letting a quote
 * or backslash escape the literal it lands in.
 */
function embed(value) {
  return JSON.stringify(value).slice(1, -1);
}

await rm(pluginDirectory, { force: true, recursive: true });
await mkdir(dirname(corePath), { recursive: true });

const result = await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: ["packages/runtime/src/main.ts"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  minify: true,
  outfile: "dist/plugin/runtime/yoda.core.mjs",
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await writeFile(
  metadataFile,
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);

const [template, catalogText, familiesText] = await Promise.all([
  readFile(preflightTemplate, "utf8"),
  readFile(
    join(repositoryRoot, "packages/contracts/catalogs/reason-codes.v1.2.json"),
    "utf8",
  ),
  readFile(
    join(
      repositoryRoot,
      "packages/contracts/catalogs/contract-families.v1.json",
    ),
    "utf8",
  ),
]);

const families = JSON.parse(familiesText);
const reason = JSON.parse(catalogText).reasons.find(
  ({ code }) => code === "runtime.node_unsupported",
);
if (reason === undefined) {
  throw new Error(
    "Build failed: runtime.node_unsupported is not in the catalog",
  );
}

// The catalog is the single source of truth for this text. Injecting it here
// keeps the preflight free of a hand-maintained copy that could drift.
const preflight = template
  .replaceAll("__MINIMUM_NODE__", embed(minimumNode))
  .replaceAll("__SUMMARY__", embed(reason.description))
  .replaceAll("__RECOVERY__", embed(reason.recovery))
  .replaceAll("__CORE__", "./yoda.core.mjs");

if (/__[A-Z_]+__/u.test(preflight)) {
  throw new Error(
    "Build failed: the preflight retains an unsubstituted placeholder",
  );
}

await writeFile(entryPath, preflight, "utf8");

const core = await readFile(corePath);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      contractVersion: "1.0.0",
      pluginVersion: families.pluginVersion,
      runtime: {
        entry: "runtime/yoda.mjs",
        core: "runtime/yoda.core.mjs",
        coreSha256: createHash("sha256").update(core).digest("hex"),
        minimumNode,
      },
      contracts: {
        result: families.resultContract,
        reasonCatalog: families.reasonCatalog,
        state: families.stateContract.current,
        host: families.hostContract.current,
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (process.platform !== "win32") {
  await chmod(entryPath, 0o755);
}
