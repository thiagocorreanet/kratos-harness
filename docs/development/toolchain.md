# Deterministic TypeScript Toolchain

Mestre Yoda uses one pinned development environment to make a clean checkout
produce the same validated runtime artifact.

## Prerequisites

- Node.js `24.18.0` exactly for development and CI;
- npm `11.16.0` exactly, as distributed with that Node release;
- Git for obtaining and inspecting the checkout.

The supported runtime range is `>=24.18.0 <25`. The exact development version
is recorded in `.nvmrc` and `.node-version`; the root manifest and lockfile pin
npm and all development dependencies. `.npmrc` rejects unsupported engines.

## Clean-checkout verification

```bash
git clone https://github.com/thiagocorreanet/mestre-yoda.git
cd mestre-yoda
npm ci
npm run verify
```

`npm ci` installs only the committed lockfile resolution. It must be used for
clean and CI installations. Changing a dependency requires Node `24.18.0`, npm
`11.16.0`, an exact manifest version, and a newly committed lockfile.

## Commands

| Command | Responsibility |
| --- | --- |
| `npm run format:check` | Check supported source and configuration formatting |
| `npm run spellcheck` | Check tracked English Markdown with the project dictionary |
| `npm run templates:validate` | Validate Issue Forms against a pinned SchemaStore snapshot of GitHub's documented schema |
| `npm run lint` | Run typed ESLint with zero warnings |
| `npm run typecheck` | Run strict TypeScript 6 compatibility checking without emit |
| `npm test` | Run unit and clean-room bundle tests once |
| `npm run test:coverage` | Enforce 100% coverage on the initial CLI decision surface |
| `npm run oracle:verify` | Validate the public metadata-only Go v3 oracle catalog offline |
| `npm run parity:check` | Validate exhaustive legacy coverage and report objective TypeScript parity |
| `npm run result:check` | Validate the universal result schemas, 76 reason policies, and six exit examples |
| `npm run differential:check` | Run the offline synthetic differential self-test without the private oracle |
| `npm run build` | Rebuild the standalone runtime artifact |
| `npm run package:verify` | Inspect and execute the staged artifact outside the checkout |
| `npm run verify` | Run the complete offline validation chain in dependency order |

Run `npm run templates:validate` separately when Issue Forms or their validation
contract changes. It requires network access only to retrieve the immutable,
hash-verified schema snapshot; `npm run verify` remains reproducible offline
after `npm ci`.

## Pull-request CI

The [CI workflow](../../.github/workflows/ci.yml) runs on pull requests and
pushes targeting `developer` or `main`. It selects the exact Node version from
`.nvmrc`, verifies both Node and npm, installs with `npm ci`, and executes the
same repository commands documented above. Template schema validation remains a
distinct online step between coverage and build; CI does not hide additional
validation behavior from local contributors.

Checks run sequentially after one locked installation, so the first invalid
stage names the blocking concern directly. A failed trusted-branch or
same-repository pull-request run uploads the completed step logs plus any
existing coverage and build output as a diagnostic artifact for three days.
Fork pull requests keep their step logs in Actions but cannot upload artifacts,
which prevents untrusted code from substituting paths. Artifacts intentionally
exclude npm user logs, environment dumps, and secrets.

The workflow uses the `pull_request` event, read-only repository permissions,
no secret references, no persisted checkout credentials, and standard
GitHub-hosted runners. Superseded pull-request commits are cancelled; branch
pushes are allowed to finish. Those controls make contribution checks safe for
untrusted fork code without granting it repository write authority.

## Workspace ownership

```text
packages/contracts/  host-neutral public types and versioned constants
packages/adapters/   host adapter protocol boundary
packages/runtime/    deterministic runtime composition and CLI
packages/differential/ isolated validation, execution, capture, normalization, and comparison
schemas/             versioned public runtime contracts
fixtures/            compatibility and golden-scenario inputs
tests/               black-box tests of the final bundle
scripts/             deterministic build and package verification
```

