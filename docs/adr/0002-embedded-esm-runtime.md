# ADR 0002: Embedded Self-Contained ESM Runtime

Status: Accepted

Date: 2026-08-06

## Context

The Go v3 runtime is installed as a separate executable. That provides a static
binary, but it also creates an independent installation and update lifecycle.
The plugin, schemas, prompts, templates, and runtime can drift, and contributors
must coordinate cross-platform binaries with host integration changes.

The rewrite needs a productive typed development model while retaining a
single, deterministic runtime artifact that works without a project dependency
installation.

## Decision

Develop the runtime and supporting packages in strict TypeScript and distribute
the executable runtime as one self-contained JavaScript ESM file at
`runtime/kratos.mjs` inside the installed plugin. Runtime execution must not
require TypeScript sources, a global `kratos` binary, project-local dependencies,
a runtime `node_modules`, or network access.

The plugin manifest binds the plugin, runtime, schema, skill, adapter, and
template versions. Black-box tests execute the final bundle from a clean fixture
before release.

Development dependencies may use normal workspace packages, but bundling must
either include or eliminate every runtime dependency. Package verification
rejects accidental dynamic loads from the development workspace.

## Consequences

- Installing or updating the plugin installs one version-coherent runtime.
- Users avoid PATH configuration and a separate global Kratos package.
- The build must prove deterministic bundling, package contents, executable
  behavior, license notices, and absence of runtime `node_modules` access.
- Source maps and debugging metadata are deliberate release artifacts rather
  than implicit development files.
- Supported Node versions and ESM behavior become explicit compatibility policy.
- Native operating-system behavior still requires real platform tests even
  though no platform-specific Kratos binary is shipped.

## Alternatives rejected

- **Continue distributing Go binaries:** preserves the old packaging model but
  retains a second version lifecycle and per-platform release artifacts.
- **Install a global Node CLI:** repeats the PATH and version-drift problem.
- **Ship an unbundled npm workspace:** requires runtime `node_modules`, expands
  the supply-chain surface, and weakens artifact coherence.
