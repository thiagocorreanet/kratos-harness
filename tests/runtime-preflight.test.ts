import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, runtimeEntry } from "./support/built-plugin.js";

const repositoryRoot = join(import.meta.dirname, "..");
const stub = join(import.meta.dirname, "fixtures/runtime/old-node.mjs");
const template = join(
  repositoryRoot,
  "packages/runtime/src/boot/preflight.mjs",
);
const roots: string[] = [];

beforeAll(buildPlugin);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** Substitute the build's placeholders so the real template can be executed. */
async function materialize(): Promise<string> {
  const source = await readFile(template, "utf8");
  const root = await mkdtemp(join(tmpdir(), "kratos-preflight-"));
  roots.push(root);
  await mkdir(join(root, "runtime"), { recursive: true });
  const entry = join(root, "runtime/kratos.mjs");
  await writeFile(
    entry,
    source
      .replaceAll("__MINIMUM_NODE__", "24.0.0")
      .replaceAll(
        "__SUMMARY__",
        "The interpreter running the plugin runtime is older than the supported minimum.",
      )
      .replaceAll(
        "__RECOVERY__",
        "Install Node.js 24.0.0 or newer and run the command again.",
      )
      .replaceAll("__CORE__", "./kratos.core.mjs"),
    "utf8",
  );
  await writeFile(
    join(root, "runtime/kratos.core.mjs"),
    'process.stdout.write("core reached\\n");\n',
    "utf8",
  );
  return entry;
}

interface Execution {
  status: number;
  stdout: string;
  stderr: string;
}

function run(entry: string, version: string): Execution {
  try {
    const stdout = execFileSync(process.execPath, ["--import", stub, entry], {
      encoding: "utf8",
      env: { ...process.env, KRATOS_TEST_NODE_VERSION: version },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return {
      status: failure.status,
      stdout: failure.stdout,
      stderr: failure.stderr,
    };
  }
}

describe("runtime preflight", () => {
  it("reaches the core on a supported interpreter", async () => {
    const result = run(await materialize(), "24.18.0");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("core reached\n");
  });

  it.each(["24.0.0", "25.1.0", "24.18.7"])(
    "accepts interpreter %s",
    async (version) => {
      expect(run(await materialize(), version).stdout).toBe("core reached\n");
    },
  );

  it.each(["18.20.0", "23.11.0", "24.0.0-nightly"])(
    "rejects interpreter %s with a structured result",
    async (version) => {
      const entry = await materialize();
      const result = run(entry, version);

      expect(result.status).toBe(2);
      const rendered = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(rendered).toEqual({
        contractVersion: "1.0.0",
        status: "failure",
        exitCode: 2,
        reasonCode: "runtime.node_unsupported",
        summary:
          "The interpreter running the plugin runtime is older than the supported minimum.",
        why: ["The plugin runtime requires a newer Node.js interpreter."],
        evidence: [],
        stateChanged: false,
        retryable: false,
        recovery: "Install Node.js 24.0.0 or newer and run the command again.",
      });
    },
  );

  it("discloses neither the rejected version nor a local path", async () => {
    const entry = await materialize();
    const result = run(entry, "18.20.0");

    expect(result.stdout).not.toContain("18.20.0");
    expect(result.stdout).not.toContain(entry);
    expect(result.stdout).not.toContain(tmpdir());
    expect(result.stderr).toBe("");
  });

  it("rejects an old interpreter in the built artifact, not just the template", async () => {
    // The cases above exercise the template. This one runs the file that
    // actually ships, validated against the published result schema rather than
    // an inline literal that a schema change could silently orphan.
    const result = run(runtimeEntry(), "18.20.0");

    expect(result.status).toBe(2);
    const [schemaText, catalogText] = await Promise.all([
      readFile(join(repositoryRoot, "schemas/result.v1.schema.json"), "utf8"),
      readFile(
        join(
          repositoryRoot,
          "packages/contracts/catalogs/reason-codes.v1.2.json",
        ),
        "utf8",
      ),
    ]);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      JSON.parse(schemaText) as object,
    );
    const rendered = JSON.parse(result.stdout) as { reasonCode: string };

    expect(validate(rendered), JSON.stringify(validate.errors)).toBe(true);
    expect(rendered.reasonCode).toBe("runtime.node_unsupported");
    const reason = (
      JSON.parse(catalogText) as {
        reasons: { code: string; recovery: string }[];
      }
    ).reasons.find(({ code }) => code === "runtime.node_unsupported");
    expect(rendered).toMatchObject({ recovery: reason?.recovery });
  });

  it("reports a load failure without a stack trace", async () => {
    const entry = await materialize();
    await rm(join(entry, "../kratos.core.mjs"));
    const result = run(entry, "24.18.0");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("The Kratos runtime could not be loaded.\n");
    expect(result.stderr).not.toContain(" at ");
  });
});
