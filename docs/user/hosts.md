# Claude Code and Codex

Both host packages invoke the same embedded runtime by a package-relative path
and negotiate the same host contract. Neither requires a global legacy binary
or project `node_modules`.

## Claude Code

The Claude Code package contains plugin metadata, the Kratos skill, an
orchestrator agent, hooks, templates, schemas, and the shared runtime. Hooks
submit versioned operation messages; the adapter renders the runtime result
without changing reason codes.

## Codex

The Codex package contains plugin metadata, a Kratos skill, project
instructions, an orchestrator definition, templates, schemas, and the same
runtime bytes. Generated instructions use managed sections so repeated setup is
idempotent.

## Capability differences

A host reports its capabilities during negotiation. An operation that requires
an unavailable approval, hook, timeout, or cancellation capability fails with
an explicit unsupported-capability result. It never falls back to a weaker
policy.

Pin a package version for reproducibility. Use the atomic installer for update,
rollback, commit, and uninstall so a partial activation cannot replace the
working version.
