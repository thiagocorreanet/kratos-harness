import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hookDefinition, renderHooks } from "./render-hooks.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function outputDirectory() {
  const requested = option("--output") ?? process.env.KRATOS_BUILD_OUTPUT;
  const target = resolve(requested ?? join(tmpdir(), "kratos-plugin-build"));
  if (!isAbsolute(target)) throw new Error("Build output must be absolute");
  const insideRepository = relative(repositoryRoot, target);
  if (
    insideRepository === "" ||
    (!insideRepository.startsWith(`..${sep}`) && insideRepository !== "..")
  ) {
    throw new Error("Build output must stay outside the Kratos source tree");
  }
  return target;
}

async function files(directory, suffix = null) {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((entry) => suffix === null || entry.endsWith(suffix))
    .sort();
}

async function digestTree(directory) {
  const hash = createHash("sha256");
  for (const file of await files(directory)) {
    hash.update(relative(directory, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function runtimeSpecifier(outputFile, targetFile) {
  const path = relative(dirname(outputFile), targetFile).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

async function compileTree(sourceRoot, outputRoot, contractsIndex) {
  for (const sourceFile of await files(sourceRoot, ".ts")) {
    const sourceRelative = relative(repositoryRoot, sourceFile);
    const outputFile = join(
      outputRoot,
      sourceRelative.replace(/\.ts$/u, ".js"),
    );
    await mkdir(dirname(outputFile), { recursive: true });
    let source = await readFile(sourceFile, "utf8");
    const contractsSpecifier = runtimeSpecifier(outputFile, contractsIndex);
    source = source.replaceAll(
      '"@kratos/contracts"',
      JSON.stringify(contractsSpecifier),
    );
    let javascript = stripTypeScriptTypes(source, {
      mode: "transform",
      sourceMap: false,
    });
    if (sourceFile.endsWith(`${sep}infra${sep}schema${sep}registry.ts`)) {
      javascript = javascript.replaceAll(
        '"ajv/dist/2020.js"',
        '"./simple-ajv.js"',
      );
    }
    await writeFile(outputFile, javascript, "utf8");
  }
}

function embedded(value) {
  return JSON.stringify(value).slice(1, -1);
}

async function buildRuntime(runtimeDirectory) {
  const sourceOutput = join(runtimeDirectory, "source");
  const contractsIndex = join(sourceOutput, "packages/contracts/src/index.js");
  await Promise.all([
    compileTree(
      join(repositoryRoot, "packages/contracts/src"),
      sourceOutput,
      contractsIndex,
    ),
    compileTree(
      join(repositoryRoot, "packages/adapters/src"),
      sourceOutput,
      contractsIndex,
    ),
    compileTree(
      join(repositoryRoot, "packages/runtime/src"),
      sourceOutput,
      contractsIndex,
    ),
    cp(
      join(repositoryRoot, "packages/contracts/catalogs"),
      join(sourceOutput, "packages/contracts/catalogs"),
      { recursive: true },
    ),
    cp(join(repositoryRoot, "schemas"), join(sourceOutput, "schemas"), {
      recursive: true,
    }),
  ]);

  const corePath = join(runtimeDirectory, "kratos.core.mjs");
  await writeFile(
    corePath,
    'import "./source/packages/runtime/src/main.js";\n',
    "utf8",
  );

  const [template, reasonCatalogText, contractFamiliesText] = await Promise.all(
    [
      readFile(
        join(repositoryRoot, "packages/runtime/src/boot/preflight.mjs"),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "packages/contracts/catalogs/reason-codes.v1.6.json",
        ),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "packages/contracts/catalogs/contract-families.v1.json",
        ),
        "utf8",
      ),
    ],
  );
  const families = JSON.parse(contractFamiliesText);
  const reason = JSON.parse(reasonCatalogText).reasons.find(
    ({ code }) => code === "runtime.node_unsupported",
  );
  if (reason === undefined) throw new Error("Node preflight reason is absent");
  const entry = template.replace(
    /__(MINIMUM_NODE|SUMMARY|RECOVERY|CORE)__/gu,
    (_match, key) =>
      ({
        MINIMUM_NODE: embedded("24.0.0"),
        SUMMARY: embedded(reason.description),
        RECOVERY: embedded(reason.recovery),
        CORE: "./kratos.core.mjs",
      })[key],
  );
  if (/__[A-Z_]+__/u.test(entry)) {
    throw new Error("Runtime preflight contains an unresolved placeholder");
  }
  const entryPath = join(runtimeDirectory, "kratos.mjs");
  await writeFile(entryPath, entry, "utf8");
  await writeFile(
    join(runtimeDirectory, "THIRD-PARTY-NOTICES.txt"),
    [
      "Kratos third-party notices",
      "",
      "This source-only build carries no third-party runtime code.",
      "",
    ].join("\n"),
    "utf8",
  );
  if (process.platform !== "win32") await chmod(entryPath, 0o755);
  return {
    families,
    coreSha256: createHash("sha256")
      .update(await readFile(corePath))
      .digest("hex"),
    sourceTreeSha256: await digestTree(sourceOutput),
  };
}

async function buildHost(output, host, runtimeTemplate, runtimeMetadata) {
  const artifact = join(output, host);
  await mkdir(artifact, { recursive: true });
  await Promise.all([
    cp(runtimeTemplate, join(artifact, "runtime"), { recursive: true }),
    cp(join(repositoryRoot, "distribution", host), artifact, {
      recursive: true,
    }),
  ]);
  await cp(
    join(repositoryRoot, "distribution/shared/pre-tool-use-runner.mjs"),
    join(artifact, "hooks/pre-tool-use-runner.mjs"),
  );
  await cp(
    join(repositoryRoot, "distribution/shared/workflow-hook-runner.mjs"),
    join(artifact, "hooks/workflow-hook-runner.mjs"),
  );
  await writeFile(
    join(artifact, "hooks/hooks.json"),
    renderHooks(await hookDefinition(), host),
    "utf8",
  );
  if (host === "claude-code") {
    const agentDirectory = join(artifact, "agents");
    await mkdir(agentDirectory, { recursive: true });
    await Promise.all(
      runtimeMetadata.phaseAgents.map((definition) =>
        writeFile(
          join(agentDirectory, `${definition.id}.md`),
          [
            "---",
            `name: ${JSON.stringify(definition.id)}`,
            `description: ${JSON.stringify(definition.description)}`,
            "---",
            "",
            definition.instructions,
          ].join("\n"),
          "utf8",
        ),
      ),
    );
  }
  const hostFiles = (await files(artifact)).filter(
    (file) => !relative(artifact, file).startsWith(`runtime${sep}`),
  );
  const hostHash = createHash("sha256");
  for (const file of hostFiles) {
    hostHash.update(relative(artifact, file).split(sep).join("/"));
    hostHash.update("\0");
    hostHash.update(await readFile(file));
    hostHash.update("\0");
  }
  const families = runtimeMetadata.families;
  await writeFile(
    join(artifact, "runtime/manifest.json"),
    `${JSON.stringify(
      {
        contractVersion: "1.0.0",
        pluginVersion: families.pluginVersion,
        host: {
          name: host,
          assetsSha256: hostHash.digest("hex"),
        },
        runtime: {
          entry: "runtime/kratos.mjs",
          core: "runtime/kratos.core.mjs",
          coreSha256: runtimeMetadata.coreSha256,
          sourceRoot: "runtime/source",
          sourceTreeSha256: runtimeMetadata.sourceTreeSha256,
          minimumNode: "24.0.0",
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
  return artifact;
}

async function buildMarketplaces(output) {
  const codexMarketplace = join(output, ".agents/plugins/marketplace.json");
  const claudeMarketplace = join(output, ".claude-plugin/marketplace.json");
  await Promise.all([
    mkdir(dirname(codexMarketplace), { recursive: true }),
    mkdir(dirname(claudeMarketplace), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      codexMarketplace,
      `${JSON.stringify(
        {
          name: "kratos-open-source",
          interface: { displayName: "Kratos Open Source" },
          plugins: [
            {
              name: "kratos",
              source: { source: "local", path: "./codex" },
              policy: {
                installation: "AVAILABLE",
                authentication: "ON_INSTALL",
              },
              category: "Productivity",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      claudeMarketplace,
      `${JSON.stringify(
        {
          name: "kratos-open-source",
          owner: { name: "Kratos contributors" },
          description: "Open-source Kratos development workflow plugin.",
          plugins: [
            {
              name: "kratos",
              source: "./claude-code",
              description:
                "Deterministic SDD workflow backed by the embedded Kratos runtime.",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

const output = outputDirectory();
await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
const runtimeTemplate = join(output, ".runtime-template");
await mkdir(runtimeTemplate, { recursive: true });
const runtimeMetadata = await buildRuntime(runtimeTemplate);
const phaseAgentModule = await import(
  pathToFileURL(
    join(
      runtimeTemplate,
      "source/packages/runtime/src/domain/phase-agents/index.js",
    ),
  ).href
);
runtimeMetadata.phaseAgents = phaseAgentModule.PHASE_AGENT_PROMPTS;
const artifacts = await Promise.all(
  ["claude-code", "codex"].map((host) =>
    buildHost(output, host, runtimeTemplate, runtimeMetadata),
  ),
);
await rm(runtimeTemplate, { force: true, recursive: true });
await buildMarketplaces(output);
process.stdout.write(`${JSON.stringify({ output, artifacts })}\n`);
