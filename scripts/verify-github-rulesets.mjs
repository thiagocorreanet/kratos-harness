import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const args = process.argv.slice(2);
const repositoryIndex = args.indexOf("--repository");
const repository = args[repositoryIndex + 1];
if (
  repositoryIndex < 0 ||
  repository === undefined ||
  !repository.includes("/")
) {
  console.error("usage: verify-github-rulesets --repository OWNER/REPOSITORY");
  process.exitCode = 2;
} else {
  const expected = JSON.parse(
    await readFile(join(root, "quality/github-rulesets.expected.json"), "utf8"),
  );
  const actual = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${repository}/rulesets?includes_parents=false`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  const serialized = JSON.stringify(actual);
  const missing = [];
  for (const [branch, policy] of Object.entries(expected.branches)) {
    if (!serialized.includes(branch)) missing.push(`${branch}: ruleset`);
    for (const check of policy.requiredChecks) {
      if (!serialized.includes(check)) missing.push(`${branch}: ${check}`);
    }
  }
  if (missing.length > 0) {
    console.error(`GitHub ruleset verification failed: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("GitHub ruleset verification passed");
  }
}
