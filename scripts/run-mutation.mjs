import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const gatesRoot = join(root, "packages/runtime/src/domain/gates");
const evaluatePath = join(gatesRoot, "evaluate.ts");
const policyPath = join(gatesRoot, "policy.ts");
const [evaluateSource, policySource] = await Promise.all([
  readFile(evaluatePath, "utf8"),
  readFile(policyPath, "utf8"),
]);

const GATE_IDS = [
  "context-readable",
  "stop-loss",
  "prd-present",
  "spec-approved",
  "gaps-closed",
  "partition-approved",
  "acceptance-criteria",
  "final-acceptance",
];

function gateModes(mode, overrides = {}) {
  return Object.freeze(
    Object.fromEntries(
      GATE_IDS.map((gateId) => [gateId, overrides[gateId] ?? mode]),
    ),
  );
}

const base = {
  gateModes: gateModes("enforce", { "gaps-closed": "shadow" }),
  phase: "acceptance",
  contextReadable: true,
  stopLoss: { tripped: false, exhausted: false },
  prdDigest: "a".repeat(64),
  prdDocument: { kind: "complete" },
  specDigest: "b".repeat(64),
  approvals: [],
  openGaps: 1,
  partitionRequired: false,
  partitionApproved: false,
  finalAcceptance: false,
};
const scenarios = [
  base,
  {
    ...base,
    gateModes: gateModes("shadow"),
    phase: "prd",
    openGaps: 1,
    finalAcceptance: true,
  },
  {
    ...base,
    gateModes: gateModes("warn"),
    phase: "prd",
    openGaps: 1,
    finalAcceptance: true,
  },
  {
    ...base,
    gateModes: gateModes("enforce"),
    phase: "prd",
    openGaps: 0,
    finalAcceptance: true,
  },
];

async function bundle(sources) {
  const result = await build({
    entryPoints: [evaluatePath],
    bundle: true,
    format: "esm",
    logLevel: "silent",
    platform: "node",
    target: "node24",
    write: false,
    plugins: [
      {
        name: "mutation-sources",
        setup(context) {
          context.onLoad({ filter: /.*/ }, (args) => {
            if (args.path === evaluatePath) {
              return { contents: sources.evaluate, loader: "ts" };
            }
            if (args.path === policyPath) {
              return { contents: sources.policy, loader: "ts" };
            }
            return undefined;
          });
        },
      },
    ],
  });
  const output = result.outputFiles[0];
  if (output === undefined || result.outputFiles.length !== 1) {
    throw new Error("Mutation bundle must produce exactly one module");
  }
  return output.text;
}

async function load(sources, name) {
  const javascript = await bundle(sources);
  return import(
    `data:text/javascript;base64,${Buffer.from(`${javascript}\n// ${name}`).toString("base64")}`
  );
}

function observations(evaluate) {
  return scenarios.map((scenario) => evaluate(scenario));
}

function replaceAnchor(source, name, before, after) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Mutation anchor ${name} drifted`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Mutation anchor ${name} is ambiguous`);
  }
  return source.replace(before, after);
}

const originalSources = { evaluate: evaluateSource, policy: policySource };
const original = await load(originalSources, "original");
const expected = JSON.stringify(observations(original.evaluateGates));
const mutations = [
  {
    name: "effective-gate-mode",
    target: "evaluate",
    before: "mode: context.gateModes[gateId]",
    after: 'mode: context.gateModes["gaps-closed"]',
  },
  {
    name: "open-gaps",
    target: "evaluate",
    before: "context.openGaps > 0",
    after: "context.openGaps < 0",
  },
  {
    name: "outcome-severity",
    target: "policy",
    before: "block: 0",
    after: "block: 3",
  },
  {
    name: "empty-outcome",
    target: "policy",
    before: 'failures[0] === undefined ? "pass"',
    after: 'failures[0] === undefined ? "warn"',
  },
];
let killed = 0;
for (const { name, target, before, after } of mutations) {
  const sources = {
    ...originalSources,
    [target]: replaceAnchor(originalSources[target], name, before, after),
  };
  const mutant = await load(sources, name);
  if (JSON.stringify(observations(mutant.evaluateGates)) !== expected) {
    killed += 1;
  } else {
    process.stderr.write(`Survived mutation: ${name}\n`);
  }
}
const score = (killed / mutations.length) * 100;
process.stdout.write(
  `gate mutation score: ${String(killed)} / ${String(mutations.length)} (${score.toFixed(2)}%)\n`,
);
if (score < 100) process.exitCode = 1;
