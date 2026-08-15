import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pluginDirectory = join(repositoryRoot, "dist/plugin");
const entryPath = join(pluginDirectory, "runtime/yoda.mjs");
const corePath = join(pluginDirectory, "runtime/yoda.core.mjs");
const coreOutput = "dist/plugin/runtime/yoda.core.mjs";
const manifestPath = join(pluginDirectory, "runtime/manifest.json");
const noticesPath = join(pluginDirectory, "runtime/THIRD-PARTY-NOTICES.txt");
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
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Build failed: catalog text is missing or not a string");
  }
  // A line break would break out of the emitted line, and a leftover marker
  // would survive the substitution guard below.
  if (/[\r\n]/u.test(value) || /__[A-Z_]+__/u.test(value)) {
    throw new Error("Build failed: catalog text is not embeddable");
  }
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Every third-party package directory whose code the bundle carries.
 *
 * Read from the build's own metadata rather than from a manifest, because a
 * declared dependency and a bundled one are different sets: esbuild inlines
 * only what the entry point reaches, and that is what gets redistributed.
 *
 * Directories rather than names, because a nested `a/node_modules/b` is a
 * different copy at a possibly different version than a hoisted `b`, and
 * attributing the hoisted one would name a version that never shipped.
 */
function bundledPackageDirectories(metafile) {
  const output = metafile.outputs[coreOutput];
  if (output === undefined) {
    throw new Error("Build failed: the bundle recorded no input metadata");
  }
  const marker = "node_modules/";
  const directories = new Set();
  for (const input of Object.keys(output.inputs)) {
    // The last occurrence, so a nested copy resolves to itself.
    const at = input.lastIndexOf(marker);
    if (at === -1) continue;
    const segments = input.slice(at + marker.length).split("/");
    const depth = segments[0].startsWith("@") ? 2 : 1;
    directories.add(
      input.slice(0, at + marker.length) + segments.slice(0, depth).join("/"),
    );
  }
  return [...directories].sort();
}

/** Filenames a package may use for the text its license requires be kept. */
const licenseFilenames = new Set([
  "copying",
  "copying.md",
  "copying.txt",
  "licence",
  "licence.md",
  "licence.txt",
  "license",
  "license.md",
  "license.txt",
]);

/**
 * The license text a package ships, read from the installed package.
 *
 * MIT and the BSD licenses are permissive about everything except this: the
 * notice travels with the copy. `legalComments: "none"` removes it from the
 * bundle, so it is rebuilt here instead of left to survive minification.
 */
async function licenseNotice(packageDirectory) {
  const directory = join(repositoryRoot, packageDirectory);
  const declared = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  if (typeof declared.license !== "string" || declared.license === "") {
    throw new Error(
      `Build failed: ${packageDirectory} is bundled but declares no license`,
    );
  }
  const filename = (await readdir(directory)).find((entry) =>
    licenseFilenames.has(entry.toLowerCase()),
  );
  if (filename === undefined) {
    throw new Error(
      `Build failed: ${packageDirectory} is bundled but ships no license text`,
    );
  }
  const text = await readFile(join(directory, filename), "utf8");
  return {
    heading: `${declared.name} ${declared.version} (${declared.license})`,
    // Line endings normalized so the file is byte-identical on every platform
    // that builds it; the wording itself is copied exactly.
    text: text.replaceAll("\r\n", "\n").trimEnd(),
  };
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
  outfile: coreOutput,
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await writeFile(
  metadataFile,
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);

const notices = await Promise.all(
  bundledPackageDirectories(result.metafile).map(licenseNotice),
);
const rule = "=".repeat(78);
await writeFile(
  noticesPath,
  [
    "Mestre Yoda third-party notices",
    "",
    "runtime/yoda.core.mjs is a bundle. It carries the code of the packages",
    "listed below, and their license terms follow, copied unmodified from the",
    "package each one came from. Nothing else in this plugin is third-party.",
    "",
    ...(notices.length === 0
      ? ["This build carries no third-party code.", ""]
      : notices.flatMap(({ heading, text }) => [
          rule,
          heading,
          rule,
          "",
          text,
          "",
        ])),
  ].join("\n"),
  "utf8",
);

const [template, catalogText, familiesText] = await Promise.all([
  readFile(preflightTemplate, "utf8"),
  readFile(
    join(repositoryRoot, "packages/contracts/catalogs/reason-codes.v1.3.json"),
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
const substitutions = {
  MINIMUM_NODE: embed(minimumNode),
  SUMMARY: embed(reason.description),
  RECOVERY: embed(reason.recovery),
  CORE: "./yoda.core.mjs",
};

// One pass, so an injected value that happens to contain another marker cannot
// be rewritten by a later substitution.
const preflight = template.replace(
  /__(MINIMUM_NODE|SUMMARY|RECOVERY|CORE)__/gu,
  (_match, key) => substitutions[key],
);

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
