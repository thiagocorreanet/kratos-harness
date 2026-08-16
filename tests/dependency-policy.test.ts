import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";

const repositoryRoot = join(import.meta.dirname, "..");

/**
 * What a package the bundle carries may be licensed under.
 *
 * Every one of these permits redistribution in a modified, minified, combined
 * form and asks for nothing back but the notice — which is why
 * `runtime/THIRD-PARTY-NOTICES.txt` has to exist.
 */
const REDISTRIBUTED_LICENSES = [
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "Unlicense",
];

/**
 * What a package that only builds or tests this project may add to that.
 *
 * File-scoped and weak-copyleft terms are acceptable here because nothing in
 * this set reaches anything the project distributes.
 */
const DEVELOPMENT_LICENSES = [
  ...REDISTRIBUTED_LICENSES,
  "BlueOak-1.0.0",
  "CC-BY-SA-4.0",
  "MPL-2.0",
  "Python-2.0",
].sort();

/**
 * Declarations that name an allowed license without spelling it as SPDX does.
 *
 * Recorded one by one rather than normalized. A rule that rewrote whitespace
 * and case before comparing would also accept spellings nobody has looked at.
 */
const SPELLING_EXCEPTIONS: Readonly<Record<string, string>> = {
  "CC BY-SA 4.0": "CC-BY-SA-4.0",
};

async function read(relative: string): Promise<string> {
  return await readFile(join(repositoryRoot, relative), "utf8");
}

interface InstalledPackage {
  readonly name: string;
  readonly license: string;
}

/**
 * Every third-party package present in the installed tree.
 *
 * Symlinked entries are skipped, which is what leaves the four workspace
 * packages out: they are this repository, not a dependency of it.
 */
async function installedPackages(
  directory: string,
): Promise<readonly InstalledPackage[]> {
  const found: InstalledPackage[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      found.push(...(await installedPackages(child)));
      continue;
    }
    if (entry.name.startsWith(".")) continue;
    let manifest: { name?: unknown; license?: unknown };
    try {
      manifest = JSON.parse(
        await readFile(join(child, "package.json"), "utf8"),
      ) as { name?: unknown; license?: unknown };
    } catch {
      continue;
    }
    if (typeof manifest.name === "string") {
      found.push({
        name: manifest.name,
        license:
          typeof manifest.license === "string" ? manifest.license : "UNKNOWN",
      });
    }
    found.push(...(await installedPackages(join(child, "node_modules"))));
  }
  return found;
}

describe("the dependency-review configuration", () => {
  let configuration: Readonly<Record<string, unknown>>;

  beforeAll(async () => {
    configuration = parse(
      await read(".github/dependency-review-config.yml"),
    ) as Readonly<Record<string, unknown>>;
  });

  it("carries the license allowlist the policy document states", () => {
    expect(configuration["allow-licenses"]).toEqual(DEVELOPMENT_LICENSES);
    // Both lists are a decision about what may be introduced; only one of them
    // can be in force, and `deny-licenses` alongside an allowlist is rejected
    // by the action rather than merged with it.
    expect(configuration["deny-licenses"]).toBeUndefined();
  });

  it("refuses at the lowest severity the API reports, in every scope", () => {
    expect(configuration["fail-on-severity"]).toBe("low");
    expect(configuration["fail-on-scopes"]).toEqual([
      "development",
      "runtime",
      "unknown",
    ]);
    expect(configuration["license-check"]).toBe(true);
    expect(configuration["vulnerability-check"]).toBe(true);
  });

  it("cannot pass a finding through as a warning", () => {
    expect(configuration["warn-only"]).toBe(false);
    // `always` and `on-failure` both require `pull-requests: write`, which no
    // workflow in this repository has.
    expect(configuration["comment-summary-in-pr"]).toBe("never");
  });
});

describe("the dependency policy document", () => {
  let policy: string;

  beforeAll(async () => {
    policy = await read("docs/security/dependency-policy.md");
  });

  it("names every license the configuration allows", () => {
    for (const license of DEVELOPMENT_LICENSES) {
      expect(policy, license).toContain(`\`${license}\``);
    }
  });

  it("separates the redistributed list from the development one", () => {
    // The two lists differ, and the document has to say so; a policy that
    // stated one list would be permitting weak copyleft in the shipped bundle
    // by omission.
    for (const license of DEVELOPMENT_LICENSES.filter(
      (value) => !REDISTRIBUTED_LICENSES.includes(value),
    )) {
      expect(policy, license).toContain(license);
    }
    expect(policy).toContain("A redistributed package may carry only");
    expect(policy).toContain("A development-only package may additionally");
  });

  it("records each non-SPDX spelling it accepts", () => {
    for (const declared of Object.keys(SPELLING_EXCEPTIONS)) {
      expect(policy, declared).toContain(declared);
    }
  });
});

describe("the installed dependency tree", () => {
  let installed: readonly InstalledPackage[];

  beforeAll(async () => {
    installed = await installedPackages(join(repositoryRoot, "node_modules"));
  });

  it("was actually walked", () => {
    // Without this, a walk that returned nothing would satisfy every
    // assertion below by having nothing to refuse.
    expect(installed.length).toBeGreaterThan(200);
    expect(installed.map(({ name }) => name)).toContain("ajv");
    expect(installed.map(({ name }) => name)).not.toContain("@kratos/runtime");
  });

  it("carries no license outside the development allowlist", () => {
    const refused = installed
      .filter(
        ({ license }) =>
          !DEVELOPMENT_LICENSES.includes(license) &&
          !DEVELOPMENT_LICENSES.includes(SPELLING_EXCEPTIONS[license] ?? ""),
      )
      .map(({ name, license }) => `${name}: ${license}`);
    expect([...new Set(refused)].sort()).toEqual([]);
  });

  it("declares a license for every package", () => {
    const undeclared = installed
      .filter(({ license }) => license === "UNKNOWN")
      .map(({ name }) => name);
    // A package that declares nothing is refused rather than assumed
    // permissive, so it has to be absent, not merely unnoticed.
    expect([...new Set(undeclared)].sort()).toEqual([]);
  });
});

describe("the redistributed dependency set", () => {
  let notices: string;

  beforeAll(async () => {
    buildPlugin();
    notices = await readFile(
      join(hostPackage("codex"), "runtime/THIRD-PARTY-NOTICES.txt"),
      "utf8",
    );
  });

  it("ships no third-party runtime packages", async () => {
    for (const host of ["codex", "claude-code"] as const) {
      const entries = await readdir(hostPackage(host), { recursive: true });
      expect(entries.filter((entry) => entry.includes("node_modules"))).toEqual(
        [],
      );
    }
  });

  it("states the source-only runtime policy", () => {
    expect(notices).toContain(
      "This source-only build carries no third-party runtime code.",
    );
  });
});
