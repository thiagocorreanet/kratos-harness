import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const buildOutput =
  process.env.KRATOS_BUILD_OUTPUT ?? join(tmpdir(), "kratos-plugin-build");
const runtime = join(buildOutput, "codex/runtime");
const entry = join(runtime, "kratos.mjs");
const budgets = JSON.parse(
  await readFile(join(root, "quality/performance-budgets.json"), "utf8"),
);

function elapsed(argument) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [entry, argument], {
    cwd: root,
    encoding: "utf8",
    env: {
      HOME: root,
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: dirname(process.execPath),
    },
  });
  const milliseconds = Number(process.hrtime.bigint() - start) / 1_000_000;
  if (result.status !== 0 || result.stderr !== "") {
    throw new Error(`${argument} benchmark failed`);
  }
  return milliseconds;
}

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

const samples = {};
for (const command of ["help", "version", "handshake"]) {
  samples[command] = Array.from({ length: 7 }, () => elapsed(command));
}
const report = {
  contractVersion: "1.0.0",
  context: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: arch(),
  },
  sampleCount: 7,
  metrics: {
    helpP95Ms: percentile(samples.help, 0.95),
    versionP95Ms: percentile(samples.version, 0.95),
    handshakeP95Ms: percentile(samples.handshake, 0.95),
    bundleBytes: await directoryBytes(runtime),
  },
};
for (const [name, value] of Object.entries(report.metrics)) {
  const maximum = budgets[name];
  if (typeof maximum !== "number" || value > maximum) {
    throw new Error(`${name} exceeded: ${String(value)} > ${String(maximum)}`);
  }
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
