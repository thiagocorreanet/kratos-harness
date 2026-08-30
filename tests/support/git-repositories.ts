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
import { join, sep } from "node:path";

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
  "delete-modify-conflict",
  "name-with-space",
  "name-with-newline",
  "name-with-unicode",
  "name-with-leading-dash",
  "name-with-undecodable-bytes",
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

export interface NestedProjectRepository {
  readonly repositoryRoot: string;
  readonly projectRoot: string;
  commitAll(message?: string): void;
  dispose(): Promise<void>;
}

export type RootProjectRepository = NestedProjectRepository;

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
    GIT_CONFIG_GLOBAL: join(root, ".kratos-scenario-absent-global-config"),
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

/**
 * The same guarantee `withScenarioRoot` gives a single-repository scenario,
 * for one that spans more than one repository under a shared parent
 * directory (`submodule`, `branch-with-upstream`, `linked-worktree`).
 *
 * `dispose()` only exists once a builder returns a `Scenario`, so a step
 * that throws partway through construction — a `git()` call failing for a
 * reason outside the capability-guarded scenarios, say — would otherwise
 * leave an orphaned directory with nothing able to remove it. This runs
 * `steps` and, if it throws, removes `directory` before letting the original
 * error — message, stack, everything — escape unchanged.
 */
async function withCleanup<T>(
  directory: string,
  steps: () => Promise<T>,
): Promise<T> {
  try {
    return await steps();
  } catch (error) {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch {
      // A cleanup failure must not replace the error that caused it. The
      // directory leaks in that case, which is strictly better than losing
      // the diagnosis.
    }
    throw error;
  }
}

/**
 * Create a fresh temporary repository and run a scenario's setup steps in
 * it, guaranteeing the directory does not survive a setup failure — see
 * `withCleanup`, which this is a single-repository specialization of.
 */
async function withScenarioRoot(
  prefix: string,
  steps: (root: string) => Promise<Scenario>,
): Promise<Scenario> {
  const root = await scratchDir(prefix);
  return withCleanup(root, () => {
    git(root, ["init", "-q", "--initial-branch=main"]);
    return steps(root);
  });
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
  const root = await scratchDir("kratos-git-not-a-repository-");
  return ok(root, disposer(root));
}

function unbornScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-unborn-", (root) =>
    Promise.resolve(ok(root, disposer(root))),
  );
}

function cleanScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-clean-", async (root) => {
    await writeFile(join(root, "a.txt"), "content\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    return ok(root, disposer(root));
  });
}

function stagedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-staged-", async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    await writeFile(join(root, "b.txt"), "b\n", "utf8");
    stage(root, "b.txt");
    return ok(root, disposer(root));
  });
}

function unstagedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-unstaged-", async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    await writeFile(join(root, "a.txt"), "a\nmodified\n", "utf8");
    return ok(root, disposer(root));
  });
}

function stagedAndUnstagedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-staged-and-unstaged-", async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    await writeFile(join(root, "a.txt"), "a\nstaged\n", "utf8");
    stage(root, "a.txt");
    await writeFile(join(root, "a.txt"), "a\nstaged\nunstaged\n", "utf8");
    return ok(root, disposer(root));
  });
}

function deletedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-deleted-", async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    await rm(join(root, "a.txt"));
    return ok(root, disposer(root));
  });
}

function untrackedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-untracked-", async (root) => {
    commitEmpty(root);
    await writeFile(join(root, "new.txt"), "new\n", "utf8");
    return ok(root, disposer(root));
  });
}

function ignoredFileScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-ignored-file-", async (root) => {
    await writeFile(join(root, ".gitignore"), "*.log\n", "utf8");
    stage(root, ".gitignore");
    commit(root);
    await writeFile(join(root, "debug.log"), "log\n", "utf8");
    return ok(root, disposer(root));
  });
}

function ignoredDirectoryScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-ignored-directory-", async (root) => {
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
  });
}

function renamedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-renamed-", async (root) => {
    await writeFile(join(root, "old.txt"), LONG_TEXT, "utf8");
    stage(root, "old.txt");
    commit(root);
    git(root, ["mv", "old.txt", "new.txt"]);
    return ok(root, disposer(root));
  });
}

function copiedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-copied-", async (root) => {
    // Copy detection in `git status` needs a config opt-in — `status.renames
    // = copies` — which `nodeGitRunner` now pins in its fixed argv prefix, so
    // no local config is set here; the pin is what makes this scenario work.
    // Unlike rename detection, copy detection only ever considers a file
    // that is itself part of the diff as a possible copy source, which is
    // why `origin.txt` is also modified here rather than left untouched.
    await writeFile(join(root, "origin.txt"), LONG_TEXT, "utf8");
    stage(root, "origin.txt");
    commit(root);
    await writeFile(join(root, "copy.txt"), LONG_TEXT, "utf8");
    await writeFile(join(root, "origin.txt"), `${LONG_TEXT}adjusted\n`, "utf8");
    stage(root, "origin.txt", "copy.txt");
    return ok(root, disposer(root));
  });
}

function typeChangedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-type-changed-", async (root) => {
    await writeFile(join(root, "f.txt"), "hello\n", "utf8");
    stage(root, "f.txt");
    commit(root);
    await rm(join(root, "f.txt"));
    try {
      await symlink("target", join(root, "f.txt"));
    } catch (error) {
      // Not a bug to fail loudly on: a missing symlink capability is a
      // platform fact to report via `dispose()` from a valid `Scenario`,
      // which is why this is caught here rather than left to `withCleanup`.
      return unavailable(
        root,
        `symlink() is not supported on this filesystem: ${errorMessage(error)}`,
        disposer(root),
      );
    }
    stage(root, "f.txt");
    return ok(root, disposer(root));
  });
}

function symlinkScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-symlink-", async (root) => {
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
  });
}

async function submoduleScenario(): Promise<Scenario> {
  const parent = await scratchDir("kratos-git-submodule-");
  return withCleanup(parent, async () => {
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

    // `tryGit` never throws — a failed `submodule add` is a platform fact
    // reported through `unavailable`, not a bug `withCleanup` needs to see.
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
  });
}

function detachedScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-detached-", async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    stage(root, "a.txt");
    commit(root);
    const sha = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["checkout", "-q", sha]);
    return ok(root, disposer(root));
  });
}

async function branchWithUpstreamScenario(): Promise<Scenario> {
  const parent = await scratchDir("kratos-git-branch-with-upstream-");
  return withCleanup(parent, async () => {
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
  });
}

async function linkedWorktreeScenario(): Promise<Scenario> {
  const parent = await scratchDir("kratos-git-linked-worktree-");
  return withCleanup(parent, async () => {
    const dispose = disposer(parent);

    const principal = join(parent, "principal");
    await initRepositoryAt(principal);
    await writeFile(join(principal, "a.txt"), "a\n", "utf8");
    stage(principal, "a.txt");
    commit(principal);

    const linked = join(parent, "linked");
    git(principal, ["worktree", "add", "-q", "-b", "feature", linked]);
    return ok(linked, dispose);
  });
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

function mergeConflictScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-merge-conflict-", async (root) => {
    await divergentBranches(root);
    gitExpectingFailure(root, ["merge", "-q", "other"]);
    return ok(root, disposer(root));
  });
}

function rebaseConflictScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-rebase-conflict-", async (root) => {
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
  });
}

function cherryPickConflictScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-cherry-pick-conflict-", async (root) => {
    await divergentBranches(root);
    const otherSha = git(root, ["rev-parse", "other"]).trim();
    gitExpectingFailure(root, ["cherry-pick", otherSha]);
    return ok(root, disposer(root));
  });
}

function revertConflictScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-revert-conflict-", async (root) => {
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
  });
}

/**
 * An asymmetric conflict: one side modifies, the other deletes. This is what
 * proves `ours`/`theirs` are read independently rather than both defaulting
 * to `true` — the shape every symmetric (both-sides-modified) conflict
 * scenario shares, which is exactly what let that bug through review.
 */
function deleteModifyConflictScenario(): Promise<Scenario> {
  return withScenarioRoot(
    "kratos-git-delete-modify-conflict-",
    async (root) => {
      await writeFile(join(root, "f.txt"), "base\n", "utf8");
      stage(root, "f.txt");
      commit(root, "base");
      git(root, ["checkout", "-q", "-b", "other"]);
      git(root, ["rm", "-q", "f.txt"]);
      commit(root, "delete-f");
      git(root, ["checkout", "-q", "main"]);
      await writeFile(join(root, "f.txt"), "main change\n", "utf8");
      stage(root, "f.txt");
      commit(root, "modify-f");
      gitExpectingFailure(root, ["merge", "-q", "other"]);
      return ok(root, disposer(root));
    },
  );
}

function nameWithSpaceScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-name-with-space-", async (root) => {
    commitEmpty(root);
    await writeFile(join(root, "a file.txt"), "x\n", "utf8");
    return ok(root, disposer(root));
  });
}

function nameWithNewlineScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-name-with-newline-", async (root) => {
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
  });
}

function nameWithUnicodeScenario(): Promise<Scenario> {
  return withScenarioRoot("kratos-git-name-with-unicode-", async (root) => {
    commitEmpty(root);
    await writeFile(join(root, "café-日本語.txt"), "x\n", "utf8");
    return ok(root, disposer(root));
  });
}

function nameWithLeadingDashScenario(): Promise<Scenario> {
  return withScenarioRoot(
    "kratos-git-name-with-leading-dash-",
    async (root) => {
      commitEmpty(root);
      await writeFile(join(root, "-dashfile.txt"), "x\n", "utf8");
      stage(root, "-dashfile.txt");
      return ok(root, disposer(root));
    },
  );
}

/**
 * Raw bytes forming a filename that is not valid UTF-8 anywhere in it: 0xff
 * can never begin or continue a UTF-8 byte sequence. Exported so the
 * scenario corpus test can compute the same digest `decodeGitPath` will.
 */
export const UNDECODABLE_NAME_BYTES = Uint8Array.from([
  0x61, 0xff, 0x62, 0x2e, 0x74, 0x78, 0x74,
]);

