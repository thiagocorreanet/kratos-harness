import { spawnSync } from "node:child_process";

import { findViolations, parseCommits, remedyFor } from "./lib/dco.mjs";

const usageMessage = "expected --base <commit> --head <commit>";

class UsageError extends Error {}

function parseArguments(argv) {
  const allowed = new Set(["--base", "--head"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.startsWith("--")) {
      throw new UsageError(usageMessage);
    }
    values.set(flag, value);
  }
  const base = values.get("--base");
  const head = values.get("--head");
  if (base === undefined || head === undefined) {
    throw new UsageError(usageMessage);
  }
  return { base, head };
}

function git(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return result.stdout;
}

function main(argv) {
  const { base, head } = parseArguments(argv);
  // `%B` is the raw body, so a trailer is read exactly as written rather than
  // as git's own reflowed rendering of it.
  const stdout = git([
    "log",
    "-z",
    "--format=%H%x00%P%x00%B",
    `${base}..${head}`,
  ]);
  const commits = parseCommits(stdout);
  const violations = findViolations(commits);

  if (violations.length > 0) {
    process.stderr.write(`${remedyFor(violations)}\n`);
    process.exitCode = 1;
    return;
  }

  const checked = commits.filter((commit) => commit.parents.length <= 1).length;
  process.stdout.write(
    `DCO: ${String(checked)} commit${checked === 1 ? "" : "s"} signed off\n`,
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : ""}\n`);
    process.exitCode = 2;
  }
}
