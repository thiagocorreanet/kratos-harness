# Objective Spec: Restore Dependabot Pull-Request CI

Date: 2026-08-27
Status: APPROVED

## Problem and desired outcome

The `Node quality and package` job on pull requests #161 and #162 reached its
15-minute job timeout after earlier steps had passed. The quality pipeline has
grown beyond the original bound, so otherwise mergeable dependency updates are
reported as unstable.

Increase the quality job's bounded execution window to 30 minutes, rerun the
repository verification, and then rerun the affected pull-request checks.

## Scope

- Update the executable CI contract and workflow timeout together.
- Update documentation that states the old 15-minute quality-job limit.
- Rerun, approve, and merge pull requests #161 and #162 only after their checks
  pass.

## Non-goals

- Do not create the absent `developer` branch.
- Do not activate repository rulesets whose declared CodeQL requirement cannot
  currently run on pull requests.
- Do not add automatic Dependabot approval authority.
- Do not restructure the quality pipeline.

## Acceptance criteria

- [ ] The CI contract requires a 30-minute timeout for `Node quality and
  package`.
- [ ] The workflow configures the quality job with that 30-minute timeout.
- [ ] Relevant documentation no longer claims that this job has a 15-minute
  limit.
- [ ] Formatting, linting, type-checking, tests, build, and package verification
  pass locally.
- [ ] Pull requests #161 and #162 complete all checks successfully before merge.

## Test strategy and failure modes

- RED: change the contract expectation to 30 while the workflow still contains
  15; the focused contract test must fail on the mismatch.
- GREEN: update the workflow to 30; the focused contract test must pass.
- Run `npm run verify` and the repository workflow-contract tests.
- A cancelled or failed remote check blocks approval and merge.

## Compatibility and risk

The commands, permissions, runner, event triggers, and dependency graph remain
unchanged. The only runtime effect is allowing the existing quality job up to
30 minutes before GitHub cancels it.
