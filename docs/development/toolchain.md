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
stage names the blocking concern directly. A failed run uploads the completed
step logs plus any existing coverage and build output as a diagnostic artifact
for three days. The artifact intentionally excludes npm user logs, environment
dumps, and secrets.

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

## Runtime artifact

The build stages exactly one plugin file:

```text
dist/plugin/runtime/yoda.mjs
```

It is an executable ESM bundle with no runtime `node_modules`, global Yoda
binary, checkout-relative import, source map, or network requirement. Package
verification checks the file inventory, shebang, executable mode, forbidden
references, external imports, size, and SHA-256. It then copies only the bundle
to a temporary directory and executes `--help` and `--version` with module lookup
influences cleared.

The minimal help/version surface exists only to prove the toolchain. Workflow
commands, schemas, state, host behavior, and legacy compatibility arrive in
their dedicated backlog issues.

## Recovery

If generated output becomes stale, remove only `./dist` and `./coverage`, then
run `npm run verify`. If the installed dependency tree is inconsistent, `npm ci`
replaces it from `package-lock.json`; do not repair it by installing an unpinned
package. A Node or npm engine error means the exact prerequisite version must be
selected before retrying.
