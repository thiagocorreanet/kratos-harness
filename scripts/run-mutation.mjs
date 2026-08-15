import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const source = await readFile(
  join(root, "packages/runtime/src/domain/gates/evaluate.ts"),
  "utf8",
);
const javascript = stripTypeScriptTypes(source, { mode: "transform" });

const base = {
  mode: "enforce",
  phase: "acceptance",
  contextReadable: true,
  stopLoss: { tripped: false, exhausted: false },
  prdDigest: "a".repeat(64),
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
    mode: "shadow",
    phase: "prd",
    approvals: [],
    openGaps: 0,
    finalAcceptance: true,
  },
  {
    ...base,
    mode: "warn",
    phase: "prd",
    approvals: [],
    openGaps: 0,
    finalAcceptance: true,
  },
];

async function load(code, name) {
  return import(
    `data:text/javascript;base64,${Buffer.from(`${code}\n// ${name}`).toString("base64")}`
  );
}

function observations(evaluate) {
  return scenarios.map((scenario) => evaluate(scenario));
}

const original = await load(javascript, "original");
const expected = JSON.stringify(observations(original.evaluateGates));
const mutations = [
  [
    "enforce-mode",
    'context.mode === "enforce"',
    'context.mode === "shadow"',
  ],
  ["open-gaps", "context.openGaps > 0", "context.openGaps < 0"],
  [
    "empty-failures",
    "failures.length === 0",
    "failures.length !== 0",
  ],
];
let killed = 0;
for (const [name, before, after] of mutations) {
  if (!javascript.includes(before)) {
    throw new Error(`Mutation anchor ${name} drifted`);
  }
  const mutant = await load(javascript.replace(before, after), name);
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
