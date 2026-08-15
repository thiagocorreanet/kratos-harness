import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const requiredPolicyPaths = [
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "SECURITY.md",
  "SUPPORT.md",
  "DCO",
  ".github/CODEOWNERS",
] as const;

type PolicyPath = (typeof requiredPolicyPaths)[number];
type PolicyFiles = Record<PolicyPath, string>;

let policies: PolicyFiles;
let readme: string;

beforeAll(async () => {
  const contents = await Promise.all(
    requiredPolicyPaths.map(async (path) => [
      path,
      await readFile(join(repositoryRoot, path), "utf8"),
    ]),
  );
  policies = Object.fromEntries(contents) as PolicyFiles;
  readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
});

describe("community health policies", () => {
  it("keeps every required repository policy", () => {
    for (const path of requiredPolicyPaths) {
      expect(policies[path].trim().length, path).toBeGreaterThan(0);
    }
  });

  it("makes every community path discoverable from README", () => {
    expect(readme).toContain("[Contribution guide](CONTRIBUTING.md)");
    expect(readme).toContain("[Code of Conduct](CODE_OF_CONDUCT.md)");
    expect(readme).toContain("[Governance](GOVERNANCE.md)");
    expect(readme).toContain("[Support policy](SUPPORT.md)");
    expect(readme).toContain("[Security policy](SECURITY.md)");
  });

  it("requires DCO sign-off and intellectual-property provenance", () => {
    const contributing = policies["CONTRIBUTING.md"];

    expect(contributing).toContain("git commit -s");
    expect(contributing).toContain(
      "Signed-off-by: Your Name <your.email@example.com>",
    );
    expect(contributing).toContain(
      "Intellectual-property provenance checklist",
    );
    expect(contributing).toContain("behavioral clean-room");
    expect(contributing).toContain("Unclear provenance blocks merge");
    expect(policies.DCO).toContain("Developer's Certificate of Origin 1.1");
  });

  it("defines a confidential vulnerability path and support boundary", () => {
    const security = policies["SECURITY.md"];

    expect(security).toContain("Report a vulnerability");
    expect(security).toContain("Do not open a public issue");
    expect(security).toContain("| `main` | Yes |");
    expect(security).toContain("within 3 business days");
    expect(policies["SUPPORT.md"]).toContain("no production support SLA");
  });

  it("adopts attributed conduct rules and explicit governance", () => {
    expect(policies["CODE_OF_CONDUCT.md"]).toContain(
      "based on GitHub's bundled Contributor Covenant template",
    );
    expect(policies["CODE_OF_CONDUCT.md"]).toContain("version 2.0");
    expect(policies["CODE_OF_CONDUCT.md"]).toMatch(
      /do not use the repository private\s+reporting form/,
    );
    expect(policies["GOVERNANCE.md"]).toContain(
      "Project Lead: `@thiagocorreanet`",
    );
  });

  it("protects repository ownership", () => {
    const codeowners = policies[".github/CODEOWNERS"];

    expect(codeowners).toContain("* @thiagocorreanet");
    expect(codeowners).toContain("/.github/ @thiagocorreanet");
    expect(codeowners).toContain("/SECURITY.md @thiagocorreanet");
  });

  it("contains no unfilled policy templates", () => {
    const unfinishedMarkers = [
      "T" + "BD",
      "TO" + "DO",
      "[" + "INSERT",
      "[" + "NOTE",
    ];

    for (const path of requiredPolicyPaths) {
      for (const marker of unfinishedMarkers) {
        expect(policies[path], `${path} contains ${marker}`).not.toContain(
          marker,
        );
      }
    }
  });
});
