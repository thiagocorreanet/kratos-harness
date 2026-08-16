import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");

async function read(relative: string): Promise<string> {
  return await readFile(join(repositoryRoot, relative), "utf8");
}

interface Workflow {
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly concurrency?: unknown;
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly name?: unknown;
        readonly permissions?: unknown;
        readonly "runs-on"?: unknown;
        readonly strategy?: {
          readonly matrix?: { readonly os?: readonly string[] };
        };
        readonly "timeout-minutes"?: unknown;
        readonly steps: readonly {
          readonly name?: unknown;
          readonly uses?: string;
          readonly with?: unknown;
        }[];
      }
    >
  >;
}

async function workflow(name: string): Promise<Workflow> {
  return parse(await read(`.github/workflows/${name}`)) as Workflow;
}

async function workflowNames(): Promise<readonly string[]> {
  return (await readdir(join(repositoryRoot, ".github/workflows"))).sort();
}

async function job(
  workflowName: string,
  jobName: string,
): Promise<Workflow["jobs"][string]> {
  const found = (await workflow(workflowName)).jobs[jobName];
  if (found === undefined) {
    throw new Error(`${workflowName} declares no job named ${jobName}`);
  }
  return found;
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
      "esbuild@0.28.2": true,
      "fsevents@2.3.3": false,
    });
  });

  it("approves an install script only at the version that is installed", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      readonly allowScripts: Readonly<Record<string, boolean>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    // The approval is keyed by version on purpose: a new release of a package
    // that runs an install script is new attacker-reachable code, and it is
    // approved again or not at all. That is also why a dependency update
    // cannot carry itself — #120 bumped `esbuild` and left this key behind,
    // and `npm ci` refused on `main` until a person re-approved it. Pinning
    // the pair here is what turns that into a failing test rather than a
    // failing install for everyone.
    for (const key of Object.keys(manifest.allowScripts)) {
      const separator = key.lastIndexOf("@");
      const name = key.slice(0, separator);
      const version = key.slice(separator + 1);
      const declared = manifest.devDependencies[name];
      if (declared === undefined) continue;
      expect(version, name).toBe(declared);
    }
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

describe("every workflow", () => {
  // Pinning, fork safety, and read-only authority were asserted per file,
  // which meant a new workflow inherited none of them. Asserting them over the
  // directory is what makes the next one arrive under the same rules.
  it("is one of the nine this repository publishes", async () => {
    expect(await workflowNames()).toEqual([
      "ci.yml",
      "codeql.yml",
      "compatibility.yml",
      "dependency-review.yml",
      "docs.yml",
      "nightly.yml",
      "platform.yml",
      "release.yml",
      "security.yml",
    ]);
  });

  it("pins every action to a commit rather than a moving tag", async () => {
    for (const name of await workflowNames()) {
      const uses = Object.values((await workflow(name)).jobs)
        .flatMap((job) => job.steps)
        .map((step) => step.uses)
        .filter((value): value is string => value !== undefined);
      expect(uses.length, name).toBeGreaterThan(0);
      for (const value of uses) {
        expect(value.split("@")[1], `${name}: ${value}`).toMatch(
          /^[0-9a-f]{40}$/u,
        );
      }
    }
  });

  it("never runs a fork's code with the base repository's authority", async () => {
    for (const name of await workflowNames()) {
      const raw = await read(`.github/workflows/${name}`);
      expect(raw, name).not.toContain("pull_request_target");
      expect(raw, name).not.toMatch(/\bsecrets\b/iu);
      expect((await workflow(name)).permissions, name).toEqual({
        contents: "read",
      });
    }
  });

  it("grants authority above read in exactly two places", async () => {
    const elevated: string[] = [];
    for (const name of await workflowNames()) {
      for (const [jobName, job] of Object.entries(
        (await workflow(name)).jobs,
      )) {
        if (job.permissions !== undefined) elevated.push(`${name}:${jobName}`);
      }
    }
    // Uploading an analysis and publishing an attested tagged release are the
    // only things this repository's automation does that a read-only token
    // cannot. Anything else appearing here is a workflow that acquired write
    // authority without being noticed.
    expect(elevated.sort()).toEqual([
      "codeql.yml:analyze",
      "release.yml:package",
    ]);
  });

  it("bounds every job in time on a GitHub-hosted runner", async () => {
    for (const name of await workflowNames()) {
      for (const [jobName, job] of Object.entries(
        (await workflow(name)).jobs,
      )) {
        expect(job["timeout-minutes"], `${name}:${jobName}`).toEqual(
          expect.any(Number),
        );
        // The native-platform jobs fan out over a matrix. Naming the hosts
        // here is what keeps that fan-out on GitHub-hosted runners instead of
        // a self-hosted label nobody audits.
        if (job["runs-on"] === "${{ matrix.os }}") {
          expect(job.strategy?.matrix?.os, `${name}:${jobName}`).toEqual([
            "ubuntu-latest",
            "macos-latest",
            "windows-latest",
          ]);
          continue;
        }
        expect(job["runs-on"], `${name}:${jobName}`).toBe("ubuntu-latest");
      }
    }
  });
});

describe("the code-scanning workflow", () => {
  it("scans the protected branches and a schedule, not pull requests", async () => {
    const triggers = (await workflow("codeql.yml")).on as Readonly<
      Record<string, unknown>
    >;
    // A fork pull request carries a read-only token and cannot upload an
    // analysis. Every change still reaches a protected branch through a push
    // this scans, and the schedule catches what a newer query pack finds in
    // code that has not changed.
    expect(Object.keys(triggers).sort()).toEqual([
      "push",
      "schedule",
      "workflow_dispatch",
    ]);
    expect((triggers.push as { branches: string[] }).branches).toEqual([
      "developer",
      "main",
    ]);
    expect(triggers.schedule).toEqual([{ cron: "17 5 * * 1" }]);
  });

  it("asks for the one permission it needs and no other", async () => {
    const analyze = await job("codeql.yml", "analyze");
    expect(analyze.permissions).toEqual({
      contents: "read",
      "security-events": "write",
    });
    expect(analyze["timeout-minutes"]).toBe(30);
  });

  it("never cancels a scan in favour of a newer one", async () => {
    // A cancelled scan leaves the branch showing the previous analysis, so
    // cancelling would quietly age the results rather than refresh them.
    expect((await workflow("codeql.yml")).concurrency).toEqual({
      group: "codeql-${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": false,
    });
  });

  it("analyses the sources rather than the build output", async () => {
    const { steps } = await job("codeql.yml", "analyze");
    expect(steps.map((step) => step.name)).toEqual([
      "Checkout",
      "Initialize CodeQL",
      "Analyze",
    ]);
    expect(steps[0]?.with).toEqual({ "persist-credentials": false });
    expect(steps[1]?.with).toEqual({
      languages: "javascript-typescript",
      "build-mode": "none",
      queries: "security-extended",
      config: "paths-ignore:\n  - coverage\n  - dist\n  - node_modules\n",
    });
    expect(steps[2]?.with).toEqual({
      category: "/language:javascript-typescript",
      // Defaults to true, which would publish a queryable database of the
      // sources as a side effect of asking for findings.
      "upload-database": false,
    });
  });
});

describe("the dependency-review workflow", () => {
  it("answers on the only event that has two revisions to diff", async () => {
    const triggers = (await workflow("dependency-review.yml")).on as Readonly<
      Record<string, unknown>
    >;
    expect(Object.keys(triggers)).toEqual(["pull_request"]);
    expect((triggers.pull_request as { branches: string[] }).branches).toEqual([
      "developer",
      "main",
    ]);
  });

  it("reads its thresholds from the file the policy document names", async () => {
    const { steps } = await job("dependency-review.yml", "review");
    expect(steps.map((step) => step.name)).toEqual([
      "Checkout",
      "Review dependency changes",
    ]);
    expect(steps[1]?.with).toEqual({
      "config-file": "./.github/dependency-review-config.yml",
    });
  });
});

describe("the dependency-update configuration", () => {
  it("proposes the updates exact pinning otherwise prevents", async () => {
    const configuration = parse(await read(".github/dependabot.yml")) as {
      readonly version: number;
      readonly updates: readonly {
        readonly "package-ecosystem": string;
        readonly schedule: { readonly interval: string };
        readonly labels: readonly string[];
        readonly "commit-message": { readonly prefix: string };
        readonly "open-pull-requests-limit": number;
      }[];
    };
    expect(configuration.version).toBe(2);
    expect(
      configuration.updates.map((update) => update["package-ecosystem"]),
    ).toEqual(["npm", "github-actions"]);
    for (const update of configuration.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update["open-pull-requests-limit"]).toBe(5);
      // Labels Dependabot cannot apply are labels the pull request arrives
      // without, so these are asserted against the repository's own set.
      for (const label of update.labels) {
        expect(
          ["area:quality", "type:ci", "type:maintenance"],
          label,
        ).toContain(label);
      }
      expect(["chore", "ci"]).toContain(update["commit-message"].prefix);
    }
  });

  it("keeps a breaking release out of every group", async () => {
    const configuration = parse(await read(".github/dependabot.yml")) as {
      readonly updates: readonly {
        readonly groups: Readonly<
          Record<string, { readonly "update-types"?: readonly string[] }>
        >;
      }[];
    };
    const groups = configuration.updates.flatMap((update) =>
      Object.entries(update.groups),
    );
    expect(groups.map(([name]) => name).sort()).toEqual([
      "actions",
      "lint",
      "test",
      "types",
    ]);
    // A group with no restriction carries a major silently, which is how
    // #119 arrived: `@types/node` 24 to 26, breaking, inside a routine
    // grouped bump. A major leaves the group and is reviewed on its own.
    for (const [name, group] of groups) {
      expect(group["update-types"], name).toEqual(["minor", "patch"]);
    }
  });
});
