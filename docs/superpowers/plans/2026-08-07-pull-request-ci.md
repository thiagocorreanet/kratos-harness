# Pull-request CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect pull requests to `developer` and `main` with a least-privilege, deterministic CI workflow that reports useful short-lived diagnostics and demonstrably blocks invalid lint, types, tests, and package contents.

**Architecture:** One sequential GitHub-hosted job installs the pinned npm lockfile once and runs every existing repository quality command in dependency order. A Vitest contract test treats the workflow as configuration code, while a disposable pull request proves the four required failure paths and the final green path on GitHub.

**Tech Stack:** GitHub Actions, Node.js 24.18.0, npm 11.16.0, YAML 2.9.0, Vitest 4.1.10, actionlint 1.7.12.

## Global Constraints

- Trigger only on pull requests and pushes targeting `developer` or `main`, plus manual dispatch.
- Use `pull_request`, never `pull_request_target`; reference no secrets and grant only `contents: read`.
- Pin every third-party action to an immutable full commit SHA with a release comment.
- Cancel superseded pull-request runs but give every branch push a unique concurrency group so pending pushes are also preserved.
- Run on `ubuntu-latest`, cap the job at 15 minutes, and retain failure diagnostics for three days.
- Install with `npm ci` and verify the exact Node.js and npm versions before quality checks.
- Keep issue #7 open until GitHub-hosted success and deliberate-failure evidence exists.

---

### Task 1: Specify the workflow as an executable contract

**Files:**

- Create: `tests/ci-workflow-contract.test.ts`

**Interfaces:**

- Consumes: `.github/workflows/ci.yml`, `package.json`, and the approved CI design.
- Produces: deterministic assertions for triggers, permissions, concurrency, runner, timeouts, pinned actions, command order, diagnostics, and fork-safe exclusions.

- [x] **Step 1: Write the workflow contract test**

Parse the workflow with the pinned `yaml` package. Assert exact protected branches,
read-only permissions without job overrides, pull-request-only cancellation,
unique branch-push groups, no ignored failures, one `ubuntu-latest` job,
the 15-minute timeout, exact action SHAs and inputs, expected command order,
failure-only artifact policy, and the absence of secrets, elevated permissions,
publishing, deployment, or `pull_request_target` behavior.

- [x] **Step 2: Confirm RED**

Run:

```bash
npm test -- tests/ci-workflow-contract.test.ts
```

Expected: FAIL because `.github/workflows/ci.yml` does not exist.

- [x] **Step 3: Commit the failing contract**

```bash
git add tests/ci-workflow-contract.test.ts
git commit -s -m "test: specify pull-request CI contract"
```

### Task 2: Implement the least-privilege CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `tests/ci-workflow-contract.test.ts` only if the executable contract exposes a design ambiguity.

**Interfaces:**

- Consumes: `.nvmrc`, `package-lock.json`, root npm scripts, and the immutable action SHAs in the design.
- Produces: the `CI / Node quality and package` required-check candidate and three-day failure diagnostics.

- [x] **Step 1: Add triggers, permissions, concurrency, and the bounded job**

Configure `pull_request`, `push`, and `workflow_dispatch`; grant only
`contents: read`; cancel superseded pull-request runs; define one
`ubuntu-latest` job with `timeout-minutes: 15` and `CI: "true"`.

- [x] **Step 2: Add the pinned setup and validation pipeline**

Pin checkout, setup-node, and upload-artifact to their approved full SHAs.
Disable persisted Git credentials and package-manager caching. Verify the exact
Node/npm versions, install with `npm ci`, then run formatting, spelling, lint,
type-checking, unit tests, coverage, template schema validation, build, and
package verification in that order. Pipe each command through `tee` with shell
pipeline failure propagation into `.ci-diagnostics`.

- [x] **Step 3: Add failure-only diagnostics**

Upload only fixed repository paths for failures from trusted repository refs,
ignore absent optional paths, include hidden diagnostic files, and retain the
artifact for exactly three days. Do not upload artifacts for fork pull requests,
npm user logs, or environment dumps.

