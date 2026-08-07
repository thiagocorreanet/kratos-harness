import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const examplesPath = join(repositoryRoot, "fixtures/result-contract/v1");
const libraryUrl = pathToFileURL(
  join(repositoryRoot, "scripts/lib/result-contract.mjs"),
).href;

type JsonObject = Record<string, unknown>;
type Rendered = { stdout: string; stderr: string; exitCode: number };

let examples: JsonObject[];

beforeAll(async () => {
  examples = await Promise.all(
    (await readdir(examplesPath))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(async (name) =>
        JSON.parse(await readFile(join(examplesPath, name), "utf8")),
      ),
  );
});

function invoke(
  operation: "json" | "human",
  result: JsonObject,
): SpawnSyncReturns<string> {
  const source = `
    import { canonicalResultJson, renderHumanResult } from ${JSON.stringify(libraryUrl)};
    const value = JSON.parse(process.argv[1]);
    const output = ${operation === "json" ? "canonicalResultJson(value)" : "JSON.stringify(renderHumanResult(value))"};
    process.stdout.write(output);
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source, JSON.stringify(result)],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

describe("universal result rendering", () => {
  it("renders one compact canonical JSON object on stdout", () => {
    for (const example of examples) {
      const rendered = invoke("json", example);
      expect(rendered.status).toBe(0);
      expect(rendered.stderr).toBe("");
      expect(rendered.stdout).toBe(`${JSON.stringify(example)}\n`);
      expect(rendered.stdout.trimEnd().split("\n")).toHaveLength(1);
    }
  });

  it("renders success as summary-only stdout", () => {
    const success = examples.find(({ exitCode }) => exitCode === 0);
    if (success === undefined) throw new Error("missing success example");
    const rendered = invoke("human", success);
    expect(rendered.status).toBe(0);
    expect(rendered.stderr).toBe("");
    expect(JSON.parse(rendered.stdout)).toEqual({
      stdout: `${String(success.summary)}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it("renders failures and blocks to stderr in deterministic field order", () => {
    for (const example of examples.filter(({ exitCode }) => exitCode !== 0)) {
      const rendered = invoke("human", example);
      expect(rendered.status).toBe(0);
      expect(rendered.stderr).toBe("");
      const output = JSON.parse(rendered.stdout) as Rendered;
      const expected = [
        `Summary: ${String(example.summary)}`,
        ...(example.why as string[]).map((why) => `Why: ${why}`),
        `Reason: ${String(example.reasonCode)}`,
        ...(example.evidence as JsonObject[]).map((evidence) =>
          [
            `Evidence: ${String(evidence.kind)} ${String(evidence.ref)}`,
            evidence.sha256 === undefined
              ? ""
              : ` sha256=${String(evidence.sha256)}`,
          ].join(""),
        ),
        `State changed: ${String(example.stateChanged)}`,
        `Retryable: ${String(example.retryable)}`,
        `Recovery: ${String(example.recovery)}`,
      ];
      expect(output).toEqual({
        stdout: "",
        stderr: `${expected.join("\n")}\n`,
        exitCode: example.exitCode,
      });
    }
  });

  it.each([
    ["error prefix", { summary: "Error: private failure" }],
    ["stack frame", { summary: "Stopped at execute (private.ts:1:2)" }],
    ["credential", { summary: "secret=customer-value" }],
    ["private URL", { summary: "Inspect https://private.example/run" }],
    ["Unix path", { summary: "Inspect /home/customer/private.json" }],
    ["Windows path", { summary: "Inspect C:\\Users\\customer\\private.json" }],
    ["control character", { summary: "Invalid\u0000summary" }],
    [
      "inline evidence payload",
      {
        evidence: [{ kind: "event", ref: "events.jsonl", content: "private" }],
      },
    ],
  ])("rejects unsafe %s before rendering", (_name, mutation) => {
    const candidate = structuredClone(examples[3]);
    if (candidate === undefined) throw new Error("missing blocked example");
    Object.assign(candidate, mutation);
    const rendered = invoke("human", candidate);
    expect(rendered.status).not.toBe(0);
    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toContain("Result contract validation failed:");
    expect(rendered.stderr).not.toContain("customer-value");
  });
});
