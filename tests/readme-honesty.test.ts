import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

let readme: string;
let roadmap: string;
let schemaRegistry: string;
let packageManifest: { scripts: Record<string, string> };

beforeAll(async () => {
  const [readmeText, roadmapText, schemaRegistryText, packageText] =
    await Promise.all([
      readFile(join(repositoryRoot, "README.md"), "utf8"),
      readFile(join(repositoryRoot, "ROADMAP.md"), "utf8"),
      readFile(
        join(repositoryRoot, "docs/architecture/schema-registry.md"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "package.json"), "utf8"),
    ]);
  readme = readmeText;
  roadmap = roadmapText;
  schemaRegistry = schemaRegistryText;
  packageManifest = JSON.parse(packageText) as {
    scripts: Record<string, string>;
  };
});

describe("schema registry documentation", () => {
  it("publishes exact ordering and production lifecycle rules", () => {
    expect(schemaRegistry).toContain("Unicode code point");
    expect(schemaRegistry).toContain("one production registry instance");
    expect(schemaRegistry).toContain("startup and project discovery");
    expect(schemaRegistry).toContain("accessor-backed");
  });
});

describe("README honesty", () => {
  it("does not advertise badges for a repository that has not been published", () => {
    expect(readme).not.toContain("badge.svg");
  });

  it("makes current availability impossible to mistake", () => {
    expect(readme).toContain("experimental development snapshot");
    expect(readme).toContain("not a production release");
    expect(readme).toContain("External validation remains incomplete");
    expect(readme).not.toMatch(
      /claude plugin install|codex plugin add|npm install -g/,
    );
  });

  it("shows only executable clean-checkout development commands", () => {
    const shellBlocks = [
      ...readme.matchAll(/```(?:bash|sh|console)\n([\s\S]*?)```/g),
    ];
    const commands = shellBlocks.flatMap(
      (block) => block[1]?.trim().split("\n") ?? [],
    );
    expect(commands).toEqual([
      "npm ci",
      "npm run verify",
      "npm run build",
      "npm run kratos -- help",
      "npm run package:verify",
    ]);

    const documentedNpmCommands = new Set(
      readme.match(/npm (?:ci|run [a-z:-]+)/g) ?? [],
    );
    expect([...documentedNpmCommands].sort()).toEqual(
      [
        "npm ci",
        "npm run build",
        "npm run kratos",
        "npm run package:verify",
        "npm run verify",
      ].sort(),
    );

    expect(packageManifest.scripts).toMatchObject({
      spellcheck:
        'cspell --gitignore-root . --no-progress --show-suggestions "**/*.md"',
      "parity:check": "node scripts/check-parity-inventory.mjs",
      "result:check": "node scripts/check-result-contract.mjs",
      "differential:check": "node scripts/run-differential.mjs",
      build: "node scripts/build.mjs",
      "package:verify": "node scripts/verify-package.mjs",
      verify:
        "npm run format:check && npm run spellcheck && npm run english:check && npm run lint && npm run typecheck && npm test && npm run test:coverage && npm run mutation:check && npm run performance:check && npm run oracle:verify && npm run parity:check && npm run result:check && npm run contracts:check && npm run differential:check && npm run build && npm run package:verify && npm run benchmark",
    });
    expect(commands.indexOf("npm run build")).toBeLessThan(
      commands.indexOf("npm run kratos -- help"),
    );
  });

  it("preserves the approved state and runtime boundaries", () => {
    expect(readme).toContain("project-owned `.brain/`");
    expect(readme).toContain("`.claude/` and `.codex/`");
    expect(readme).toContain("embedded ESM runtime");
    expect(readme).toContain("runtime/kratos.mjs");
    expect(readme).toContain("Node.js 24");
    expect(readme).toContain("atomic transaction boundaries");
  });

  it("publishes the schema validation boundary without overstating it", () => {
    expect(readme).toContain(
      "[schema registry contract](docs/architecture/schema-registry.md)",
    );
    expect(readme).toContain("embedded schemas");
    expect(readme).toContain("validation before domain use");
    expect(readme).toContain("canonical JSON");
  });

  it("separates implementation claims from external evidence", () => {
    expect(readme).toContain("implementation and evidence status");
    expect(readme).toContain("public-beta pilots");
    expect(readme).toContain("KRATOS_BACKLOG.md");
  });

  it("links every required public path", () => {
    for (const link of [
      "[maturity roadmap](ROADMAP.md)",
      "[contribution guide](CONTRIBUTING.md)",
      "[security policy](SECURITY.md)",
    ]) {
      expect(readme).toContain(link);
    }
    expect(readme).toContain("[LICENSE](LICENSE)");
  });
});

describe("objective maturity roadmap", () => {
  it.each(["Experimental", "Preview", "Beta", "Stable"])(
    "defines the %s stage",
    (stage) => {
      expect(roadmap).toContain(`## ${stage}`);
    },
  );

  it.each(["Preview", "Beta", "Stable"])("defines promotion to %s", (stage) => {
    expect(roadmap).toContain(`### Promotion to ${stage}`);
  });

  it("traces every delivery epic", () => {
    for (const issue of [1, 8, 15, 24, 34, 40, 48, 57]) {
      expect(roadmap).toContain(`/issues/${String(issue)}`);
    }
  });

  it("requires evidence, regression response, pilots, and oracle parity", () => {
    expect(roadmap).toContain("No calendar date or feature demo promotes");
    expect(roadmap).toContain("P0/P1 differential parity");
    expect(roadmap).toContain("pilot projects");
    expect(roadmap).toContain("Regression and rollback");
    expect(roadmap).toContain("Go predecessor retirement");
  });
});
