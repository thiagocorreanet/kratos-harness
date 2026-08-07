import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  classifyContractVersion,
  contractFailureResult,
} from "../packages/contracts/src/index.js";
import type {
  CompatibilityClass,
  ContractFamily,
} from "../packages/contracts/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const resultLibraryUrl = pathToFileURL(
  join(repositoryRoot, "scripts/lib/result-contract.mjs"),
).href;

interface VersionCase {
  readonly name: string;
  readonly family: ContractFamily;
  readonly value?: unknown;
  readonly classification: CompatibilityClass;
  readonly reasonCode: string | null;
}

let cases: VersionCase[];

beforeAll(async () => {
  cases = JSON.parse(
    await readFile(
      join(repositoryRoot, "fixtures/contracts/v1/version-cases.json"),
      "utf8",
    ),
  ) as VersionCase[];
});

function renderResult(result: unknown) {
  const source = `
    import { canonicalResultJson } from ${JSON.stringify(resultLibraryUrl)};
    process.stdout.write(canonicalResultJson(JSON.parse(process.argv[1])));
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source, JSON.stringify(result)],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

describe("contract compatibility classifier", () => {
  it("classifies every fixture exactly without mutating input", () => {
    for (const fixture of cases) {
      const before = structuredClone(fixture);
      const result = classifyContractVersion(fixture.family, fixture.value);
      expect(result.classification, fixture.name).toBe(fixture.classification);
      expect(result.reasonCode, fixture.name).toBe(fixture.reasonCode);
      expect(fixture, fixture.name).toEqual(before);
    }
  });

  it("selects a payload contract only for a current identity", () => {
    for (const fixture of cases) {
      const result = classifyContractVersion(fixture.family, fixture.value);
      expect(result.selectedVersion, fixture.name).toBe(
        fixture.classification === "current" ? fixture.value : null,
      );
    }
  });

  it("renders invalid and unsupported identities as safe universal results", () => {
    for (const fixture of cases.filter(({ classification }) =>
      ["invalid", "unsupported"].includes(classification),
    )) {
      const classification = classifyContractVersion(
        fixture.family,
        fixture.value,
      );
      const result = contractFailureResult(classification);
      const rendered = renderResult(result);
      expect(rendered.status, fixture.name).toBe(0);
      expect(rendered.stderr, fixture.name).toBe("");
      expect(JSON.parse(rendered.stdout), fixture.name).toEqual(result);
      expect(result.stateChanged, fixture.name).toBe(false);
      expect(JSON.stringify(result), fixture.name).not.toContain(
        String(fixture.value),
      );
    }
  });

  it("refuses to build a failure result for accepted or migration input", () => {
    for (const fixture of cases.filter(({ classification }) =>
      ["current", "migration_required"].includes(classification),
    )) {
      const classification = classifyContractVersion(
        fixture.family,
        fixture.value,
      );
      expect(() => contractFailureResult(classification), fixture.name).toThrow(
        "Contract failure result requires a rejected classification",
      );
    }
  });
});
