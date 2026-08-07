# Embedded Runtime Distribution Contract

Claude Code and Codex invoke a runtime the plugin owns, from inside the plugin
directory, against an arbitrary project working directory. There is no global
executable, no `PATH` entry, and no project `node_modules`.

The predecessor shipped its runtime separately: an installer put a binary on
`PATH`, hooks invoked it by name, and an `--expect <version>` flag existed to
detect the drift that arrangement created. Two artifacts with independent
installation lifecycles will diverge, and a version flag only reports the
divergence after it has already happened. Removing that split is the point of
this contract.

## Plugin layout

A plugin install contains exactly these files:

| Path | Role |
| --- | --- |
| `runtime/yoda.mjs` | Canonical entry point: the interpreter gate |
| `runtime/yoda.core.mjs` | The self-contained bundle |
| `runtime/manifest.json` | Versions and digests of what actually shipped |

Schemas, skills, agents, providers, and templates are owned by later issues.
This contract freezes the layout that will hold them.

## Why the boot is split

`runtime/yoda.mjs` does not contain the runtime. It contains a small preflight
that checks the interpreter and only then dynamically imports
`runtime/yoda.core.mjs`.

This is not a stylistic choice. A JavaScript module is parsed in full before any
of it executes. If the bundle targets modern Node and a user runs an older one,
the failure is a `SyntaxError` from the parser — raised before any version check
inside that same file could possibly run. **A guard cannot protect the code it
shares a file with.** Splitting the boot is the only way to answer an old
interpreter with a structured result instead of a parser stack trace.

`runtime/yoda.mjs` therefore restricts itself to syntax valid on Node 12.17.0, the
first release with unflagged ESM and dynamic `import()`, and is never
transpiled. Below that an ESM entry point cannot load a core at all, so no guard
placed inside one would help; that boundary is stated here rather than papered
over.

Both files ship inside the plugin and import nothing but Node builtins and each
other, so the runtime stays self-contained: two files, one unit, zero
dependencies.

## Interpreter policy

The supported floor is **Node.js 24.0.0**, matching the bundle's `node24`
target. A prerelease of the floor precedes it and is rejected.

The preflight reads `process.versions.node`. It never searches `PATH`, never
probes for another interpreter, and never re-executes itself under one. If the
interpreter running the preflight is too old, that is the answer.

An interpreter that is **absent** entirely is outside the runtime's reach —
nothing runs, so nothing can report. Detecting that and rendering guidance
belongs to the host adapter that spawns the runtime. The boundary is stated on
both sides so neither assumes the other covers it.

Rejection emits one `result.v1` document on stdout and exits `2`:

```json
{
  "contractVersion": "1.0.0",
  "status": "failure",
  "exitCode": 2,
  "reasonCode": "runtime.node_unsupported",
  "summary": "The interpreter running the plugin runtime is older than the supported minimum.",
  "why": ["The plugin runtime requires a newer Node.js interpreter."],
  "evidence": [],
  "stateChanged": false,
  "retryable": false,
  "recovery": "Install Node.js 24.0.0 or newer and run the command again."
}
```

`stateChanged` is `false` because the check runs before anything is opened for
writing. The rejected version is never echoed back, and no local path or stack
trace appears.

The reason belongs to catalog revision `1.2.0`. The preflight cannot import the
contracts package — that package is bundled with modern syntax, which is exactly
the situation the preflight exists to survive — so the build injects the
catalog's summary and recovery text into the entry point. A test compares the
injected literals against the catalog, so a drifting copy fails the build rather
than shipping.

## Two roots

Two roots exist and must never be confused:

| Root | Resolved from | Holds |
| --- | --- | --- |
| Plugin root | `import.meta.url` | the runtime, its manifest, and later plugin assets |
| Project root | `process.cwd()` | the user's repository and its state surfaces |

The runtime resolves its own assets relative to `import.meta.url`, never
relative to the working directory. That is what lets one installed plugin serve
any number of unrelated projects.

This is currently a **rule the layout must keep**, not yet a body of resolution
code: the only module-relative resolution in the distribution is the entry
point's import of its core, because no plugin asset exists to load yet. The rule
is stated and tested now so the asset issues that follow inherit it rather than
having to retrofit it.

