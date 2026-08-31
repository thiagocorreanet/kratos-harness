import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

type JsonObject = Record<string, unknown>;
interface Discovery {
  readonly oracle_id: string;
  readonly namespaces: {
    readonly schemas: readonly { readonly name: string }[];
  };
}
interface Matrix {
  readonly rows: readonly {
    readonly id: string;
    readonly category: string;
    readonly covers: readonly string[];
  }[];
}
interface SchemaEntry {
  readonly id: string;
  readonly family: "state" | "host";
  readonly version: string;
  readonly path: string;
  readonly boundary: "persisted" | "cross-process";
  readonly typeName: string;
}
interface LegacyProfile {
  readonly name: string;
  readonly oracleId: string;
  readonly payloadContract: string;
  readonly schemaVersion: number;
  readonly compatibility: "migration-only";
  readonly parityRow: string | null;
  readonly sha256?: string;
}
interface Manifest extends JsonObject {
  readonly contractVersion: string;
  readonly pluginVersion: string;
  readonly resultContract: string;
  readonly reasonCatalog: string;
  readonly stateContract: {
    readonly current: string;
    readonly readable: readonly string[];
    readonly migrationOnly: readonly string[];
  };
  readonly hostContract: {
    readonly current: string;
    readonly accepted: readonly string[];
  };
  schemas: SchemaEntry[];
  legacyProfiles: LegacyProfile[];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function jsonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
    .map((entry) =>
      relative(repositoryRoot, join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    )
    .sort();
}

let manifest: Manifest;
let manifestSchema: JsonObject;
let discovery: Discovery;
let matrix: Matrix;

beforeAll(async () => {
  [manifest, manifestSchema, discovery, matrix] = await Promise.all([
    readJson<Manifest>(
      join(
        repositoryRoot,
        "packages/contracts/catalogs/contract-families.v1.json",
      ),
    ),
    readJson<JsonObject>(
      join(
        repositoryRoot,
        "schemas/contracts/contract-manifest.v1.7.schema.json",
      ),
    ),
    readJson<Discovery>(
      join(
        repositoryRoot,
        "compatibility/inventory/go-v3-v0.6.5/discovery.json",
      ),
    ),
    readJson<Matrix>(
      join(repositoryRoot, "compatibility/inventory/go-v3-v0.6.5/matrix.json"),
    ),
  ]);
});

describe("contract family manifest", () => {
  it("publishes exact independent compatibility windows", () => {
    expect(manifest).toMatchObject({
      contractVersion: "1.0.0",
      pluginVersion: "0.0.0-development",
      resultContract: "1.0.0",
      reasonCatalog: "1.11.0",
      stateContract: {
        current: "1.4.0",
        readable: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"],
        migrationOnly: ["0.9.0", "go-v3@0.6.5"],
      },
      hostContract: {
        current: "1.4.0",
        accepted: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"],
      },
    });
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      manifestSchema,
    );
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("registers every readable payload schema by id and version with safe paths", async () => {
    expect(manifest.schemas).toHaveLength(58);
    const keys = manifest.schemas.map(({ id, version }) => `${id}@${version}`);
    const paths = manifest.schemas.map(({ path }) => path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.sort()).toEqual(
      [
        ...(await jsonFiles(join(repositoryRoot, "schemas/state"))),
        ...(await jsonFiles(join(repositoryRoot, "schemas/host"))),
      ].sort(),
    );
    for (const path of paths) {
      expect(path).toMatch(
        /^schemas\/(?:state|host)\/[a-z-]+\.v1(?:\.[1234])?\.schema\.json$/u,
      );
    }
  });

  it("registers all 14 legacy profiles without claiming PRD parity", () => {
    const discoveredNames = discovery.namespaces.schemas.map(
      ({ name }) => name,
    );
    expect(manifest.legacyProfiles.map(({ name }) => name)).toEqual(
      discoveredNames,
    );
    expect(new Set(discoveredNames).size).toBe(14);

    const schemaRows = new Map(
      matrix.rows
        .filter(({ category }) => category === "schema")
        .map(({ covers, id }) => [covers[0]?.replace(/^schemas\./u, ""), id]),
    );
    for (const profile of manifest.legacyProfiles) {
      expect(profile.oracleId).toBe(discovery.oracle_id);
      expect(profile.compatibility).toBe("migration-only");
      if (profile.name === "prd-output.schema.json") {
        expect(profile).toMatchObject({
          payloadContract: "go-v3.prd-output@1",
          schemaVersion: 1,
          parityRow: null,
          sha256:
            "7fa4f468520fac2f2a0d3b766257e162d25f37520dd7507230616257f2fe503e",
        });
      } else {
        expect(profile.parityRow).toBe(schemaRows.get(profile.name));
        expect(profile).not.toHaveProperty("sha256");
      }
    }
  });

  it.each([
    [
      "duplicate schema id and version",
      (value: Manifest) => {
        const original = value.schemas[1];
        if (original === undefined) throw new Error("missing schema fixture");
        value.schemas[2] = structuredClone(original);
      },
    ],
    [
      "unsafe schema path",
      (value: Manifest) => {
        const original = value.schemas[0];
        if (original === undefined) throw new Error("missing schema fixture");
        value.schemas[0] = { ...original, path: "../private.json" };
      },
    ],
    [
      "PRD parity claim",
      (value: Manifest) => {
        const index = value.legacyProfiles.findIndex(
          ({ name }) => name === "prd-output.schema.json",
        );
        const original = value.legacyProfiles[index];
        if (original === undefined) throw new Error("missing PRD profile");
        value.legacyProfiles[index] = { ...original, parityRow: "SCHEMA-PRD" };
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      manifestSchema,
    );
    expect(validate(candidate)).toBe(false);
  });
});
