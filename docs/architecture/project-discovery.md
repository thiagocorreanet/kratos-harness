# Project Discovery and Configuration Resolution

Project discovery is a read-only boundary between the process environment and
the deterministic runtime. It identifies one canonical project root, observes
the project-owned `.brain/`, and classifies configuration before any mutating
runtime ports are created. It does not add a command to the shipped CLI.

## Root selection

An explicit `--root` is resolved relative to the process working directory,
canonicalized, and inspected directly. Discovery never searches its ancestors.
If the explicit directory is unavailable, or its nearest marker is unusable,
the request is refused rather than silently redirected.

Without an explicit root, discovery walks from the current directory toward
the filesystem boundary. The nearest ancestor containing a usable `.brain/`
wins. An unusable nearest marker stops the search so that an older parent state
cannot unexpectedly take control.

Git is fallback context, not a stronger marker. In an ordinary checkout, its
top level may provide the root when no ancestor has state. In a linked Git worktree,
the default order is:

1. a local worktree `.brain/`;
2. the principal checkout and its nearest ancestor marker;
3. the local Git top level without initialized state.

The principal checkout fallback can be disabled with the worktree-local mode.
Canonicalization, marker containment, and Git topology are observations made by
the `Workspace` port. The pure resolver receives those observations and cannot
read the filesystem, invoke Git, or mutate a project.

A `.git` marker is not sufficient evidence by itself. If Git cannot validate
its topology, or a separate metadata layout does not expose an unambiguous
principal checkout, discovery refuses that marker. Unexpected filesystem errors
propagate to the composition boundary as internal failures; only expected
absence or a non-directory path is classified as unavailable.

## State locations and migration

The supported location is the project-owned `.brain/` directory. A legacy
sibling Brain layout is migration-only: discovery can report that migration is
required, but it never selects or reads sibling state as current project state.
Migration itself belongs to the migration command and its transactional policy.

Symlinks are accepted only when their canonical target remains inside the
selected project. Escapes and unreadable markers are refusals, not absence.
Discovery creates, changes, and removes nothing.

## Configuration

`.brain/config.json` is classified in this order:

1. JSON syntax;
2. `stateContract` identity and support;
3. structural validation through the registry-backed
   `ConfigurationValidator`.

The [schema registry contract](schema-registry.md) (`RUN-04`) now supplies that
production validator. Discovery continues to classify JSON syntax and `stateContract`
compatibility before invoking it, so version selection precedes structural
validation. Pure resolver tests can still inject a deterministic validator;
production composition defaults to the cached adapter backed by the single
production registry. Missing, corrupt, unsupported, migration-required, and
schema-invalid inputs remain distinct typed outcomes.

Effective values follow one explicit precedence:

```text
command flag > validated project configuration > runtime default
```

There is no environment-variable configuration layer. Each effective value
retains a provenance reference: `null` for a runtime default,
`.brain/config.json` for project configuration, or a fixed `--flag` name for a
command override. These references are safe to render and never contain an
absolute path, environment value, or raw configuration payload.

## Composition and compatibility

`discoverProject` composes the real environment and Node `Workspace` adapter.
Only an initialized resolution may be passed to `createRuntimeAt`, which then
roots mutation-capable ports at the selected canonical directory. Tests can
replace either boundary explicitly; production does not select fakes through
ambient state.

The source workspace exposes the discovery contract at
`@mestre-yoda/runtime/composition/discovery`. The standalone bundle still
supports only `help`, `version`, and `handshake`, and no discovery command
changed its published inventory. No discovery command is published by this issue.

Parity remains `0 / 400 (0.00%)`. This work provides internal unit, property,
and filesystem evidence, but no completed differential or end-to-end parity row.
