/**
 * Developer Certificate of Origin sign-off rules.
 *
 * The check is deliberately textual: it asserts that a commit message carries
 * a well-formed `Signed-off-by` trailer. It cannot and does not verify that
 * the name is real or the address reachable — the DCO is a certification by
 * the author, not something a CI job can prove.
 */

// The DCO requires a name and a reachable address. Requiring an `@` inside the
// angle brackets is what separates a real trailer from `Signed-off-by: me`,
// which certifies nothing and is the most common way to get this wrong.
const SIGN_OFF =
  /^Signed-off-by: *(?<name>[^<>\n]*\S) *<(?<email>[^<>\s@]+@[^<>\s]+)>[ \t]*$/mu;

/**
 * A commit's sign-off state.
 *
 * Merge commits are exempt. A merge produced by the forge has no author to
 * certify anything and cannot be signed after the fact, so requiring one would
 * fail every branch that merges its base — which is the normal way to update a
 * pull request.
 */
export function classifyCommit(commit) {
  if (commit.parents.length > 1) {
    return { hash: commit.hash, subject: commit.subject, state: "merge" };
  }
  const match = SIGN_OFF.exec(commit.message);
  if (match === null) {
    return { hash: commit.hash, subject: commit.subject, state: "unsigned" };
  }
  return {
    hash: commit.hash,
    subject: commit.subject,
    state: "signed",
    name: match.groups.name,
    email: match.groups.email,
  };
}

/** Every commit that must carry a sign-off and does not. */
export function findViolations(commits) {
  return commits
    .map((commit) => classifyCommit(commit))
    .filter((classified) => classified.state === "unsigned");
}

/**
 * Parse `git log -z --format=%H%x00%P%x00%B` output.
 *
 * Records are NUL-separated and so are the fields inside them, which keeps a
 * commit message containing blank lines or a stray delimiter from splitting a
 * record. Git never emits a NUL inside a hash, a parent list, or a message.
 */
export function parseCommits(stdout) {
  const fields = stdout.split("\0");
  const commits = [];
  // Each record is three fields; a trailing empty field from the final
  // separator is expected and stops the loop.
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const hash = fields[index].trim();
    if (hash === "") continue;
    const parents = fields[index + 1].trim();
    const message = fields[index + 2];
    commits.push({
      hash,
      parents: parents === "" ? [] : parents.split(" "),
      message,
      subject: message.split("\n", 1)[0],
    });
  }
  return commits;
}

/** The exact remedy, so a failing build does not send anyone hunting. */
export function remedyFor(violations) {
  const lines = [
    `${String(violations.length)} commit${violations.length === 1 ? "" : "s"} without a Developer Certificate of Origin sign-off:`,
    "",
  ];
  for (const violation of violations) {
    lines.push(`  ${violation.hash.slice(0, 12)} ${violation.subject}`);
  }
  lines.push(
    "",
    "Every commit must certify the DCO. See CONTRIBUTING.md.",
    "",
    "  git commit -s          # sign a new commit",
    "  git commit --amend -s  # sign the most recent one",
    "",
    "To sign a range that is already written:",
    "",
    "  git rebase --signoff <base>",
  );
  return lines.join("\n");
}
