import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadScenario,
  validateSafeRelativePath,
  type DifferentialScenario,
} from "@kratos/differential";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const emptyDigest =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const validScenario: DifferentialScenario = {
  schemaVersion: 1,
  id: "self-test-equality",
  parityContractIds: ["CLI-VERSION"],
  workspace: {
    entries: [
      { type: "directory", path: "input" },
      {
        type: "file",
        path: "input/context.txt",
        content: "synthetic context\n",
        executable: false,
      },
    ],
  },
  invocation: {
    args: ["--version"],
    stdin: "",
    environment: {},
    timeoutMs: 5_000,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
  },
  capture: { structured: [], git: false },
  normalization: [],
  disclosure: {
    stdout: "digest",
    stderr: "digest",
    artifacts: "digest",
  },
  expected: {
    process: {
      outcome: "exit",
      exitCode: 0,
      signal: null,
      stdout: { bytes: 0, sha256: emptyDigest },
      stderr: { bytes: 0, sha256: emptyDigest },
    },
    filesystem: {
      before: [],
      after: [],
      mutations: [],
    },
    structured: [],
    git: null,
  },
};

async function withScenario(
  value: unknown,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    join(tmpdir(), "kratos-differential-contract-"),
  );
  const path = join(directory, "scenario.json");
  try {
    await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("differential JSON contracts", () => {
  it("tracks every planned PRD case with real frozen matrix IDs", async () => {
    const [corpusSource, matrixSource] = await Promise.all([
      readFile(
        join(
          repositoryRoot,
          "compatibility/fixtures/differential/v1/corpus.json",
        ),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "compatibility/inventory/go-v3-v0.6.5/matrix.json",
        ),
        "utf8",
      ),
    ]);
    const corpus = JSON.parse(corpusSource) as {
      entries: {
        class: string;
        id?: string;
        parityContractIds?: string[];
        requirements?: string[];
      }[];
    };
    const matrix = JSON.parse(matrixSource) as { rows: { id: string }[] };
    const rowIds = new Set(matrix.rows.map(({ id }) => id));
    const planned = corpus.entries.filter(
      ({ class: kind }) => kind === "planned",
    );
    expect(planned).toHaveLength(12);
    expect(
      new Set(planned.flatMap(({ parityContractIds }) => parityContractIds)),
    ).toEqual(
      new Set([
        "PRD-OUTPUT-SCHEMA",
        "PRD-PROBLEM-DISCOVERY",
        "PRD-RESEARCHER",
        "PRD-TEMPLATE",
      ]),
    );
    for (const entry of planned) {
      expect(entry.id).toMatch(/^prd-/u);
      expect(entry.requirements?.every((value) => value.length >= 20)).toBe(
        true,
      );
      expect(entry.parityContractIds?.every((id) => rowIds.has(id))).toBe(true);
      expect(entry).not.toHaveProperty("path");
      expect(entry).not.toHaveProperty("expected");
    }
  });

  it("provides valid linked JSON Schema 2020-12 documents", async () => {
    const [scenarioSource, observationSource] = await Promise.all([
      readFile(
        join(
          repositoryRoot,
          "schemas/compatibility/differential-scenario.v1.schema.json",
        ),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "schemas/compatibility/differential-observation.v1.schema.json",
        ),
        "utf8",
      ),
    ]);
    expect(() => {
      const ajv = new Ajv2020({ strict: true });
      ajv.addSchema(JSON.parse(observationSource) as AnySchemaObject);
      ajv.compile(JSON.parse(scenarioSource) as AnySchemaObject);
    }).not.toThrow();
  });

  it("loads a closed scenario tied to a real parity row", async () => {
    await withScenario(validScenario, async (path) => {
      await expect(loadScenario(path)).resolves.toEqual(validScenario);
    });
  });

  it("rejects unknown fields without echoing their values", async () => {
    const candidate = {
      ...structuredClone(validScenario),
      secret: "do-not-print",
    };
    await withScenario(candidate, async (path) => {
      await expect(loadScenario(path)).rejects.toThrow(
        "Differential scenario self-test-equality is invalid: additionalProperties",
      );
      await expect(loadScenario(path)).rejects.not.toThrow("do-not-print");
    });
  });

  it("rejects an unknown parity contract ID", async () => {
    const candidate = {
      ...structuredClone(validScenario),
      parityContractIds: ["PRD-NOT-REAL"],
    };
    await withScenario(candidate, async (path) => {
      await expect(loadScenario(path)).rejects.toThrow(
        "Differential scenario self-test-equality references an unknown parity contract",
      );
    });
  });

  it.each([
    "../escape",
    "/absolute",
    "C:\\escape",
    "https://private.invalid/file",
    "a\\b",
    "a/./b",
    "a//b",
    "a\u0000b",
  ])("rejects unsafe fixture path %j", (path) => {
    expect(() => validateSafeRelativePath(path)).toThrow(
      "Differential scenario path is unsafe",
    );
  });

  it("rejects duplicate and case-fold-colliding paths", async () => {
    for (const paths of [
      ["same.txt", "same.txt"],
      ["README.md", "Readme.md"],
    ]) {
      const candidate = structuredClone(validScenario);
      candidate.workspace.entries = paths.map((path) => ({
        type: "file" as const,
        path,
        content: "safe\n",
        executable: false,
      }));
      await withScenario(candidate, async (path) => {
        await expect(loadScenario(path)).rejects.toThrow(
          "Differential scenario self-test-equality contains colliding workspace paths",
        );
      });
    }
  });
});
