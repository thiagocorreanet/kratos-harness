import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const inventoryRoot = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5",
);
const discoveryPath = join(inventoryRoot, "discovery.json");
const matrixPath = join(inventoryRoot, "matrix.json");
const inventoryLibrary = join(
  repositoryRoot,
  "scripts/lib/parity-inventory.mjs",
);

interface Discovery {
  readonly namespaces: Record<string, readonly { readonly key: string }[]>;
}

interface VerificationCase {
  readonly id: string;
  readonly path: string | null;
  readonly status: "planned" | "passed";
}

interface Row {
  readonly id: string;
  readonly covers: readonly string[];
  readonly expected_behavior: string;
  readonly priority: "P0" | "P1" | "P2";
  readonly verification: Record<string, VerificationCase>;
}

interface Matrix {
  readonly rows: readonly Row[];
}

let discovery: Discovery;
let matrix: Matrix;

beforeAll(async () => {
  [discovery, matrix] = await Promise.all([
    readFile(discoveryPath, "utf8").then(
      (value) => JSON.parse(value) as Discovery,
    ),
    readFile(matrixPath, "utf8").then((value) => JSON.parse(value) as Matrix),
  ]);
});

function runValidation(mutation = ""): ReturnType<typeof spawnSync> {
  const script = [
    `import { readFileSync } from "node:fs";`,
    `import { calculateParity, validateDiscovery, validateMatrix } from ${JSON.stringify(inventoryLibrary)};`,
    `const discovery = JSON.parse(readFileSync(${JSON.stringify(discoveryPath)}, "utf8"));`,
    `const matrix = JSON.parse(readFileSync(${JSON.stringify(matrixPath)}, "utf8"));`,
    mutation,
    `try { validateDiscovery(discovery); validateMatrix(discovery, matrix, ${JSON.stringify(repositoryRoot)}); console.log(JSON.stringify(calculateParity(matrix))); }`,
    `catch (error) { console.error(error.message); process.exitCode = 1; }`,
  ].join("\n");
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
}

describe("living Go v3 parity matrix", () => {
  it("covers every discovery key exactly once", () => {
    const discovered = Object.values(discovery.namespaces)
      .flat()
      .map(({ key }) => key)
      .toSorted();
    const covered = matrix.rows.flatMap(({ covers }) => covers).toSorted();

    expect(covered).toEqual(discovered);
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("gives every P0 and P1 row explicit normal, failure, and edge requirements", () => {
    for (const row of matrix.rows.filter(({ priority }) => priority !== "P2")) {
      expect(row.expected_behavior, row.id).toMatch(/^Normal:/u);
      expect(row.expected_behavior, row.id).toMatch(/ Failure:/u);
      expect(row.expected_behavior, row.id).toMatch(/ Edge:/u);
    }
  });

  it("starts with objective zero-credit parity", () => {
    const result = runValidation();
    expect(result.status).toBe(0);
    expect(JSON.parse(String(result.stdout))).toEqual({
      overall: { credited: 0, total: matrix.rows.length, percent: "0.00" },
      P0: {
        credited: 0,
        total: matrix.rows.filter(({ priority }) => priority === "P0").length,
        percent: "0.00",
      },
      P1: {
        credited: 0,
        total: matrix.rows.filter(({ priority }) => priority === "P1").length,
        percent: "0.00",
      },
    });
  });

  it.each([
    ["mandatory owner", "delete matrix.rows[0].typescript_owner;"],
    ["unique coverage", "matrix.rows[1].covers = matrix.rows[0].covers;"],
    ["E2E case", "delete matrix.rows[0].verification.e2e;"],
    [
      "case-to-kind mapping",
      "[matrix.rows[0].verification.unit.id, matrix.rows[0].verification.differential.id] = [matrix.rows[0].verification.differential.id, matrix.rows[0].verification.unit.id];",
    ],
    [
      "explicit P0 behavior",
      "matrix.rows.find((row) => row.priority === 'P0').expected_behavior = 'Works like legacy.';",
    ],
    [
      "specific P0 behavior",
      "matrix.rows.find((row) => row.priority === 'P0').expected_behavior = `Normal: preserve the frozen contract with deterministic observable results. Failure: reject invalid, unavailable, or inconsistent inputs without unauthorized state mutation and expose the contract's stable failure class. Edge: verify empty, repeated, malformed, concurrency-sensitive, and platform-sensitive inputs.`;",
    ],
    [
      "domain-specific P0 behavior",
      "{ const row = matrix.rows.find((candidate) => candidate.priority === 'P0' && candidate.category !== 'prd'); const name = Object.values(discovery.namespaces).flat().find((entry) => entry.key === row.covers[0]).name; row.expected_behavior = `Normal: ${name} works like the predecessor for ordinary inputs and produces deterministic observable results across supported hosts. Failure: invalid, unavailable, or inconsistent inputs fail safely without unauthorized mutation and retain a stable failure class. Edge: empty, repeated, malformed, concurrency-sensitive, and platform-sensitive inputs remain compatible.`; }",
    ],
    [
      "unique legacy references",
      "matrix.rows[0].legacy_refs.push(matrix.rows[0].legacy_refs[0]);",
    ],
    [
      "nonempty P0 population",
      "for (const row of matrix.rows) if (row.priority === 'P0') row.priority = 'P2';",
    ],
    [
      "nonempty P1 population",
      "for (const row of matrix.rows) if (row.priority === 'P1') row.priority = 'P2';",
    ],
    [
      "related evidence",
      "{ const row = matrix.rows[0]; row.status = 'parity'; for (const evidence of Object.values(row.verification)) { evidence.status = 'passed'; evidence.path = 'package.json'; } }",
    ],
    ["false parity", "matrix.rows[0].status = 'parity';"],
  ])("rejects a matrix without %s", (_name, mutation) => {
    const result = runValidation(mutation);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Parity inventory validation failed:/u);
  });
});
