import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const workflowPath = join(repositoryRoot, ".github/workflows/ci.yml");

type JsonObject = Record<string, unknown>;

let rawWorkflow: string;
let workflow: JsonObject;

function object(value: unknown, context: string): JsonObject {
  expect(value, context).not.toBeNull();
  expect(Array.isArray(value), context).toBe(false);
  expect(typeof value, context).toBe("object");
  return value as JsonObject;
}

beforeAll(async () => {
  rawWorkflow = await readFile(workflowPath, "utf8");
  const document = parseDocument(rawWorkflow, {
    prettyErrors: true,
    uniqueKeys: true,
  });
  expect(document.errors).toEqual([]);
  expect(document.warnings).toEqual([]);
  workflow = object(document.toJS(), "workflow");
});

describe("pull-request CI workflow", () => {
  it("targets the two protected integration branches", () => {
    const triggers = object(workflow.on, "on");

    expect(Object.keys(triggers).sort()).toEqual([
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    expect(object(triggers.pull_request, "pull_request").branches).toEqual([
      "developer",
      "main",
    ]);
    expect(object(triggers.push, "push").branches).toEqual([
      "developer",
      "main",
    ]);
    expect(triggers.workflow_dispatch).toBeNull();
    expect(rawWorkflow).not.toContain("pull_request_target");
  });

  it("uses read-only, fork-safe authority", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(rawWorkflow).not.toMatch(/\bsecrets\b/iu);
    expect(rawWorkflow).not.toMatch(
      /\b(?:deploy|publish|pull-requests:\s*write|issues:\s*write)\b/iu,
    );

    const concurrency = object(workflow.concurrency, "concurrency");
    expect(concurrency.group).toBe(
      "ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}",
    );
    expect(concurrency["cancel-in-progress"]).toBe(
      "${{ github.event_name == 'pull_request' }}",
    );
  });

  it("pins a single bounded GitHub-hosted quality job", () => {
    const jobs = object(workflow.jobs, "jobs");
    expect(Object.keys(jobs)).toEqual(["quality"]);

    const quality = object(jobs.quality, "quality");
    expect(quality.name).toBe("Node quality and package");
    expect(quality["runs-on"]).toBe("ubuntu-latest");
    expect(quality["timeout-minutes"]).toBe(15);
    expect(quality.env).toEqual({ CI: "true" });
    expect(quality.permissions).toBeUndefined();
    expect(quality["continue-on-error"]).toBeUndefined();

    const steps = quality.steps as JsonObject[];
    expect(steps.every((step) => step["continue-on-error"] === undefined)).toBe(
      true,
    );
    expect(steps.map((step) => step.name)).toEqual([
      "Checkout",
      "Set up exact Node.js",
      "Prepare diagnostics",
      "Verify exact toolchain",
      "Install locked dependencies",
      "Check formatting",
      "Check spelling",
      "Lint",
      "Type-check",
      "Run unit tests",
      "Run coverage tests",
      "Validate GitHub template schemas",
      "Run differential self-tests",
      "Build bundle",
      "Verify package contents",
      "Upload failure diagnostics",
    ]);

    expect(steps.filter((step) => step.uses).map((step) => step.uses)).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    ]);
    expect(object(steps[0]?.with, "checkout.with")).toEqual({
      "persist-credentials": false,
    });
    expect(object(steps[1]?.with, "setup-node.with")).toEqual({
      "check-latest": false,
      "node-version-file": ".nvmrc",
      "package-manager-cache": false,
    });
  });

  it("runs the complete command graph with durable step logs", () => {
    const jobs = object(workflow.jobs, "jobs");
    const quality = object(jobs.quality, "quality");
    const steps = quality.steps as JsonObject[];
    const commandSteps = steps.slice(3, 15);
    const expectedCommands = [
      "node --version",
      "npm ci",
      "npm run format:check",
      "npm run spellcheck",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run test:coverage",
      "npm run templates:validate",
      "npm run differential:check",
      "npm run build",
      "npm run package:verify",
    ];

    for (const [index, step] of commandSteps.entries()) {
      const command = String(step.run);
      expect(command, String(step.name)).toContain("set -euo pipefail");
      expect(command, String(step.name)).toContain(expectedCommands[index]);
      expect(command, String(step.name)).toMatch(
        /2>&1\s*\|\s*tee \.ci-diagnostics\/[a-z-]+\.log/u,
      );
    }

    const toolchain = String(commandSteps[0]?.run);
    expect(toolchain).toContain('test "$node_version" = "v24.18.0"');
    expect(toolchain).toContain('test "$npm_version" = "11.16.0"');
  });

  it("uploads only short-lived diagnostics after failure", () => {
    const jobs = object(workflow.jobs, "jobs");
    const quality = object(jobs.quality, "quality");
    const steps = quality.steps as JsonObject[];
    const upload = steps.at(-1);
    expect(upload?.if).toBe(
      "${{ failure() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
    );

    expect(object(upload?.with, "upload.with")).toEqual({
      "compression-level": 6,
      "if-no-files-found": "ignore",
      "include-hidden-files": true,
      name: "ci-failure-${{ github.run_id }}-${{ github.run_attempt }}",
      path: ".ci-diagnostics/\ncoverage/\ndist/\n",
      "retention-days": 3,
    });
    expect(rawWorkflow).not.toMatch(/\.npm|npm-debug|environment/iu);
  });
});
