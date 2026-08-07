import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, "scripts/check-result-contract.mjs");
const resultSchemaPath = join(repositoryRoot, "schemas/result.v1.schema.json");
const catalogSchemaPath = join(
  repositoryRoot,
  "schemas/reason-catalog.v1.schema.json",
);
const catalogPath = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.json",
);
const examplesPath = join(repositoryRoot, "fixtures/result-contract/v1");

type JsonObject = Record<string, unknown>;

let canonicalResultSchema: JsonObject;
let canonicalCatalogSchema: JsonObject;
let canonicalCatalog: JsonObject;
let canonicalExamples: JsonObject[];

beforeAll(async () => {
  [canonicalResultSchema, canonicalCatalogSchema, canonicalCatalog] =
    await Promise.all(
      [resultSchemaPath, catalogSchemaPath, catalogPath].map(async (path) =>
        JSON.parse(await readFile(path, "utf8")),
      ),
    );
  canonicalExamples = await Promise.all(
    (await readdir(examplesPath))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(async (name) =>
        JSON.parse(await readFile(join(examplesPath, name), "utf8")),
      ),
  );
});

function run(...args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function reasons(catalog: JsonObject): JsonObject[] {
  return catalog.reasons as JsonObject[];
}

async function mutationPaths(
  mutate: (catalog: JsonObject, examples: JsonObject[]) => void,
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), "yoda-result-contract-"));
  const resultSchema = structuredClone(canonicalResultSchema);
  const catalogSchema = structuredClone(canonicalCatalogSchema);
  const catalog = structuredClone(canonicalCatalog);
  const examples = structuredClone(canonicalExamples);
  mutate(catalog, examples);
  const resultSchemaFile = join(directory, "result.schema.json");
  const catalogSchemaFile = join(directory, "catalog.schema.json");
  const catalogFile = join(directory, "catalog.json");
  const examplesDirectory = join(directory, "examples");
  await mkdir(examplesDirectory);
  await Promise.all([
    writeFile(resultSchemaFile, `${JSON.stringify(resultSchema, null, 2)}\n`),
    writeFile(catalogSchemaFile, `${JSON.stringify(catalogSchema, null, 2)}\n`),
    writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`),
    ...examples.map((example, index) =>
      writeFile(
        join(examplesDirectory, `exit-${String(index)}.json`),
        `${JSON.stringify(example, null, 2)}\n`,
      ),
    ),
  ]);
  return [
    "--result-schema",
    resultSchemaFile,
    "--catalog-schema",
    catalogSchemaFile,
    "--catalog",
    catalogFile,
    "--examples",
    examplesDirectory,
  ];
}

describe("result contract completeness CLI", () => {
  it("reports exact deterministic catalog and exit coverage", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "result contract v1.0.0: verified (76 reasons; exits 0,1,2,3,4,5; 6 examples)\n",
    );
  });

  it.each([
    [
      "missing legacy reason",
      (catalog: JsonObject) => reasons(catalog).shift(),
    ],
    [
      "wrong reason exit",
      (catalog: JsonObject) => {
        const reason = reasons(catalog).find(
          ({ code }) => code === "trail.gate_divergente",
        );
        if (reason === undefined) throw new Error("missing gate reason");
        reason.exitCode = 2;
      },
    ],
    [
      "false mutation claim",
      (_catalog: JsonObject, examples: JsonObject[]) => {
        const blocked = examples.find(({ exitCode }) => exitCode === 3);
        if (blocked === undefined) throw new Error("missing blocked example");
        blocked.stateChanged = true;
      },
    ],
    [
      "stack trace",
      (_catalog: JsonObject, examples: JsonObject[]) => {
        const failure = examples.find(({ exitCode }) => exitCode === 2);
        if (failure === undefined) throw new Error("missing failure example");
        failure.summary = "Error: failed at run (private.ts:1:2)";
      },
    ],
    [
      "absolute evidence path",
      (_catalog: JsonObject, examples: JsonObject[]) => {
        const blocked = examples.find(({ exitCode }) => exitCode === 4);
        if (blocked === undefined) throw new Error("missing recovery example");
        blocked.evidence = [{ kind: "event", ref: "/home/user/events.jsonl" }];
      },
    ],
    [
      "duplicate why",
      (_catalog: JsonObject, examples: JsonObject[]) => {
        const blocked = examples.find(({ exitCode }) => exitCode === 3);
        if (blocked === undefined) throw new Error("missing blocked example");
        const why = blocked.why as string[];
        why.push(why[0] ?? "duplicate");
      },
    ],
    [
      "missing exit example",
      (_catalog: JsonObject, examples: JsonObject[]) => {
        examples.pop();
      },
    ],
  ])("rejects a %s mutation", async (_name, mutate) => {
    const result = run(...(await mutationPaths(mutate)));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Result contract validation failed:/u);
  });

  it.each([["--unknown", "value"], ["--catalog"], ["--examples", ""]])(
    "uses exit 2 for malformed options",
    (...args) => {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toBe(
        "Result contract usage error: expected documented option/value pairs\n",
      );
    },
  );

  it("does not echo inaccessible caller paths", () => {
    const privatePath = join(tmpdir(), "customer-secret", "missing.json");
    const result = run("--catalog", privatePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Result contract validation failed: contract input could not be read\n",
    );
    expect(result.stderr).not.toContain(privatePath);
  });
});
