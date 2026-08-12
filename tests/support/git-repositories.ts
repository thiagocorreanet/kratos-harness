import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/**
 * The real-repository corpus the atomic observation is proven against.
 *
 * Each name is a distinct classified state from `packages/runtime/src/domain/git`
 * — one repository per state, built with real `git` invocations rather than
 * asserted from hand-written byte vectors. `symlink`, `submodule`,
 * `type-changed`, and `name-with-newline` depend on filesystem capabilities
 * that are not universal, which is why `createScenarioRepository` reports
 * rather than assumes them.
 */
export const SCENARIOS = [
  "not-a-repository",
  "unborn",
  "clean",
  "staged",
  "unstaged",
  "staged-and-unstaged",
  "deleted",
  "untracked",
  "ignored-file",
  "ignored-directory",
  "renamed",
  "copied",
  "type-changed",
  "symlink",
  "submodule",
  "detached",
  "branch-with-upstream",
  "linked-worktree",
  "merge-conflict",
  "rebase-conflict",
  "cherry-pick-conflict",
  "revert-conflict",
  "name-with-space",
  "name-with-newline",
  "name-with-unicode",
  "name-with-leading-dash",
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export interface Scenario {
  readonly root: string;
  /** `false` when the platform cannot express this state at all. */
  readonly available: boolean;
  /** Why it is unavailable. Present only when `available` is false. */
  readonly reason: string | null;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Process-level git helpers
// ---------------------------------------------------------------------------

// Applied to every setup invocation, not only commits: harmless for a read or
// a checkout, and it is what keeps repository construction independent of the
// developer's identity, signing configuration, and local-protocol policy.
const IDENTITY = [
  "-c",
  "user.email=t@e.com",
  "-c",
  "user.name=T",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "protocol.file.allow=always",
] as const;

/**
 * Neutralize the developer's global and system Git configuration for a setup
 * command, the same way `nodeGitRunner` neutralizes it for the observation
 * itself. Without this, a personal `init.defaultBranch`, `core.autocrlf`, or
 * `commit.gpgsign` could change what a scenario actually builds.
 */
function gitEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, ".yoda-scenario-absent-global-config"),
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

/** Run a setup command that is expected to succeed; throws on failure. */
function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd: root,
    env: gitEnv(root),
    encoding: "utf8",
  });
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  ) {
    const stderr = (error as { stderr: string }).stderr.trim();
    if (stderr.length > 0) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Run a command whose non-zero exit is the point: a deliberate conflict. */
function gitExpectingFailure(root: string, args: readonly string[]): void {
  try {
    execFileSync("git", [...IDENTITY, ...args], {
      cwd: root,
      env: gitEnv(root),
      stdio: "ignore",
    });
  } catch {
    // Expected: this command's job is to leave the repository conflicted.
  }
}

interface GitAttempt {
  readonly ok: boolean;
  readonly reason: string;
}

/** Run a command that may fail for reasons outside the scenario's control. */
function tryGit(root: string, args: readonly string[]): GitAttempt {
  try {
    execFileSync("git", [...IDENTITY, ...args], {
      cwd: root,
      env: gitEnv(root),
      encoding: "utf8",
    });
    return { ok: true, reason: "" };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Repository construction primitives
// ---------------------------------------------------------------------------

async function scratchDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function initRepositoryAt(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  git(root, ["init", "-q", "--initial-branch=main"]);
}

async function initRepository(prefix: string): Promise<string> {
  const root = await scratchDir(prefix);
  git(root, ["init", "-q", "--initial-branch=main"]);
  return root;
}

function stage(root: string, ...paths: readonly string[]): void {
  git(root, ["add", "--", ...paths]);
}

function commit(root: string, message = "i"): void {
  git(root, ["commit", "-q", "-m", message]);
}

function commitEmpty(root: string, message = "i"): void {
  git(root, ["commit", "-q", "-m", message, "--allow-empty"]);
}

function disposer(root: string): () => Promise<void> {
  return () => rm(root, { force: true, recursive: true });
}

function ok(root: string, dispose: () => Promise<void>): Scenario {
  return { root, available: true, reason: null, dispose };
}

function unavailable(
  root: string,
  reason: string,
  dispose: () => Promise<void>,
): Scenario {
  return { root, available: false, reason, dispose };
}

// Long enough, and similar enough across variants, for Git's default
// similarity heuristic to classify a rename or a copy rather than reporting
// an unrelated add and delete.
const LONG_TEXT =
  "This is a moderately long line of content, used so Git's similarity " +
  "heuristic has enough signal to detect a rename or a copy.\n" +
  "A second line pads the file further so a one-line diff does not look " +
  "like a rewrite instead of a move.\n";

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

async function notARepository(): Promise<Scenario> {
  const root = await scratchDir("yoda-git-not-a-repository-");
  return ok(root, disposer(root));
}

async function unbornScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-unborn-");
  return ok(root, disposer(root));
}

async function cleanScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-clean-");
  await writeFile(join(root, "a.txt"), "content\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  return ok(root, disposer(root));
}

async function stagedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-staged-");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  await writeFile(join(root, "b.txt"), "b\n", "utf8");
  stage(root, "b.txt");
  return ok(root, disposer(root));
}

async function unstagedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-unstaged-");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  await writeFile(join(root, "a.txt"), "a\nmodified\n", "utf8");
  return ok(root, disposer(root));
}

