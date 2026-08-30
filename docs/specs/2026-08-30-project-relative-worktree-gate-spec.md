# Objective Spec: Project-Relative Worktree Gate

Date: 2026-08-30
Status: DONE

## Problem and desired outcome

When the selected project root is below the Git worktree root, porcelain-v2
paths include the project prefix. The workflow gate currently recognizes only
the root-relative `.brain` spelling, so Kratos refuses to start a run even when
all changes belong to the selected project's managed state.

The Git observation must expose the selected project's prefix within the
worktree, and the workflow gate must use it when recognizing managed paths.

## Scope

In scope:

- Observe the project prefix through the existing `rev-parse` invocation.
- Treat only `<project-prefix>/.brain/**` as managed.
- Preserve repository-relative Git change paths and linked-worktree behavior.
- Cover root and nested project layouts with automated regression tests.

Out of scope:

- Rewriting Git change paths as project-relative paths.
- Changing the policy for changes outside the selected project's `.brain`.
- Adding Git commands or external dependencies.

## Acceptance criteria

- [x] A project at the worktree root continues to treat `.brain/**` as managed.
- [x] A nested project treats only `<project-prefix>/.brain/**` as managed.
- [x] A nested project with only managed state changes records `run.started`.
- [x] A change outside the selected project's managed state still returns
      `trail.worktree_dirty`.
- [x] Linked-worktree classification and existing Git observation behavior stay
      intact.
- [x] Relevant tests, lint, type checking, and the full test suite pass.

## Test strategy and failure modes

- Unit-test `rev-parse` parsing for empty and nested prefixes.
- Use a real repository fixture whose project root is a child directory.
- Exercise `start` through runtime composition and assert the emitted result.
- Add a negative case for a repository-root or sibling change.
- Verify malformed `rev-parse` output remains `unreadable` and undecodable paths
  remain conservatively unmanaged.

## Compatibility and risk

The Git observation model gains one additive field. Existing change paths keep
their repository-relative spelling. The principal risk is accidentally
classifying a different `.brain` directory as managed; exact prefix matching
and the negative regression prevent that.
