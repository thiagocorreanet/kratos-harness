# Pull-Request CI Foundation Design

- Status: Approved
- Decision date: 2026-08-07
- Tracking issue: [#7](https://github.com/thiagocorreanet/mestre-yoda/issues/7)
- Depends on: [#3](https://github.com/thiagocorreanet/mestre-yoda/issues/3)
- Approval basis: Maintainer-authorized autonomous recommendation

## 1. Outcome

Every pull request targeting `developer` or `main` receives one fast,
reproducible, least-privilege Node validation job on a standard public GitHub-
hosted runner. Each required gate has a named step and preserves its own failure
log. A superseded pull-request run is cancelled, while protected branch runs are
never cancelled by this workflow.

The workflow is safe for fork-originated code: it uses `pull_request`, never
`pull_request_target`; declares only `contents: read`; persists no checkout
credentials; references no repository/environment secret; and performs no
write, publish, deploy, cache-save, comment, or approval operation.

## 2. Approaches considered

| Approach | Advantages | Costs | Decision |
| --- | --- | --- | --- |
| One job invoking only `npm run verify` | Minimal YAML and one local/CI entrypoint | Hides the failing gate in one step, omits online template schema validation, weak failure artifacts | Rejected |
| One sequential job with named gates | One install, fast feedback, exact failure step/log, low public compute, mirrors scripts | Later gates do not run after an early failure | Selected |
| Parallel job per gate | Maximum gate parallelism and isolation | Repeats checkout/install many times, consumes more public compute, uploads fragmented diagnostics | Rejected for foundation |

Issue #55 may later split platform, nightly, compatibility, security, and release
campaigns when their implementation exists. This issue establishes only the
fast pull-request foundation.

## 3. Trigger and concurrency contract

`.github/workflows/ci.yml` runs on:

- `pull_request` targeting `developer` or `main`;
- `push` to `developer` or `main` for protected-line confirmation;
- `workflow_dispatch` for safe manual re-execution.

It does not use `pull_request_target`, `workflow_run`, privileged reusable
workflows, tag/release triggers, schedules, or paths filters. Every source or
configuration change must receive the same foundation checks.

Concurrency groups by workflow plus pull-request number or Git ref. Only
`pull_request` runs set `cancel-in-progress: true`; branch pushes are preserved
as durable integration/release evidence. This carries forward the useful
superseded-PR lesson from the private predecessor without copying its Go,
self-hosted runner, private distribution, or prose implementation.

## 4. Runner, permissions, and action supply chain

The job uses `ubuntu-latest`, the standard GitHub-hosted runner appropriate to a
public repository, and an explicit 15-minute timeout. Workflow permissions are:

```yaml
permissions:
  contents: read
```

No job or step expands permission. Repository default workflow permissions are
already read-only and cannot approve pull requests; the explicit workflow block
makes that boundary reviewable even if repository defaults later change.

Every third-party Action is pinned to a full immutable commit SHA with its
reviewed release in a comment:

| Action | Release | Commit |
| --- | --- | --- |
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Checkout sets `persist-credentials: false`. Setup Node reads exact `24.18.0`
from `.nvmrc`, disables latest-version lookup and automatic package-manager
caching, and does not write a dependency cache. The environment step asserts
Node `v24.18.0` and npm `11.16.0` before install. The exact npm version comes
from the exact Node distribution and fails closed if the upstream bundle ever
changes unexpectedly.

## 5. Named validation gates

After checkout/setup, the job creates `.ci-diagnostics/` and executes these
steps in order:

1. exact toolchain assertion;
2. `npm ci` under strict lifecycle-script policy;
3. `npm run format:check`;
4. `npm run spellcheck`;
5. `npm run lint`;
6. `npm run typecheck`;
7. `npm test`;
8. `npm run test:coverage`;
9. `npm run templates:validate`;
10. `npm run build`;
11. `npm run package:verify`.

Each command runs under Bash pipe-failure semantics and tees combined output to
a fixed diagnostic file. A failing command therefore fails its named step; the
log capture cannot turn a failure into success. The template schema step remains
the one explicit online validation because it retrieves a commit- and SHA-256-
pinned schema; all other repository gates are offline after install.

This order distinguishes unit tests, schema checks, final bundle build, bundle
smoke behavior, and exact package contents. It does not replace deterministic
tests with prompt/model evaluations and does not introduce CI-only product
behavior.

## 6. Failure diagnostics

One final `if: failure()` step uploads only:

- `.ci-diagnostics/` named command logs;
- `coverage/` when the coverage gate ran;
- `dist/` when build/package validation ran.

The artifact name uses only run ID/attempt, hidden-file inclusion is limited to
the explicitly named diagnostics directory, missing paths are ignored, and
retention is 3 days. No npm cache/debug tree, repository secret, token,
credential, environment dump, home directory, or arbitrary workspace archive is
uploaded. Successful runs upload no artifact.

## 7. Fork safety

GitHub's documented `pull_request` model supplies fork workflows a read-only
token and withholds repository secrets unless maintainers explicitly configure
otherwise. This workflow further removes every secret reference and write use.
Fork code can read the already-public checkout, execute public tests, and upload
failure logs from that public code; it cannot mutate repository content,
approve/comment on a PR, publish a package, deploy, or read a repository secret.

The security boundary is protected by a repository contract test that rejects:

- `pull_request_target` or any secret expression;
- permissions other than `contents: read`;
- self-hosted or non-`ubuntu-latest` runners;
- mutable/non-SHA action references;
- persisted checkout credentials, package-manager cache, write/publish steps,
  or unbounded artifact retention.

## 8. Validation campaign and closure order

`tests/ci-workflow-contract.test.ts` is written first and fails while `ci.yml`
is absent. It parses the workflow, validates exact triggers/concurrency,
permissions, runner/timeout, action pins, named command order, pipe-safe logging,
failure-only artifact policy, and fork-safety exclusions. Actionlint 1.7.12 then
validates GitHub expression and workflow syntax.

The implementation PR references #7 without any automatic-closing phrase and
merges only after the real CI job is green. Issue #7 remains open. A separate,
unmerged test PR then exercises four actual failure modes against the workflow:

| Probe | Expected blocking step |
| --- | --- |
| ESLint-invalid TypeScript | Lint |
| Lint-valid but type-invalid TypeScript assignment | Type-check |
| Intentionally false Vitest assertion | Unit tests |
| Extra staged package file | Verify package |

Each probe is a signed commit/push; the run conclusion and named failed step are
recorded before the next probe. A final clean probe returns the same PR to green.
The test PR is closed without merge and its branch is deleted. No intentional
failure enters `main`.

Only after the success run, all four blocking runs, failure-artifact retention,
fork-safety inspection, and the final clean run are recorded may an evidence
follow-up intentionally close #7.

## 9. Compatibility and provenance

This workflow changes repository validation only. It does not alter runtime,
state, migration, host, public schema, PRD, or spec behavior. It consumes the
already approved toolchain/package contracts and will expose violations without
redefining them.

The private Go CI was consulted only for observable lessons about PR-only
concurrency cancellation and explicit timeouts. Its self-hosted runners, Go/
Python checks, private coverage policy, comments, and implementation are not
copied. The new workflow/design/test prose is original clean-room work based on
the public TypeScript repository and public GitHub Actions contracts.