async function stagedAndUnstagedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-staged-and-unstaged-");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  await writeFile(join(root, "a.txt"), "a\nstaged\n", "utf8");
  stage(root, "a.txt");
  await writeFile(join(root, "a.txt"), "a\nstaged\nunstaged\n", "utf8");
  return ok(root, disposer(root));
}

async function deletedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-deleted-");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  await rm(join(root, "a.txt"));
  return ok(root, disposer(root));
}

async function untrackedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-untracked-");
  commitEmpty(root);
  await writeFile(join(root, "new.txt"), "new\n", "utf8");
  return ok(root, disposer(root));
}

async function ignoredFileScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-ignored-file-");
  await writeFile(join(root, ".gitignore"), "*.log\n", "utf8");
  stage(root, ".gitignore");
  commit(root);
  await writeFile(join(root, "debug.log"), "log\n", "utf8");
  return ok(root, disposer(root));
}

async function ignoredDirectoryScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-ignored-directory-");
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  stage(root, ".gitignore");
  commit(root);
  const pkg = join(root, "node_modules", "pkg");
  await mkdir(pkg, { recursive: true });
  await Promise.all(
    ["a.txt", "b.txt", "c.txt"].map((name) =>
      writeFile(join(pkg, name), name, "utf8"),
    ),
  );
  return ok(root, disposer(root));
}

async function renamedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-renamed-");
  await writeFile(join(root, "old.txt"), LONG_TEXT, "utf8");
  stage(root, "old.txt");
  commit(root);
  git(root, ["mv", "old.txt", "new.txt"]);
  return ok(root, disposer(root));
}

async function copiedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-copied-");
  // Copy detection in `git status` needs a config opt-in — see
  // `status.renames` — and, unlike rename detection, only ever considers a
  // file that is itself part of the diff as a possible copy source. That is
  // why `origin.txt` is also modified here rather than left untouched.
  git(root, ["config", "status.renames", "copies"]);
  await writeFile(join(root, "origin.txt"), LONG_TEXT, "utf8");
  stage(root, "origin.txt");
  commit(root);
  await writeFile(join(root, "copy.txt"), LONG_TEXT, "utf8");
  await writeFile(join(root, "origin.txt"), `${LONG_TEXT}adjusted\n`, "utf8");
  stage(root, "origin.txt", "copy.txt");
  return ok(root, disposer(root));
}

async function typeChangedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-type-changed-");
  await writeFile(join(root, "f.txt"), "hello\n", "utf8");
  stage(root, "f.txt");
  commit(root);
  await rm(join(root, "f.txt"));
  try {
    await symlink("target", join(root, "f.txt"));
  } catch (error) {
    return unavailable(
      root,
      `symlink() is not supported on this filesystem: ${errorMessage(error)}`,
      disposer(root),
    );
  }
  stage(root, "f.txt");
  return ok(root, disposer(root));
}

async function symlinkScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-symlink-");
  try {
    await symlink("original-target", join(root, "link.txt"));
  } catch (error) {
    return unavailable(
      root,
      `symlink() is not supported on this filesystem: ${errorMessage(error)}`,
      disposer(root),
    );
  }
  stage(root, "link.txt");
  commit(root);
  await rm(join(root, "link.txt"));
  await symlink("new-target", join(root, "link.txt"));
  return ok(root, disposer(root));
}

