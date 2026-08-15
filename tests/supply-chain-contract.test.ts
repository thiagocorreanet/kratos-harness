import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");

async function read(relative: string): Promise<string> {
  return await readFile(join(repositoryRoot, relative), "utf8");
}

describe("the installer configuration", () => {
  it("keeps every setting that decides what an install may do", async () => {
    // These six lines are the whole supply-chain posture of an install, and
    // nothing asserted them: deleting the file changed no test while turning
    // exact pinning and script confinement off.
    expect(
      (await read(".npmrc"))
        .split("\n")
        .filter((line) => line.trim() !== "")
        .sort(),
    ).toEqual([
      "audit=false",
      "engine-strict=true",
      "fund=false",
      "package-lock=true",
      "save-exact=true",
      "strict-allow-scripts=true",
    ]);
  });

  it("names every package allowed to run an install script", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      readonly allowScripts?: Readonly<Record<string, boolean>>;
    };
    // An install script runs attacker-reachable code on every `npm ci`,
    // including one triggered by a fork pull request. The decisions are the
    // control, so they belong in a test rather than in a diff nobody reads.
    // Exactly one package is allowed to run one; the other is recorded as
    // refused so a later install cannot quietly promote it.
    expect(manifest.allowScripts).toEqual({
      "esbuild@0.28.1": true,
      "fsevents@2.3.3": false,
    });
  });
});

describe("the lockfile", () => {
  it("pins every third-party package to a digest", async () => {
    const lockfile = JSON.parse(await read("package-lock.json")) as {
      readonly lockfileVersion: number;
      readonly packages: Readonly<
        Record<
          string,
          {
            readonly resolved?: string;
            readonly integrity?: string;
            readonly link?: boolean;
          }
        >
      >;
    };
    expect(lockfile.lockfileVersion).toBe(3);
    const unpinned = Object.entries(lockfile.packages)
      .filter(([name, entry]) => {
        // The workspaces are this repository; only what npm fetches counts.
        if (name === "" || name.startsWith("packages/")) return false;
        if (entry.link === true) return false;
        return entry.resolved !== undefined && entry.integrity === undefined;
      })
      .map(([name]) => name);
    // A resolved entry with no integrity is a package npm will accept from
    // whatever the registry serves at install time.
    expect(unpinned).toEqual([]);
  });

  it("resolves every third-party package from one registry", async () => {
    const lockfile = JSON.parse(await read("package-lock.json")) as {
      readonly packages: Readonly<
        Record<string, { readonly resolved?: string; readonly link?: boolean }>
      >;
    };
    const foreign = Object.entries(lockfile.packages)
      .filter(([name, entry]) => {
        if (name === "" || name.startsWith("packages/")) return false;
        if (entry.link === true) return false;
        return (
          entry.resolved !== undefined &&
          !entry.resolved.startsWith("https://registry.npmjs.org/")
        );
      })
      .map(([name]) => name);
    // A git or tarball URL in the lockfile is a dependency nobody reviewed
    // arriving from somewhere the registry does not control.
    expect(foreign).toEqual([]);
  });
});

describe("the documentation workflow", () => {
  it("stays fork-safe and read-only", async () => {
    const raw = await read(".github/workflows/docs.yml");
    const workflow = parse(raw) as {
      readonly permissions?: unknown;
      readonly jobs: Readonly<
        Record<string, { readonly permissions?: unknown }>
      >;
    };
    // `ci.yml` has carried these assertions since it shipped; this workflow
    // runs third-party actions on fork pull requests and carried none, so an
    // edit adding write authority would have passed unnoticed.
    expect(raw).not.toContain("pull_request_target");
    expect(raw).not.toMatch(/\bsecrets\b/iu);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toBeUndefined();
    }
  });

  it("pins every action to a commit rather than a moving tag", async () => {
    const workflow = parse(await read(".github/workflows/docs.yml")) as {
      readonly jobs: Readonly<
        Record<
          string,
          { readonly steps: readonly { readonly uses?: string }[] }
        >
      >;
    };
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .map((step) => step.uses)
      .filter((value): value is string => value !== undefined);
    expect(uses).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "DavidAnson/markdownlint-cli2-action@21c1be1b93ad9ed58fa840aacc3f279cde2a72ff",
      "lycheeverse/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8",
    ]);
    for (const value of uses) {
      expect(value.split("@")[1]).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it("checks out without leaving a credential behind", async () => {
    const workflow = parse(await read(".github/workflows/docs.yml")) as {
      readonly jobs: Readonly<
        Record<
          string,
          { readonly steps: readonly { readonly with?: unknown }[] }
        >
      >;
    };
    const checkout = Object.values(workflow.jobs)[0]?.steps[0];
    expect(checkout?.with).toEqual({ "persist-credentials": false });
  });
});
