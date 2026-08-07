import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, "scripts/check-parity-inventory.mjs");
const inventoryRoot = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5",
);

let canonicalDiscovery: Record<string, unknown>;
let canonicalMatrix: Record<string, unknown>;

beforeAll(async () => {
  [canonicalDiscovery, canonicalMatrix] = await Promise.all([
    readFile(join(inventoryRoot, "discovery.json"), "utf8").then(
      (value) => JSON.parse(value) as Record<string, unknown>,
    ),
    readFile(join(inventoryRoot, "matrix.json"), "utf8").then(
      (value) => JSON.parse(value) as Record<string, unknown>,
    ),
  ]);
});

function run(...args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function mutationPaths(
  mutate: (
    discovery: Record<string, unknown>,
    matrix: Record<string, unknown>,
  ) => void,
): Promise<readonly [string, string]> {
  const directory = await mkdtemp(join(tmpdir(), "yoda-parity-inventory-"));
  const discovery = structuredClone(canonicalDiscovery);
  const matrix = structuredClone(canonicalMatrix);
  mutate(discovery, matrix);
  const discoveryPath = join(directory, "discovery.json");
  const matrixPath = join(directory, "matrix.json");
  await Promise.all([
    writeFile(discoveryPath, `${JSON.stringify(discovery, null, 2)}\n`),
    writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`),
  ]);
  return [discoveryPath, matrixPath];
}

function rows(matrix: Record<string, unknown>): Record<string, unknown>[] {
  return matrix.rows as Record<string, unknown>[];
}

function requiredRow(
  matrix: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const row = rows(matrix)[index];
  if (row === undefined) throw new Error(`missing test row ${String(index)}`);
  return row;
}

describe("parity inventory completeness CLI", () => {
  it("reports deterministic zero-credit discovery and parity totals", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "discovery go-v3-v0.6.5: verified (386 keys; 30 commands; 10 command forms; 59 command flags; 9 I/O contracts; 4 exit classes; 49 packages; 14 schemas; 59 plugin files; 5 workflows; 55 reason codes)",
        "parity overall: 0 / 384 (0.00%)",
        "parity P0: 0 / 195 (0.00%)",
        "parity P1: 0 / 174 (0.00%)",
        "",
      ].join("\n"),
    );
  });

  it.each([
    [
      "missing row",
      (
        _discovery: Record<string, unknown>,
        matrix: Record<string, unknown>,
      ) => {
        rows(matrix).pop();
      },
    ],
    [
      "missing case",
      (
        _discovery: Record<string, unknown>,
        matrix: Record<string, unknown>,
      ) => {
        delete (requiredRow(matrix, 0).verification as Record<string, unknown>)
          .e2e;
      },
    ],
    [
      "duplicate coverage",
      (
        _discovery: Record<string, unknown>,
        matrix: Record<string, unknown>,
      ) => {
        requiredRow(matrix, 1).covers = requiredRow(matrix, 0).covers;
      },
    ],
    [
      "unsafe path",
      (discovery: Record<string, unknown>) => {
        const namespaces = discovery.namespaces as Record<
          string,
          Record<string, unknown>[]
        >;
        const command = namespaces.commands?.[0];
        if (command === undefined) throw new Error("missing test command");
        command.legacy_refs = ["C:\\private\\source.go"];
      },
    ],
    [
      "Unix absolute path",
      (discovery: Record<string, unknown>) => {
        const namespaces = discovery.namespaces as Record<
          string,
          Record<string, unknown>[]
        >;
        const command = namespaces.commands?.[0];
        if (command === undefined) throw new Error("missing test command");
        command.legacy_refs = ["/root/customer-source.go"];
      },
    ],
    [
      "invented legacy reference",
      (discovery: Record<string, unknown>) => {
        const namespaces = discovery.namespaces as Record<
          string,
          Record<string, unknown>[]
        >;
        const command = namespaces.commands?.[0];
        if (command === undefined) throw new Error("missing test command");
        command.legacy_refs = ["does/not/exist.go#invented"];
      },
    ],
    [
      "duplicate discovery reference",
      (discovery: Record<string, unknown>) => {
        const namespaces = discovery.namespaces as Record<
          string,
          Record<string, unknown>[]
        >;
        const command = namespaces.commands?.[0];
        if (command === undefined) throw new Error("missing test command");
        const references = command.legacy_refs as string[];
        references.push(references[0] ?? "cmd/yoda/help.go");
      },
    ],
    [
      "duplicate discovery name",
      (discovery: Record<string, unknown>) => {
        const namespaces = discovery.namespaces as Record<
          string,
          Record<string, unknown>[]
        >;
        const commands = namespaces.commands;
        if (commands?.[0] === undefined || commands[1] === undefined) {
          throw new Error("missing test commands");
        }
        commands[1].name = commands[0].name;
      },
    ],
    [
      "unknown field",
      (discovery: Record<string, unknown>) => {
        discovery.notes = "customer data";
      },
    ],
    [
      "false parity",
      (
        _discovery: Record<string, unknown>,
        matrix: Record<string, unknown>,
      ) => {
        requiredRow(matrix, 0).status = "parity";
      },
    ],
  ])("rejects a %s mutation", async (_name, mutate) => {
    const [discoveryPath, matrixPath] = await mutationPaths(mutate);
    const result = run("--discovery", discoveryPath, "--matrix", matrixPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Parity inventory validation failed:/u);
  });

  it.each([
    ["--unknown", "value"],
    ["--matrix"],
    ["--source", "/tmp/customer-secret-source"],
  ])("uses exit 2 for malformed options", (...args) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "Parity inventory usage error: expected documented option/value pairs; private source and distribution must be provided together\n",
    );
    expect(result.stderr).not.toContain("customer-secret-source");
  });

  it("sanitizes inaccessible private discovery paths", () => {
    const source = join(tmpdir(), "customer-secret-source", "missing");
    const distribution = join(
      tmpdir(),
      "customer-secret-distribution",
      "missing",
    );
    const result = run("--source", source, "--dist-source", distribution);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Parity inventory validation failed: private discovery command did not complete successfully\n",
    );
    expect(result.stderr).not.toContain(source);
    expect(result.stderr).not.toContain(distribution);
  });
});
