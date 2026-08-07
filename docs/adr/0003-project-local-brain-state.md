# ADR 0003: Project-Local Brain State

Status: Accepted

Date: 2026-08-06

## Context

Go v3 stores project memory in a sibling `<repo>-brain/.brain/` repository. The
layout protects application Git history from workflow state, but cloning the
application without its sibling can leave host wiring present while the state
repository is missing. Discovery, backup, permissions, and multi-worktree
behavior become dependent on two related repositories.

The rewrite chooses simpler, explicit project ownership while preserving the
separation between installed runtime assets and project-specific memory.

## Decision

Project-specific Yoda state lives under `.brain/` inside the user project.
Claude Code wiring lives under `.claude/`, and Codex wiring lives under
`.codex/`. Runtime code, schemas, skills, adapters, and templates remain
plugin-owned.

The Go v3 sibling `<repo>-brain/.brain/` layout is a legacy source only.
Migration is explicit, previewable, backed up, transactional, verified, and
reversible. Discovery never mutates either location.

The project controls whether appropriate `.brain/` content is committed,
ignored, encrypted, or synchronized. Yoda classifies sensitive paths and keeps
secrets and raw prompts out of events by default. Managed-path operations are
confined to the resolved project root and reject traversal, symlink, special
file, and case-collision attacks.

## Consequences

- Project state has one discoverable root and travels with the project according
  to its explicit repository policy.
- Host wiring and workflow state no longer depend on an implicit sibling naming
  convention.
- Teams must decide and document which `.brain/` surfaces are versioned.
- Worktree, privacy, ignore, backup, and retention behavior require dedicated
  contracts and cross-platform tests.
- Legacy users need a no-write discovery plan, verifiable backup, incremental
  schema conversion, replay validation, and rollback before Go retirement.
- The plugin cannot overwrite user-owned host configuration during reconciliation.

## Alternatives rejected

- **Keep the sibling Brain repository:** retains two-repository operational
  failure modes and conflicts with the chosen public architecture.
- **Store state inside the plugin:** mixes project memory with replaceable
  installation assets and prevents portable project-level backup.
- **Use a mandatory remote database:** breaks offline use and adds privacy,
  tenancy, authentication, and availability dependencies.