function nameWithUndecodableBytesScenario(): Promise<Scenario> {
  return withScenarioRoot(
    "kratos-git-name-with-undecodable-bytes-",
    async (root) => {
      commitEmpty(root);
      // `fs` accepts a `Buffer` path and writes exactly the bytes given,
      // bypassing the string encoding a JS path would otherwise force this
      // name through. Git itself never needs this name as a command
      // argument: `add -A` discovers the file by scanning the working tree,
      // so no argv element ever has to carry the raw bytes.
      const target = Buffer.concat([
        Buffer.from(`${root}/`, "utf8"),
        Buffer.from(UNDECODABLE_NAME_BYTES),
      ]);
      try {
        await writeFile(target, "x\n", "utf8");
      } catch (error) {
        return unavailable(
          root,
          `a filename with invalid UTF-8 bytes is not supported on this ` +
            `filesystem: ${errorMessage(error)}`,
          disposer(root),
        );
      }
      // Staged, not left untracked: this is what routes the path through
      // status.ts's "1 "/"2 " record parsing, where the path offset is a
      // character count over decoded text reused as a byte offset into the
      // raw buffer — the parser's most delicate line, otherwise proven only
      // by feeding synthetic bytes directly to `decodeGitPath`.
      git(root, ["add", "-A"]);
      return ok(root, disposer(root));
    },
  );
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
  "delete-modify-conflict": deleteModifyConflictScenario,
  "name-with-space": nameWithSpaceScenario,
  "name-with-newline": nameWithNewlineScenario,
  "name-with-unicode": nameWithUnicodeScenario,
  "name-with-leading-dash": nameWithLeadingDashScenario,
  "name-with-undecodable-bytes": nameWithUndecodableBytesScenario,
};

/** Build one named scenario as a real temporary Git repository. */
export function createScenarioRepository(
  name: ScenarioName,
): Promise<Scenario> {
  return BUILDERS[name]();
}

/** Build a real repository whose selected project is the `app` child. */
export async function createNestedProjectRepository(): Promise<NestedProjectRepository> {
  const repositoryRoot = await scratchDir("kratos-git-nested-project-");
  return withCleanup(repositoryRoot, async () => {
    await initRepositoryAt(repositoryRoot);
    const projectRoot = join(repositoryRoot, "app");
    await mkdir(projectRoot);
    commitEmpty(repositoryRoot, "initial");
    return {
      repositoryRoot,
      projectRoot,
      commitAll: (message = "project state") => {
        git(repositoryRoot, ["add", "-A"]);
        commit(repositoryRoot, message);
      },
      dispose: disposer(repositoryRoot),
    };
  });
}

/** Build a real repository whose selected project is the worktree root. */
export async function createRootProjectRepository(): Promise<RootProjectRepository> {
  const repositoryRoot = await scratchDir("kratos-git-root-project-");
  return withCleanup(repositoryRoot, async () => {
    await initRepositoryAt(repositoryRoot);
    commitEmpty(repositoryRoot, "initial");
    return {
      repositoryRoot,
      projectRoot: repositoryRoot,
      commitAll: (message = "project state") => {
        git(repositoryRoot, ["add", "-A"]);
        commit(repositoryRoot, message);
      },
      dispose: disposer(repositoryRoot),
    };
  });
}

// ---------------------------------------------------------------------------
// Tree digesting
// ---------------------------------------------------------------------------

const NUL = Buffer.from([0]);
const SEP = Buffer.from(sep);

// Directory entries are collected and hashed as raw `Buffer` paths, not
// strings. A filename is not required to be valid UTF-8 (see the
// `name-with-undecodable-bytes` scenario), and Node's default string decoding
// of `readdir` is lossy for such a name — it replaces the invalid bytes with
// U+FFFD, and that lossy string does not round-trip back to the real path, so
// a later `readFile`/`readlink` built from it throws ENOENT. `encoding:
// "buffer"` sidesteps the round trip entirely.
async function collectPaths(
  directory: Buffer,
  results: Buffer[],
): Promise<void> {
  const entries = await readdir(directory, {
    withFileTypes: true,
    encoding: "buffer",
  });
  for (const entry of entries) {
    const absolute = Buffer.concat([directory, SEP, entry.name]);
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
  const rootBuffer = Buffer.from(root, "utf8");
  const absolutePaths: Buffer[] = [];
  await collectPaths(rootBuffer, absolutePaths);
  const relativePaths = absolutePaths
    .map((absolute) => absolute.subarray(rootBuffer.length + SEP.length))
    .sort((left, right) => Buffer.compare(left, right));

  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const absolute = Buffer.concat([rootBuffer, SEP, relativePath]);
    const info = await lstat(absolute);
    hash.update(relativePath);
    hash.update(NUL);
    if (info.isSymbolicLink()) {
      hash.update(Buffer.from("symlink", "utf8"));
      hash.update(NUL);
      hash.update(await readlink(absolute, { encoding: "buffer" }));
    } else {
      hash.update(Buffer.from("file", "utf8"));
      hash.update(NUL);
      hash.update(await readFile(absolute));
    }
    hash.update(NUL);
  }
  return hash.digest("hex");
}