async function submoduleScenario(): Promise<Scenario> {
  const parent = await scratchDir("yoda-git-submodule-");
  const dispose = disposer(parent);

  const origin = join(parent, "sub-origin");
  await initRepositoryAt(origin);
  await writeFile(join(origin, "x.txt"), "x\n", "utf8");
  stage(origin, "x.txt");
  commit(origin);

  const root = join(parent, "repo");
  await initRepositoryAt(root);
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);

  const attempt = tryGit(root, [
    "submodule",
    "add",
    "-q",
    "../sub-origin",
    "vendor/sub",
  ]);
  if (!attempt.ok) {
    return unavailable(
      root,
      `git submodule add failed: ${attempt.reason}`,
      dispose,
    );
  }
  return ok(root, dispose);
}

async function detachedScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-detached-");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", sha]);
  return ok(root, disposer(root));
}

async function branchWithUpstreamScenario(): Promise<Scenario> {
  const parent = await scratchDir("yoda-git-branch-with-upstream-");
  const dispose = disposer(parent);

  const remote = join(parent, "remote.git");
  await mkdir(remote, { recursive: true });
  git(remote, ["init", "-q", "--bare", "--initial-branch=main"]);

  const root = join(parent, "work");
  await initRepositoryAt(root);
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  stage(root, "a.txt");
  commit(root);
  git(root, ["remote", "add", "origin", "../remote.git"]);
  git(root, ["push", "-q", "-u", "origin", "main"]);

  await writeFile(join(root, "b.txt"), "b\n", "utf8");
  stage(root, "b.txt");
  commit(root, "local-only");
  return ok(root, dispose);
}

async function linkedWorktreeScenario(): Promise<Scenario> {
  const parent = await scratchDir("yoda-git-linked-worktree-");
  const dispose = disposer(parent);

  const principal = join(parent, "principal");
  await initRepositoryAt(principal);
  await writeFile(join(principal, "a.txt"), "a\n", "utf8");
  stage(principal, "a.txt");
  commit(principal);

  const linked = join(parent, "linked");
  git(principal, ["worktree", "add", "-q", "-b", "feature", linked]);
  return ok(linked, dispose);
}

/** Two branches that edit the same line differently, ready to collide. */
async function divergentBranches(root: string): Promise<void> {
  await writeFile(join(root, "f.txt"), "base\n", "utf8");
  stage(root, "f.txt");
  commit(root, "base");
  git(root, ["checkout", "-q", "-b", "other"]);
  await writeFile(join(root, "f.txt"), "other change\n", "utf8");
  stage(root, "f.txt");
  commit(root, "other");
  git(root, ["checkout", "-q", "main"]);
  await writeFile(join(root, "f.txt"), "main change\n", "utf8");
  stage(root, "f.txt");
  commit(root, "main-change");
}

async function mergeConflictScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-merge-conflict-");
  await divergentBranches(root);
  gitExpectingFailure(root, ["merge", "-q", "other"]);
  return ok(root, disposer(root));
}

async function rebaseConflictScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-rebase-conflict-");
  await writeFile(join(root, "f.txt"), "base\n", "utf8");
  stage(root, "f.txt");
  commit(root, "base");
  git(root, ["checkout", "-q", "-b", "feature"]);
  await writeFile(join(root, "f.txt"), "feature change\n", "utf8");
  stage(root, "f.txt");
  commit(root, "feature-change");
  git(root, ["checkout", "-q", "main"]);
  await writeFile(join(root, "f.txt"), "main change\n", "utf8");
  stage(root, "f.txt");
  commit(root, "main-change");
  git(root, ["checkout", "-q", "feature"]);
  gitExpectingFailure(root, ["rebase", "main"]);
  return ok(root, disposer(root));
}

async function cherryPickConflictScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-cherry-pick-conflict-");
  await divergentBranches(root);
  const otherSha = git(root, ["rev-parse", "other"]).trim();
  gitExpectingFailure(root, ["cherry-pick", otherSha]);
  return ok(root, disposer(root));
}

async function revertConflictScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-revert-conflict-");
  await writeFile(join(root, "f.txt"), "base\n", "utf8");
  stage(root, "f.txt");
  commit(root, "base");
  await writeFile(join(root, "f.txt"), "changed\n", "utf8");
  stage(root, "f.txt");
  commit(root, "change");
  const changeSha = git(root, ["rev-parse", "HEAD"]).trim();
  await writeFile(join(root, "f.txt"), "further changed\n", "utf8");
  stage(root, "f.txt");
  commit(root, "further");
  gitExpectingFailure(root, ["revert", "--no-edit", changeSha]);
  return ok(root, disposer(root));
}

