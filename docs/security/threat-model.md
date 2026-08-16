# Threat Model

Issue [#52](https://github.com/thiagocorreanet/kratos-harness/issues/52)
(`QAL-04`) asks what this runtime is defended against. This document answers
that per threat, names the test that proves each answer, and states plainly
where a defense is partial or absent. A threat model that only lists strengths
is a marketing document; the gaps below are the part worth reading.

Reporting goes through [SECURITY.md](../../SECURITY.md). Nothing here is a
promise about a released version: no public release is supported yet.

## What this runtime touches

It reads a repository, writes managed state under `.brain/`, spawns `git`, and
hands text to a terminal. It also ships as a public plugin, so it receives fork
pull requests and packaged dependencies. Those four surfaces bound everything
below.

## Path traversal

Four independent gates refuse a path that leaves the managed surface: the shape
rule in the transaction domain, a pre-syscall check in the Node adapter, a
`realpath`-based confinement in the project filesystem port, and a reference
pattern in every schema that persists a path. Absolute paths, drive-qualified
paths, backslashes, `.` and `..` segments, empty segments, and control
characters are all refused, with `guard.outside_allow` where a caller supplied
the path.

Proven by `tests/managed-surface.test.ts`, `tests/transaction-normalization.test.ts`,
`tests/node-transaction-security.test.ts`, and `tests/contract-schemas.test.ts`.

**Partial.** `--root <path>` is not validated. That is deliberate — it names
your project, which may live anywhere — but it means the confinement begins at
the root the caller chose, not at a root the runtime vetted.

**Partial.** The active-feature pointer is a plain line of text whose contents
are interpolated into every path the objective command touches. The managed-path
rule catches a hostile pointer downstream, and
`tests/objective-adversarial.test.ts` proves nothing is written and nothing is
echoed. But most such pointers surface as `runtime.internal_failure`, which by
contract carries no evidence, so the caller is told something broke and not
which file to repair.

## Symlinks

The durable adapter captures the project root by device, inode, and `realpath`,
revalidates that identity before every operation, refuses a symlinked ancestor,
and opens every file with `O_NOFOLLOW`. A root swapped for a symlink mid-flight
is refused at three separate cut points.

Proven by the eighteen cases in `tests/node-transaction-security.test.ts`,
including the strongest one, which swaps a destination directory for a symlink
between the observation and the rename.

**Absent.** The project `FileSystem` port — used for `init --answers <path>` —
is not `O_NOFOLLOW` protected. It relies on `realpath` plus a containment
check, which is a check-then-use window. The hardened, tested path is the
durable filesystem.

**Absent.** `listGitDirectory` reads whatever directory `git rev-parse
--git-dir` reported, with no confinement to the project root. A `.git` file that
redirects to another directory makes the runtime list that directory.
It is read-only and names-only, and the result is matched against a five-entry
marker table, so the impact is a directory-existence oracle. Nothing defends
it.

## Command injection

Every process spawn in the shipped runtime passes an argument array, never a
string, and no code path sets `shell: true`. `tests/architecture.test.ts`
confines `child_process` to one module. The Git service is called only with two
frozen constant argument arrays; no caller text is interpolated into argv.

`tests/git-runner-hardening.test.ts` pins the fixed argument prefix
(`--no-optional-locks`, `--no-pager`, `-c core.quotepath=false`,
`-c status.renames=copies`) and the environment that neutralizes system and
global Git configuration. Before it, deleting `GIT_CONFIG_NOSYSTEM` changed no
test while changing what a gate would see.

## Malicious Git names and configuration

Path bytes are never decoded with loss: invalid UTF-8 becomes a digest rather
than a replacement character, so two distinct files cannot normalize to one
name. Ordering is by UTF-8 bytes rather than locale. The status parser fails
closed on any record it does not fully recognize, because a partial parse would
report a change set quietly missing entries.

Proven by `tests/git-paths.test.ts`, `tests/git-status-parser.test.ts`, and
`tests/git-scenarios.test.ts`, which observes real repositories holding names
with spaces, newlines, leading dashes, and undecodable bytes.

**Absent.** Branch, ref, and remote names are copied through unvalidated. This
is currently unreachable because no command consumes the Git service yet. The
first command that renders a branch name will meet the public-text validator,
which would turn a hostile name into an internal failure rather than a clean
refusal — that is the moment to add a bound, not later.

**Partial.** A repository's own `.git/config` is not neutralized. Only path
quoting and rename detection are pinned with `-c`, which outranks it.

## Schema bombs

The event store bounds a record at 64 KiB, a stream at 64 MiB, and a stream at
100 000 lines, checking the file size before reading it. Reference arrays are
capped at 256 on the sealing path. Canonicalization refuses a cycle. No
caller-supplied schema is ever compiled: the registry holds twelve embedded,
repo-owned schemas whose identities are pinned against the contract manifest.

Proven by `tests/event-chain.test.ts`, `tests/schema-catalog.test.ts`, and
`tests/schema-registry-integrity.test.ts`.

**Absent.** There is no JSON nesting-depth limit anywhere. Canonicalization,
data-shape inspection, and deep freezing all recurse without a bound. A deeply
nested persisted file produces a stack overflow, which the composition boundary
catches and reports as a sanitized failure — so it degrades safely, but it is
not a bound and no test asserts the behaviour.

**Absent.** Standard input is unbounded. The init answers document is read
whole into memory and parsed, and its schema declares no maximum length, item
count, or property count.

## Event tampering

Every event carries a digest over all of its own fields, chained to its
predecessor, and the persisted record must be byte-identical to its canonical
form — a re-ordered or re-spaced record is refused even when semantically
identical. The snapshot must equal the replayed state byte for byte. Ten
hand-edit cases are refused without writing anything and without echoing the
rejected bytes.

Proven by `tests/event-store-corruption.test.ts`, `tests/event-chain.test.ts`,
and `tests/event-sealing.test.ts`.

**By design, not a gap, but state it plainly.** This is integrity, not
authenticity. There is no signature and no external witness. Anyone who can
write to the run directory can recompute the whole chain and its snapshot. The
chain detects accidental and naive edits; it does not detect an attacker who
has the same write access the runtime has.

## Terminal injection

Every byte reaching a stream passes one validator, which refuses C0 controls,
DEL, and C1 controls. C1 matters because a terminal reading UTF-8 treats U+009B
as a control sequence introducer exactly as it treats `ESC [`, so refusing only
the seven-bit spelling would leave the same door open under a different name.
Any backslash is refused, so no JSON escape can smuggle one through a
structured payload.

Proven by `tests/result-validation.test.ts`, `tests/result-contract-rendering.test.ts`,
and `tests/cli-contracts.test.ts`, which drives hostile argv through both modes
and asserts neither stream carries it.

`scripts/lib/dco.mjs` renders a commit subject from an unreviewed fork branch
into a build log; control characters there are replaced and the subject is
length-bounded, proven by `tests/dco-log-safety.test.ts`.

**Absent.** Objective text is written to `objective.md` verbatim, and the
feature-state schema bounds its length but constrains no characters. It never
reaches a stream — the summary uses only the sanitized slug — but anyone who
prints that file gets whatever was recorded.

## Secrets and sensitive paths

The result contract refuses fourteen shapes in public text: URLs, absolute and
drive-qualified paths, any backslash, stack frames, Python tracebacks, GitHub
tokens, JWTs, PEM blocks, auth headers, cloud credential variables, and
credential assignments. Internal failures may carry only fixed catalog prose,
enforced by the validator rather than by convention. Evidence carries digests
and paths, never content.

Proven by `tests/result-contract-rendering.test.ts`, which includes
false-positive counter-tests so the rule cannot be tightened into uselessness,
and `tests/cli-composition.test.ts`.

**Say it accurately.** This is a denylist of shapes, not redaction. A bare
high-entropy string, a vendor key format nobody listed, or a base64 blob passes.
What the contract guarantees is that a leak of a *known* shape becomes a
contract violation rather than output.

**Partial.** The environment port can read any variable with no allowlist. No
production code calls it today.

## Untrusted contributions

Both workflows are `pull_request`, never `pull_request_target`. Permissions are
`contents: read` at the workflow level with no job override, no step references
a secret, every checkout sets `persist-credentials: false`, every action is
pinned to a commit, jobs are time-bounded, and failure artifacts are uploaded
only for same-repository runs.

`tests/ci-workflow-contract.test.ts` has always proven this for the CI
workflow. `tests/supply-chain-contract.test.ts` now proves it for the
documentation workflow, which runs two third-party actions on fork pull
requests and previously carried no assertions at all.

**Inherent.** A fork pull request runs `npm ci` and the full suite on a
GitHub-hosted runner with contributor-controlled code. The mitigations are the
read-only token, the absent secrets, and the timeout; the blast radius is the
ephemeral runner.

## Package substitution

Installs use `npm ci` against a lockfile in which every third-party package
carries an integrity digest and resolves from one registry, with exact saving
and script confinement configured. Exactly one dependency is allowed to run an
install script. The packaging verifier refuses symlinks in the staged tree,
requires the recorded core digest to match the built bytes, and refuses any
external import that is not a Node builtin.

`tests/supply-chain-contract.test.ts` pins the installer configuration, the
allowed-script decisions, and both lockfile properties — none of which had a
test, so deleting `.npmrc` changed nothing that CI would notice.
`tests/package-verifier.test.ts` and `tests/go-v3-oracle-verifier.test.ts` cover
the rest.

[The dependency policy](dependency-policy.md) states which licenses either
dependency set may carry and what happens when one of them turns out to be
vulnerable. `dependency-review.yml` enforces it on every pull request at
severity `low`, `codeql.yml` scans the sources on each protected-branch push
and weekly, and `dependabot.yml` proposes the updates exact pinning otherwise
prevents. `tests/dependency-policy.test.ts` holds the allowlists against the
installed tree and against the four packages the bundle actually carries;
`tests/supply-chain-contract.test.ts` holds every workflow to commit-pinned
actions, fork-safe triggers, and read-only authority everywhere except the one
job that uploads an analysis.

The bundler is configured with `legalComments: "none"`, so the notices that
MIT and BSD-3-Clause require were being stripped out of the artifact users
run. `scripts/build.mjs` now rebuilds them into
`runtime/THIRD-PARTY-NOTICES.txt`, and `scripts/verify-package.mjs` re-derives
the bundled set independently and refuses a staged plugin that attributes the
wrong packages.

**Absent.** No provenance or signature verification: the lockfile proves the
bytes did not change after publication, not who published them. CodeQL runs on
the push a merge produces rather than on the pull request, because a fork
cannot upload an analysis. Nothing scans the released bundle itself, and no
SBOM is published yet — that is `BET-02` (#59). Each of these is stated at
greater length in the dependency policy.

## What this document is not

It is not a penetration test, and no finding here came from one. It is a map of
what the code does, written from the code, so that the next person changing a
defense knows what it was for and which test will tell them they broke it.
