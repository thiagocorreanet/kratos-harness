import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const files = {
  readme: "README.md",
  fixtures: "fixtures/README.md",
  schemas: "schemas/README.md",
  guide: "docs/compatibility/differential-harness.md",
  parity: "docs/compatibility/parity-inventory.md",
  contracts: "docs/compatibility/contract-versioning.md",
  toolchain: "docs/development/toolchain.md",
  workflow: ".github/workflows/ci.yml",
} as const;

let text: Record<keyof typeof files, string>;

beforeAll(async () => {
  text = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, path]) => [
        name,
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  ) as Record<keyof typeof files, string>;
});

describe("differential harness documentation", () => {
  it("publishes the public and authorized commands with exit semantics", () => {
    for (const required of [
      "npm run differential:check",
      "--class live",
      "--oracle",
      "--candidate",
      "Exit `0`",
      "Exit `1`",
      "Exit `2`",
      "no runnable scenario",
      "retained prefix",
      "post-normalization",
      "absent",
      "unreadable",
      "invalid",
      "self-test-normalized-state",
    ]) {
      expect(text.guide).toContain(required);
    }
    expect(text.readme).toContain("Go-to-TypeScript differential harness");
    expect(text.readme).toContain("Public self-test available");
    expect(text.toolchain).toContain("npm run differential:check");
  });

  it("documents isolation, redaction, and current live mismatch honestly", () => {
    for (const required of [
      "external temporary",
      "shell",
      "digest-only",
      "known mismatch",
      "live-version",
      "live-help",
    ]) {
      expect(text.guide).toContain(required);
    }
    expect(text.guide).toMatch(/opaque|single digest/u);
    expect(text.guide).toMatch(/does\s+not modify the source checkout/u);
    expect(text.parity).toContain("0 / 400 (0.00%)");
    expect(text.parity).toContain("differential harness");
  });

  it("keeps every PRD case planned and migration-only", () => {
    for (const required of [
      "sufficient context",
      "insufficient context",
      "needs_input",
      "blocking",
      "deferred",
      "5 Whys",
      "5W2H",
      "probable root cause",
      "invalid structured output",
      "lineage",
      "revision",
      "content-bound approval",
    ]) {
      expect(text.guide).toContain(required);
    }
    expect(text.contracts).toContain("`migration-only`");
    expect(text.contracts).toContain("12 planned PRD");
  });

  it("links schemas and fixtures and runs only the public self-test in CI", () => {
    expect(text.schemas).toContain("differential-scenario.v1.schema.json");
    expect(text.schemas).toContain("differential-observation.v1.schema.json");
    expect(text.fixtures).toContain("differential/v1");
    expect(text.workflow).toContain("npm run differential:check");
    expect(text.workflow).not.toContain(".betaup/bin/yoda");
    expect(text.workflow).not.toContain("secrets.");
  });
});
