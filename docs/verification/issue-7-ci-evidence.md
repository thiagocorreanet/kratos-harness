# Issue 7 Pull-request CI Evidence

## Result

Issue [#7](https://github.com/thiagocorreanet/kratos-harness/issues/7) is
verified against the GitHub-hosted platform. Pull request
[#78](https://github.com/thiagocorreanet/kratos-harness/pull/78) merged the CI
foundation as commit `1c3d4b6836c914c085ae0f97eddb0dfd90c61326` after both the
CI and documentation workflows passed. Pull request
[#79](https://github.com/thiagocorreanet/kratos-harness/pull/79) was a disposable,
unmerged campaign that proved four blocking failures and a restored clean run.
It was closed and its remote branch was deleted after the evidence was captured.

## Implementation success

The implementation pull request ran on the `pull_request` event using the
standard `ubuntu-latest` GitHub-hosted runner. Its
CI run (predecessor run `31145549536`)
completed all named gates in 30 seconds:

1. exact Node.js and npm toolchain;
2. locked dependency installation;
3. formatting and spelling;
4. lint and strict type-checking;
5. unit tests and coverage;
6. pinned online Issue Form schema validation;
7. bundle build and package-content verification.

The failure-only artifact step was skipped on this successful run.

Local verification used Node.js `24.18.0` and npm `11.16.0`:

```text
npm ci
npm run templates:validate
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
git diff --check
```

The local result was 47 passing tests, 100% statements/branches/functions/lines
on the measured runtime surface, five forms validated against schema commit
`4b00bca7dc9307b9dd34ca13d8c87329d66ad4ce`, a verified standalone package,
and no actionlint or diff diagnostics.

## Deliberate failure campaign

Every scenario started from the previous probe, preserved all earlier gates,
and changed only the condition needed to reach the next expected failure.

| Scenario | Probe commit | Blocking step | GitHub run | Artifact expiry |
| --- | --- | --- | --- | --- |
| Lint-invalid TypeScript | `707114ff533fa4ffcf9b7e3d56b4573d2c22b833` | `Lint` | 31145621210 (predecessor run `31145621210`) | 2026-08-10 03:52 UTC |
| Lint-valid, type-invalid TypeScript | `d2b944af3cc8220d0feb8ab0fc78f97343ee1680` | `Type-check` | 31145671292 (predecessor run `31145671292`) | 2026-08-10 03:52 UTC |
| Failing Vitest assertion | `7119115820e3ae2e7f1f1297ec85804ce0c35cc3` | `Run unit tests` | 31145708004 (predecessor run `31145708004`) | 2026-08-10 03:53 UTC |
| Unexpected staged package file | `536c25ef80fede641d23aafa46c1f4533ef2b218` | `Verify package contents` | 31145768135 (predecessor run `31145768135`) | 2026-08-10 03:55 UTC |

Each run concluded `failure`, skipped all later validation gates, and completed
the failure-diagnostics upload. GitHub reported one artifact named
`ci-failure-<run-id>-1` per run, with expiry exactly three days after creation.

Commit `a04f81415d89c9f158a0d82a19189921f10af333` removed the final probe. The
restored run (predecessor run `31145836247`)
then passed every gate in 35 seconds and skipped artifact upload. No campaign
commit was merged.

## Fork and authority safety

The fork boundary is confirmed by both GitHub's platform contract and an
executable repository contract:

- the workflow uses `pull_request`, never `pull_request_target`;
- top-level authority is exactly `contents: read`, with no job-level override;
- no workflow reference to the `secrets` context is allowed;
- checkout does not persist credentials;
- job and step `continue-on-error` overrides are forbidden;
- third-party Actions use reviewed immutable commit SHAs;
- fork pull requests cannot upload artifacts, preventing untrusted code from
  substituting symlinks in the diagnostic paths;
- the only runner is the standard GitHub-hosted `ubuntu-latest` runner.

GitHub documents that fork-originated `pull_request` workflows receive a
read-only `GITHUB_TOKEN` and no other secrets in
[Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
GitHub's
[secure pull-request guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
also identifies `pull_request` as the event that runs untrusted fork code with a
read-only token while withholding repository secrets.

The repository API snapshot taken for this evidence reported:

```json
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false,
  "repository_secrets": 0,
  "environments": 0
}
```

Even if repository or environment secrets are added later, the event contract
withholds them from fork-originated code and the workflow contains no expression
that requests them. `tests/ci-workflow-contract.test.ts` fails if these
least-privilege controls regress.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Pull requests to `developer` and `main` | Exact trigger contract plus actionlint validation |
| Install, format, lint, type, unit, schema, build, smoke, and package gates | Implementation success run completed every named step |
| Immutable Actions and timeout | Full-SHA contract and 15-minute job limit |
| Superseded pull-request cancellation without lost pushes | PR-number groups; unique run IDs for non-PR events |
| Useful short-lived diagnostics | Four successful failure uploads with three-day expiry |
| Lint, type, test, and package failures block | Four deliberate failing runs above |
| Read-only, fork-safe authority | Platform contract, repository contract, and API snapshot above |
| Standard hosted runner | `ubuntu-latest` contract and GitHub run metadata |
| Success after cleanup | Restored run 31145836247 passed every gate |

All implementation, syntax, success, failure, diagnostic, and authority evidence
required by issue #7 is reproducible from the linked commits and runs.