All npm packages are private ESM workspaces. The root has no production
dependencies. Its exactly pinned development dependencies are compilers,
linters, formatters, the CSpell documentation checker, the Ajv JSON Schema and
YAML configuration parsers, test/coverage tools, type declarations, and the
bundler.
Only the exactly pinned esbuild installer is allowed to run a dependency
lifecycle script. npm treats uncovered scripts as installation errors and
explicitly denies the optional fsevents script recorded for macOS compatibility.
YAML `2.9.0` is used only by repository contract tests for GitHub configuration;
it is absent from the embedded runtime bundle.
Ajv `8.20.0` validates Issue Forms against a content-hash-verified schema
snapshot. That explicit online evidence command is separate from the offline
`verify` chain; both validation dependencies remain absent from the runtime.

## Frozen compatibility oracle

The [Go v3 baseline](../compatibility/go-v3-v0.6.5-baseline.md) freezes private
release `v0.6.5` by immutable Git identities, SHA-256 digests, counts, command
outputs, release binaries, and independently hashed PRD anchors. The public
catalog contains metadata only; it does not publish predecessor source, prompts,
schemas, fixtures, help prose, or binaries.

The normal offline verification chain validates this catalog without access to
the predecessor. Authorized maintainers can additionally give the verifier
explicit source, distribution, binary, and plugin-cache paths to recompute every
applicable digest. It never searches a home directory or downloads private
material. A frozen oracle establishes measurement identity; it does not claim
that TypeScript parity has already been implemented.

The [parity inventory](../compatibility/parity-inventory.md) maps 402 frozen
discovery keys into 400 owned and independently verifiable compatibility rows.
`npm run parity:check` rejects missing or duplicate coverage, incomplete P0/P1
requirements, invalid evidence references, and unsupported parity claims. It
currently reports `0 / 400 (0.00%)`: the worklist is complete, while behavior
implementation and differential evidence remain future work.

The [differential harness](../compatibility/differential-harness.md) now makes
Go-versus-TypeScript comparison executable. Public `npm run differential:check`
uses only an original synthetic fixture. Authorized live mode verifies an
explicit Go binary digest before measuring the bootstrap bundle and currently
reports the known help/version mismatch without granting parity.

The [universal result contract](../compatibility/result-contract.md) preserves
all 71 frozen reason names and predecessor exits 0 through 3, then adds five
runtime-only reasons and exits 4 and 5 for explicit recovery and concurrency.
`npm run result:check` validates its closed schemas, catalog policy, examples,
canonical ordering, and public-output safety offline.

## Runtime artifact

The build stages exactly three plugin files:

```text
dist/plugin/runtime/manifest.json
dist/plugin/runtime/yoda.core.mjs
dist/plugin/runtime/yoda.mjs
```

`runtime/yoda.mjs` is the executable entry point: a small interpreter gate that
dynamically imports `runtime/yoda.core.mjs`, the ESM bundle. Neither has a
runtime `node_modules`, global Yoda binary, checkout-relative import, source
map, or network requirement.

Package verification checks the file inventory, shebang, executable mode,
unsubstituted placeholders, forbidden references, external imports, and the core
digest recorded in the manifest. It then copies the whole `runtime` directory to
a temporary directory and executes `--help` and `--version` with module lookup
influences cleared, and asserts that a project the runtime operated on contains
no denied entry.

The [runtime distribution contract](../compatibility/runtime-distribution.md)
explains why the boot is split and what each inventory guarantees.

The runtime source is layered, and the layering is enforced by a test rather
than a convention: `domain` and `ports` cannot import Node builtins, and only an
entry point may import `composition`. See the
[runtime boundary contract](../architecture/runtime-boundaries.md).

The minimal help/version/handshake surface exists only to prove the toolchain.
Workflow commands, schemas, state, host behavior, and legacy compatibility
arrive in their dedicated backlog issues.

## Recovery

If generated output becomes stale, remove only `./dist` and `./coverage`, then
run `npm run verify`. If the installed dependency tree is inconsistent, `npm ci`
replaces it from `package-lock.json`; do not repair it by installing an unpinned
package. A Node or npm engine error means the exact prerequisite version must be
selected before retrying.