async function nameWithSpaceScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-name-with-space-");
  commitEmpty(root);
  await writeFile(join(root, "a file.txt"), "x\n", "utf8");
  return ok(root, disposer(root));
}

async function nameWithNewlineScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-name-with-newline-");
  commitEmpty(root);
  try {
    await writeFile(join(root, "line1\nline2.txt"), "x\n", "utf8");
  } catch (error) {
    return unavailable(
      root,
      `a filename containing a newline is not supported on this ` +
        `filesystem: ${errorMessage(error)}`,
      disposer(root),
    );
  }
  return ok(root, disposer(root));
}

async function nameWithUnicodeScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-name-with-unicode-");
  commitEmpty(root);
  await writeFile(join(root, "café-日本語.txt"), "x\n", "utf8");
  return ok(root, disposer(root));
}

async function nameWithLeadingDashScenario(): Promise<Scenario> {
  const root = await initRepository("yoda-git-name-with-leading-dash-");
  commitEmpty(root);
  await writeFile(join(root, "-dashfile.txt"), "x\n", "utf8");
  stage(root, "-dashfile.txt");
  return ok(root, disposer(root));
}

const BUILDERS: Record<ScenarioName, () => Promise<Scenario>> = {
  "not-a-repository": notARepository,
  unborn: unbornScenario,
  clean: cleanScenario,
  staged: stagedScenario,
  unstaged: unstagedScenario,
  "staged-and-unstaged": stagedAndUnstagedScenario,
  deleted: deletedScenario,
  untracked: untrackedScenario,
  "ignored-file": ignoredFileScenario,
  "ignored-directory": ignoredDirectoryScenario,
  renamed: renamedScenario,
  copied: copiedScenario,
  "type-changed": typeChangedScenario,
  symlink: symlinkScenario,
  submodule: submoduleScenario,
  detached: detachedScenario,
  "branch-with-upstream": branchWithUpstreamScenario,
  "linked-worktree": linkedWorktreeScenario,
  "merge-conflict": mergeConflictScenario,
  "rebase-conflict": rebaseConflictScenario,
  "cherry-pick-conflict": cherryPickConflictScenario,
  "revert-conflict": revertConflictScenario,
  "name-with-space": nameWithSpaceScenario,
  "name-with-newline": nameWithNewlineScenario,
  "name-with-unicode": nameWithUnicodeScenario,
  "name-with-leading-dash": nameWithLeadingDashScenario,
};

/** Build one named scenario as a real temporary Git repository. */
export function createScenarioRepository(
  name: ScenarioName,
): Promise<Scenario> {
  return BUILDERS[name]();
}

// ---------------------------------------------------------------------------
// Tree digesting
// ---------------------------------------------------------------------------

const NUL = Buffer.from([0]);

async function collectPaths(
  directory: string,
  results: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink() || entry.isFile()) {
      results.push(absolute);
      continue;
    }
    if (entry.isDirectory()) {
      await collectPaths(absolute, results);
    }
    // A socket, FIFO, or device node is not a shape a Git worktree produces,
    // so it is neither expected nor hashed.
  }
}

/**
 * SHA-256 over every file under `root`, including `.git`, in sorted path
 * order.
 *
 * Including `.git` is the point: an index refresh changes `.git/index` and
 * nothing else, so a digest that skipped it would let a mutating observation
 * pass. A symlink is hashed by its target text rather than followed, both
 * because a dangling target would otherwise throw and because the link
 * itself — not whatever it happens to resolve to — is the tree content.
 */
export async function digestTree(root: string): Promise<string> {
  const absolutePaths: string[] = [];
  await collectPaths(root, absolutePaths);
  const relativePaths = absolutePaths
    .map((absolute) => relative(root, absolute).split(sep).join("/"))
    .sort();

  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const absolute = join(root, relativePath);
    const info = await lstat(absolute);
    hash.update(Buffer.from(relativePath, "utf8"));
    hash.update(NUL);
    if (info.isSymbolicLink()) {
      hash.update(Buffer.from("symlink", "utf8"));
      hash.update(NUL);
      hash.update(Buffer.from(await readlink(absolute), "utf8"));
    } else {
      hash.update(Buffer.from("file", "utf8"));
      hash.update(NUL);
      hash.update(await readFile(absolute));
    }
    hash.update(NUL);
  }
  return hash.digest("hex");
}
