# Embedded Runtime Distribution Contract Design

Issue [#14](https://github.com/thiagocorreanet/kratos-harness/issues/14) (`CMP-06`).
Epic [#8](https://github.com/thiagocorreanet/kratos-harness/issues/8).
Depends on [#3](https://github.com/thiagocorreanet/kratos-harness/issues/3) (`FND-02`),
[#11](https://github.com/thiagocorreanet/kratos-harness/issues/11) (`CMP-03`), and
[#12](https://github.com/thiagocorreanet/kratos-harness/issues/12) (`CMP-04`).

## Problem

The predecessor shipped a separate global executable. Its plugin distribution
carried 59 files — manifests, schemas, skills, agents, providers, templates, and
two platform installers — but never the runtime itself. The runtime arrived
through `install.sh` or `install.ps1`, landed on `PATH`, and was then invoked by
name from every hook, with an `--expect <version>` flag added specifically to
detect the drift that arrangement created.

That is the drift this rewrite exists to remove. Two artifacts with independent
installation lifecycles will diverge, and a version flag only reports the
divergence after it has already happened.

## Goal

Claude Code and Codex invoke a runtime the plugin owns, from inside the plugin
directory, against an arbitrary project working directory, with no global
executable, no `PATH` entry, and no project `node_modules`.

## Non-goals

- Implementing the Claude Code or Codex adapters (`ADP-02` #36, `ADP-03` #37).
- Implementing the full host adapter protocol (`ADP-01` #35). This issue defines
  the handshake contract and proves the runtime side of it.
- Implementing plugin install, update, or rollback (`ADP-05` #39).
- Shipping schemas, skills, agents, providers, or templates into the plugin.
  Those are owned by their respective issues; this issue freezes the layout that
  will hold them.
- Release archives, signing, SBOM, or provenance (`BET-02` #59).

## Decisions

### D1: The entry point is a two-file boot, not one

The canonical entry point is `runtime/yoda.mjs`. It does not contain the
runtime. It contains a **preflight** written in deliberately conservative
syntax, whose only job is to check the Node.js version and then dynamically
import `runtime/yoda.core.mjs`, which is the real self-contained bundle.

This is forced by the acceptance criterion "a missing/unsupported Node.js
installation fails before mutation with structured recovery guidance." A
JavaScript module is parsed in full before any of it executes. If the bundle
targets modern Node and the user runs an older one, the failure is a
`SyntaxError` from the parser — before any version check inside the file could
possibly run. A guard that lives in the same file as the code it guards cannot
protect that code.

Splitting the boot is the only way to produce a structured result instead of a
parser stack trace. `yoda.mjs` restricts itself to syntax valid since Node 12.17.0,
the first release with unflagged ESM and dynamic `import()`, so the guard runs
on anything a user plausibly has installed. Below that the
runtime cannot report anything, and the design documents that boundary rather
than pretending to cover it.

Both files ship inside the plugin and contain no external imports beyond Node
builtins, so "self-contained" is preserved: two files, one unit, zero
dependencies.

### D2: Node detection reports, it does not search

The preflight reads `process.versions.node`. It never searches `PATH`, never
probes for other interpreters, and never re-executes itself under a different
one. If the interpreter running the preflight is too old, that is the answer.

A completely **absent** Node.js is outside the runtime's reach — nothing runs,
so nothing can report. Detecting that and rendering guidance belongs to the host
adapter that spawns the runtime (`ADP-01` #35). This design states that boundary
explicitly so neither side assumes the other covers it.

### D3: Failure renders through the universal result contract

An unsupported Node version emits a valid `result.v1` document on stdout and
exits with the code its catalog entry declares. It does not print a bare
message, and `stateChanged` is `false` because the preflight runs before
anything is opened for writing.

This requires one new reason. Catalog revision 1.2 preserves all 82 entries of
revision 1.1 byte-for-byte and adds:

| Reason | Status | Exit | Meaning |
| --- | --- | --- | --- |
| `runtime.node_unsupported` | `failure` | 2 | The interpreter running the plugin runtime is older than the supported minimum |

The addition is additive in exactly the way revision 1.1 was: published meanings
are unchanged, so the contract version stays `1.0.0`.

The preflight cannot import the contracts package — that package is bundled with
modern syntax, which is the situation the preflight exists to survive. It also
cannot read the catalog at run time without adding a file to the distribution.
So the build **injects** the catalog's summary and recovery text into the
preflight, and a test asserts the injected strings still match the catalog
entry. The catalog stays the single source of truth, and a drifting copy fails
the build rather than shipping.

### D3a: The distribution manifest binds what shipped

`runtime/manifest.json` is emitted by the build and states what this plugin
install actually contains:

| Field | Meaning |
| --- | --- |
| `contractVersion` | manifest schema version |
| `pluginVersion` | the version `--expect` is matched against |
| `runtime.entry` | canonical entry path, `runtime/yoda.mjs` |
| `runtime.core` | bundle path and its SHA-256 |
| `runtime.minimumNode` | the supported interpreter floor |
| `contracts` | result, reason-catalog, state, and host versions carried |

It exists so the handshake reports what shipped rather than what the source tree
believes, and so package verification can prove the staged files match their
recorded digests.

### D4: Plugin assets resolve from the plugin, project data from the cwd

Two roots exist and must never be confused:

| Root | Resolved from | Holds |
| --- | --- | --- |
| Plugin root | `import.meta.url` | runtime, manifest, and later schemas, skills, agents, templates |
| Project root | `process.cwd()` | the user's repository and its state surfaces |

The runtime resolves its own assets relative to `import.meta.url` and never
relative to the working directory. This is what lets one installed plugin serve
any number of projects.

This is a rule the layout must keep rather than a body of resolution code: no
plugin asset exists to load yet, so the only module-relative resolution today is
the entry point importing its core. Stating and testing the rule now means the
asset issues that follow inherit it instead of retrofitting it. Both roots are
tested from paths containing spaces and non-ASCII characters, because a relative
dynamic import through a percent-encodable `import.meta.url` is where naive path
handling breaks.

### D5: Two inventories, because the plugin and the project receive different things

The issue asks for allow/deny rules proving that "project installs contain state
surfaces only, not runtime source or dependencies." That is a second inventory,
not a variation of the first.

**Plugin distribution allowlist** — the exact set of files a plugin install
contains. Anything not listed fails the build:

```text
runtime/manifest.json
runtime/yoda.core.mjs
runtime/yoda.mjs
```

**Project install denylist** — patterns that must never appear in a project the
plugin operates on. A project receives state surfaces; it never receives the
runtime, its source, or its dependencies:

```text
node_modules/         any runtime dependency tree
packages/             TypeScript sources
runtime/              the bundled runtime
*.ts, *.map           sources and debugging metadata
```

Verification asserts both directions: the staged plugin matches the allowlist
exactly, and a project the runtime has operated on contains no denied entry.

### D6: Source maps are excluded from the distributed plugin

`sourcemap: false` stays. A source map reconstructs the TypeScript sources, and
D5 exists precisely to keep sources out of what ships. Debugging metadata
becomes a deliberate release artifact under `BET-02` (#59), not an implicit file
that rides along.

### D7: The handshake is defined here and proven minimally

Two mechanisms, both already contracted by `CMP-04`:

**Version pinning.** `--expect <version>` is preserved from the predecessor,
because it is the anti-drift mechanism and removing it would lose behavior. A
value that is missing or malformed yields `contract.plugin_version_invalid`; a
well-formed value outside the exact bundle version yields
`contract.plugin_version_unsupported`. Neither echoes the supplied value.

**Contract handshake.** `yoda.mjs handshake` writes an `adapter-message.v1`
response reporting the plugin, result, state, and host contract versions the
bundle carries. A host contract outside the accepted window yields
`contract.host_version_invalid` or `contract.host_version_unsupported` once a
host hands the runtime an identity to judge. Nothing does yet, so this issue
defines the clause and `ADP-01` wires it.

Both reuse `classifyContractVersion` and `contractFailureResult`, already
delivered by `CMP-04`. This issue wires the runtime to that classifier rather
than reimplementing version policy, so there is exactly one place where a family
is judged.

The full request/response conversation belongs to `ADP-01`. This issue proves
the runtime answers correctly and refuses incompatible versions.

## Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `packages/runtime/src/boot/preflight.mjs` | Node version gate, structured failure, dynamic import of the core | nothing but Node builtins |
| `packages/runtime/src/handshake.ts` | Builds the handshake response and classifies `--expect` | `classifyContractVersion`, `contractFailureResult` |
| `scripts/build.mjs` | Emits the two-file runtime and the distribution manifest | esbuild |
| `scripts/verify-package.mjs` | Enforces both inventories and black-box behavior | built plugin |

The preflight ships as `.mjs` rather than TypeScript because it must not be
transpiled: transpilation is exactly what would reintroduce modern syntax into
the file whose entire purpose is to parse on old interpreters. It is small
enough to review by eye and is covered by tests that execute it directly.

The version comparison lives inside the preflight rather than in a separate
`version.ts`, for the same reason: a TypeScript module would be transpiled into
the bundle, and the comparison must run *before* the bundle loads. It is tested
by executing the file under a stubbed interpreter version, which exercises the
shipped artifact rather than a reimplementation.

## Data flow

```text
host spawns:  node <plugin-root>/runtime/yoda.mjs <args>   (cwd = project root)
                    |
        runtime/yoda.mjs (preflight, conservative syntax)
                    |
        process.versions.node >= minimum ?
           |                        |
          no                       yes
           |                        |
   result.v1 on stdout      import("./yoda.core.mjs")
   runtime.node_unsupported          |
   exit 2, stateChanged: false   plugin root  = dirname(import.meta.url)
                                 project root = process.cwd()
```

## Error handling

| Condition | Output | Exit |
| --- | --- | --- |
| Node older than minimum | `result.v1`, `runtime.node_unsupported` | 2 |
| `--expect` missing or malformed | `result.v1`, `contract.plugin_version_invalid` | 2 |
| `--expect` outside bundle version | `result.v1`, `contract.plugin_version_unsupported` | 2 |
| Node absent entirely | nothing; the host adapter reports it | n/a |
| Core missing or unloadable | one fixed line on stderr, no stack trace | 2 |

A host contract version is deliberately absent from this table: the runtime is
handed none to classify, so publishing those rows here would describe an
unreachable path.

Every failure occurs before any file is opened for writing, so all of them
report `stateChanged: false`. None echoes a supplied version value, an absolute
path, or a stack trace.

## Testing

| Level | Proves |
| --- | --- |
| Unit | version comparison, handshake construction, `--expect` classification |
| Preflight | an old interpreter yields a valid `result.v1`, not a `SyntaxError` |
| Package | plugin allowlist exact; project denylist clean; no external imports |
| Black box | the built bundle runs from a clean room with a stripped environment |
| Path handling | plugin root and project root with spaces and non-ASCII characters |
| Environment | `PATH` containing a decoy `yoda` executable is never consulted |

The old-interpreter case is exercised by executing the preflight with a stubbed
`process.versions.node`, so the test does not require installing an old Node.

The decoy test is the direct evidence for "no global `yoda` executable is used":
a fake `yoda` that would fail loudly is placed on `PATH`, and the run must
succeed without touching it.

## Compatibility impact

No change to shipped behavior; there is no released plugin yet.

Parity remains `0 / 400 (0.00%)`. This issue builds distribution machinery; it
does not add differential, integration, or E2E evidence to any parity row, so no
row gains credit.

`--expect` semantics are preserved from the predecessor deliberately. The
predecessor's `PATH`-installed binary and its two installer scripts are
intentionally **not** reproduced — removing them is the point of the issue, and
the `PLUGIN-INSTALL-SH` and `PLUGIN-INSTALL-PS1` parity rows are satisfied by
the plugin-owned runtime rather than by porting the installers.

## Open decisions recorded rather than deferred

**Minimum Node version.** The repository pins `24.18.0` for development and the
bundle targets `node24`. The runtime's supported minimum is therefore Node 24.
Publishing a lower minimum would require lowering the esbuild target and
re-proving the bundle, which is not in scope.

**Preflight syntax floor.** Node 12, the first release with stable ESM. Older
interpreters cannot load an ESM entry point at all, so no guard placed inside
one can help them.
