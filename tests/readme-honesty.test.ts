import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

let readme: string;
let roadmap: string;
let packageManifest: { scripts: Record<string, string> };

beforeAll(async () => {
  const [readmeText, roadmapText, packageText] = await Promise.all([
    readFile(join(repositoryRoot, "README.md"), "utf8"),
    readFile(join(repositoryRoot, "ROADMAP.md"), "utf8"),
    readFile(join(repositoryRoot, "package.json"), "utf8"),
  ]);
  readme = readmeText;
  roadmap = roadmapText;
  packageManifest = JSON.parse(packageText) as {
    scripts: Record<string, string>;
  };
});

describe("README honesty", () => {
  it("shows only real status badges", () => {
    expect(readme).toContain(
      "actions/workflows/docs.yml/badge.svg?branch=main",
    );
    expect(readme).toContain("actions/workflows/docs.yml");
    expect(readme).toContain("actions/workflows/ci.yml/badge.svg?branch=main");
    expect(readme).toContain("actions/workflows/ci.yml");
  });

  it("makes current availability impossible to mistake", () => {
    expect(readme).toContain("There is no supported installation method");
    expect(readme).toContain("supports only `--help` and `--version`");
    expect(readme).toContain("not runnable in the current bundle");
    expect(readme).toContain("not ready for production");
    expect(readme).not.toMatch(
      /claude plugin install|codex plugin add|npm install -g/,
    );
  });

  it("shows only executable clean-checkout development commands", () => {
    const shellBlocks = [
      ...readme.matchAll(/```(?:bash|sh|console)\n([\s\S]*?)```/g),
    ];
    const commands = [
      "npm ci",
      "npm run spellcheck",
      "npm run verify",
      "npm run build",
      "npm run package:verify",
    ];
    expect(shellBlocks).toHaveLength(1);
    expect(shellBlocks[0]?.[1]?.trim().split("\n")).toEqual(commands);

    const documentedNpmCommands = new Set(
      readme.match(/npm (?:ci|run [a-z:-]+)/g) ?? [],
    );
    expect([...documentedNpmCommands].sort()).toEqual([...commands].sort());

    expect(packageManifest.scripts).toMatchObject({
      spellcheck: 'cspell --no-progress --show-suggestions "**/*.md"',
      build: "node scripts/build.mjs",
      "package:verify": "node scripts/verify-package.mjs",
      verify:
        "npm run format:check && npm run spellcheck && npm run lint && npm run typecheck && npm test && npm run test:coverage && npm run oracle:verify && npm run build && npm run package:verify",
    });
    expect(commands.indexOf("npm run build")).toBeLessThan(
      commands.indexOf("npm run package:verify"),
    );
    expect(readme).toContain("it requires the preceding build");
  });

  it("preserves the approved state and runtime boundaries", () => {
    expect(readme).toContain("No global Yoda binary");
    expect(readme).toContain("project-owned `.brain/`");
    expect(readme).toContain("`.claude/` and `.codex/`");
    expect(readme).toContain("embedded ESM runtime");
  });

  it("links every required public path", () => {
    for (const link of [
      "[Objective maturity gates](ROADMAP.md)",
      "[Contribution guide](CONTRIBUTING.md)",
      "[Security policy](SECURITY.md)",
      "[MIT License](LICENSE)",
    ]) {
      expect(readme).toContain(link);
    }
    expect(readme).toContain("## Acknowledgements");
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
