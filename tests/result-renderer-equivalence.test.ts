import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  renderResultHuman,
  renderResultJson,
  type Result,
} from "@mestre-yoda/runtime/domain/result";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const examplesPath = join(repositoryRoot, "fixtures/result-contract/v1");
const libraryUrl = pathToFileURL(
  join(repositoryRoot, "scripts/lib/result-contract.mjs"),
).href;

let examples: Result[];

beforeAll(async () => {
  const names = (await readdir(examplesPath))
    .filter((name) => name.endsWith(".json"))
    .sort();
  examples = await Promise.all(
    names.map(
      async (name) =>
        JSON.parse(
          await readFile(join(examplesPath, name), "utf8"),
        ) as unknown as Result,
    ),
  );
});

function verifierRender(
  operation: "json" | "human",
  result: Result,
): { stdout: string; stderr: string; exitCode: number } {
  const source = `
    import { canonicalResultJson, renderHumanResult } from ${JSON.stringify(libraryUrl)};
    const result = JSON.parse(process.argv[1]);
    const operation = process.argv[2];
    const rendered =
      operation === "json"
        ? { stdout: canonicalResultJson(result), stderr: "", exitCode: result.exitCode }
        : renderHumanResult(result);
    process.stdout.write(JSON.stringify(rendered));
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      source,
      JSON.stringify(result),
      operation,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  expect(child.status, child.stderr).toBe(0);
  const parsed: unknown = JSON.parse(child.stdout);
  return parsed as {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

describe("renderer equivalence", () => {
  it("covers every canonical fixture", () => {
    expect(examples).toHaveLength(6);
  });

  it("emits identical JSON bytes for every fixture", () => {
    for (const example of examples) {
      expect(renderResultJson(example), example.reasonCode).toEqual(
        verifierRender("json", example),
      );
    }
  });

  it("emits identical human bytes for every fixture", () => {
    for (const example of examples) {
      expect(renderResultHuman(example), example.reasonCode).toEqual(
        verifierRender("human", example),
      );
    }
  });

  it("agrees on generated permutations of cause and evidence order", () => {
    const base = examples.find(({ exitCode }) => exitCode === 3);
    expect(base).toBeDefined();
    if (base === undefined) throw new Error("Exit-three fixture is absent");
    const permutations: Result[] = [
      { ...base, why: ["first cause", "second cause"] },
      {
        ...base,
        evidence: [
          { kind: "approval", ref: ".brain/approvals.jsonl" },
          {
            kind: "event",
            ref: ".brain/events.jsonl",
            sha256: "b".repeat(64),
          },
        ],
      },
      { ...base, summary: "A single safe line." },
    ];

    for (const [index, permutation] of permutations.entries()) {
      expect(renderResultJson(permutation), `json ${String(index)}`).toEqual(
        verifierRender("json", permutation),
      );
      expect(renderResultHuman(permutation), `human ${String(index)}`).toEqual(
        verifierRender("human", permutation),
      );
    }
  });
});