Both roots are tested from paths containing spaces and non-ASCII characters,
because a relative dynamic import through a percent-encodable `import.meta.url`
is exactly where naive path handling breaks.

## Two inventories

A plugin install and a project install receive different things, so there are
two lists rather than one variation of the same list.

**Plugin allowlist** — the exact set a plugin install contains. Anything else
fails the build:

```text
runtime/manifest.json
runtime/yoda.core.mjs
runtime/yoda.mjs
```

**Project denylist** — patterns that must never appear under a project the
runtime operated on. A project receives state surfaces; it never receives the
runtime, its sources, or a dependency tree:

```text
node_modules/    any dependency tree
packages/        TypeScript sources
runtime/         the bundled runtime
*.ts  *.map      sources and debugging metadata
```

`npm run package:verify` enforces both directions, so CI carries the guarantee
rather than the tests alone.

Source maps are excluded deliberately. A source map reconstructs the TypeScript
sources, and the denylist exists precisely to keep sources out of what ships.
Debugging metadata becomes a considered release artifact rather than a file that
rides along unnoticed.

## Distribution manifest

`runtime/manifest.json` states what shipped rather than what the source tree
believes:

| Field | Meaning |
| --- | --- |
| `contractVersion` | Manifest schema version |
| `pluginVersion` | The version `--expect` is matched against |
| `runtime.entry` | Canonical entry path |
| `runtime.core` | Bundle path |
| `runtime.coreSha256` | Digest of the built bundle |
| `runtime.minimumNode` | Supported interpreter floor |
| `contracts` | Result, reason-catalog, state, and host versions carried |

Package verification fails if the recorded digest does not match the built core.

## Version pinning and handshake

**`--expect <version>`** is preserved from the predecessor, because it is the
anti-drift mechanism and dropping it would lose behavior. It is checked before
anything else, so a drifted install never reaches the operation it was asked
for:

| Supplied value | Reason | Exit |
| --- | --- | --- |
| Missing, non-string, malformed, or untrimmed | `contract.plugin_version_invalid` | 2 |
| Well-formed but not this bundle's version | `contract.plugin_version_unsupported` | 2 |

**`handshake`** writes an `adapter-message.v1` response reporting the plugin,
result, reason-catalog, state, and host versions this bundle carries. Invoked
directly it reports no observed host identity, because it was handed none and
the contract requires stating the limitation rather than substituting a guess.

The runtime does not yet classify a **host** contract version: nothing hands it
one to judge. `contract.host_version_invalid` and
`contract.host_version_unsupported` are defined by the
[contract versioning guide](contract-versioning.md) and will be wired when the
host adapter protocol delivers a request carrying that identity. They are not
reachable through this contract, and this document does not claim otherwise.

`--expect` does not reimplement version policy: it calls the same published
classifier, so a family is judged in exactly one place. It never echoes the
supplied value, and neither does the unrecognized-argument path — a misordered
`--expect` lands there, so echoing would reopen the same disclosure hole.

`--expect` must be the **first** argument. Anywhere else it is not recognized as
a flag and the invocation is rejected without acting.

The full request/response conversation belongs to the host adapter protocol.
This contract covers the runtime's half of it.

## Verification

```bash
npm run build
npm run package:verify
npm test -- tests/runtime-preflight.test.ts tests/runtime-distribution.test.ts \
  tests/runtime-handshake.test.ts tests/package-boundaries.test.ts
```

The boundary tests are the direct evidence for this contract's claims: the
runtime runs against a project directory whose name contains a space and
non-ASCII characters, two unrelated projects receive identical answers from one
installed plugin, and a run succeeds with a deliberately failing decoy `yoda`
first on `PATH`. The decoy is asserted to be reachable and to fail loudly before
the run is asserted to ignore it, so the evidence cannot pass vacuously.

## Parity

This contract builds distribution machinery. It adds no differential,
integration, or E2E evidence to any parity row, so parity remains
`0 / 400 (0.00%)`.

The predecessor's `PATH`-installed binary and its two platform installers are
deliberately not reproduced. Removing them is the outcome this issue exists to
produce.