- [x] **Step 4: Confirm GREEN and validate Actions syntax**

Run:

```bash
npm test -- tests/ci-workflow-contract.test.ts
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
```

Expected: contract tests pass and actionlint emits no diagnostics.

- [x] **Step 5: Commit the workflow**

```bash
git add .github/workflows/ci.yml tests/ci-workflow-contract.test.ts
git commit -s -m "ci: add pull-request quality foundation"
```

### Task 3: Publish contributor-facing CI guidance

**Files:**

- Modify: `README.md`
- Modify: `docs/development/toolchain.md`

**Interfaces:**

- Consumes: the implemented workflow and its exact local command sequence.
- Produces: an honest CI badge and documentation for local reproduction and diagnostics.

- [x] **Step 1: Add the real CI status badge**

Link the README badge to `.github/workflows/ci.yml` on `main`; do not add
coverage or release badges without published services.

- [x] **Step 2: Document local parity and diagnostic behavior**

Explain the exact pinned runtime, `npm ci`, `npm run verify`, the separate
template-schema command, sequential failure behavior, and the three-day
failure artifact without promising a required branch-protection rule.

- [x] **Step 3: Run focused documentation checks and commit**

```bash
npm run format:check
npm run spellcheck
git diff --check
git add README.md docs/development/toolchain.md
git commit -s -m "docs: explain pull-request CI checks"
```

### Task 4: Verify and merge the implementation without closing the issue

**Files:**

- Verify: all changed files and generated package output.

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: a reviewed implementation pull request merged into `main`, while issue #7 remains open for platform evidence.

- [x] **Step 1: Run the clean local quality suite**

```bash
npm ci
npm run templates:validate
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
git diff --check
```

- [x] **Step 2: Obtain an independent code review**

Resolve every technically valid finding and rerun affected checks.

- [x] **Step 3: Push and open the implementation pull request**

Describe the implementation and local evidence. Refer to issue #7 without an
automatic closure keyword because the deliberate failure campaign is pending.

- [x] **Step 4: Confirm the GitHub-hosted green run and merge**

Inspect each step and the exact event/permission context before merging the pull
request. Sync local `main` after merge.

### Task 5: Prove blocking failures and close with platform evidence

**Files:**

- Temporarily modify on a disposable branch: one TypeScript source, one test, and `scripts/build.mjs`.
- Create: `docs/verification/issue-7-ci-evidence.md`

**Interfaces:**

- Consumes: the merged CI workflow.
- Produces: GitHub run URLs for lint, type-check, test, package-content failure, and clean success; static fork-safety evidence; closure of issue #7.

- [x] **Step 1: Open a disposable pull request from a test branch**

Start from current `main`. Never merge this pull request.

- [x] **Step 2: Exercise the lint failure**

Commit a deliberately lint-invalid TypeScript probe, push, and record that the
Lint step blocks the job while the failure artifact is available.

- [x] **Step 3: Exercise the type failure**

Replace the probe with lint-valid but type-invalid TypeScript, push, and record
that Type-check blocks the job.

- [x] **Step 4: Exercise the unit-test failure**

Replace the probe with a deliberately failing Vitest assertion, push, and record
that Unit tests blocks the job.

- [x] **Step 5: Exercise the package-content failure**

Alter the disposable build to stage an unexpected file, push, and record that
Verify package blocks the job.

- [x] **Step 6: Restore a clean tree and prove success**

Remove every probe, push a final signed commit, and record a fully green run.
Close the disposable pull request without merging and delete its branch.

- [x] **Step 7: Record fork-safety and platform evidence**

Document the use of `pull_request`, read-only permissions, no secret references,
no persisted credentials, standard hosted runner, and the relevant GitHub event
contract. Include the implementation and test pull requests plus all run URLs.

- [x] **Step 8: Merge the evidence pull request and close issue #7**

Use an automatic closure keyword only in this final evidence pull request.
Confirm the issue is closed after merge and then inspect the next sequential issue.
