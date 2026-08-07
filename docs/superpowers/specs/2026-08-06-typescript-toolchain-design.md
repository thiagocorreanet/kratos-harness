# TypeScript Repository and Deterministic Toolchain Design

- Status: Approved
- Decision date: 2026-08-06
- Tracking issue: [#3](https://github.com/thiagocorreanet/mestre-yoda/issues/3)
- Depends on: [Yoda Observable Architecture Specification](2026-08-06-yoda-observable-architecture-design.md)
- Approval basis: Maintainer-authorized autonomous recommendation

## 1. Outcome

A clean checkout installs one exactly locked development toolchain, validates
strict TypeScript, runs deterministic tests, and builds one executable ESM
runtime artifact at `dist/plugin/runtime/yoda.mjs`. The staged runtime executes
without a global Yoda binary, a repository checkout, a runtime `node_modules`,
or network access.

This issue establishes engineering infrastructure and a minimal `help`/`version`
smoke surface. It does not implement workflow state, commands, schemas, host
behavior, or other runtime contracts owned by later issues.

## 2. Approaches considered

| Approach | Advantages | Costs | Decision |
| --- | --- | --- | --- |
| One flat TypeScript package | Small initial file count and simple imports | Blurs runtime, contract, and host boundaries; encourages later refactoring | Rejected |
| npm workspaces with focused packages | Uses the package manager already shipped with Node, keeps boundaries explicit, supports one lockfile and one bundle | Requires small package manifests and workspace wiring | Selected |
| Nx or Turborepo monorepo | Rich task graph, caching, and generators | Adds a framework, daemon/cache behavior, and configuration before the repository needs them | Rejected |

The selected workspace is intentionally small. Task orchestration remains plain
npm scripts so every CI command is visible and reproducible.

## 3. Runtime and package-manager policy

### 3.1 Node.js

The minimum supported version is **Node.js 24.18.0**, the current latest LTS
release when this design was approved. Development and pull-request CI use that
exact patch version. `package.json` records `node >=24.18.0 <25`, and `.nvmrc`
and `.node-version` record `24.18.0`.

Mestre Yoda supports one LTS major during the experimental foundation. When a
new Node major becomes LTS, a dedicated compatibility change must update the
minimum, native-platform matrix, bundle smoke fixtures, and documentation in
one reviewed PR. Current or prerelease Node versions never become the minimum
implicitly.

This policy follows the official [Node.js release schedule](https://nodejs.org/en/about/previous-releases),
which recommends production use of Active or Maintenance LTS releases. Node 26
remains Current until October 2026 and is therefore not the baseline for this
issue.

### 3.2 npm

The package manager is **npm 11.16.0**, the version distributed with Node
24.18.0. The root manifest records `packageManager: npm@11.16.0` and
`engines.npm: 11.16.0`. `.npmrc` enables exact saves, the lockfile, and strict
engine enforcement.

Only `npm ci` is valid for clean or CI installation. Dependency changes use the
fixed npm version and commit the resulting lockfile. npm workspaces avoid a
Corepack or separately bootstrapped package-manager dependency.

## 4. TypeScript policy

The compiler is **TypeScript 6.0.2** through the official
`@typescript/typescript6` compatibility package aliased as `typescript`. The
script invokes its `tsc6` binary.

TypeScript 7.0.2 is intentionally deferred. The official
[TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
states that 7.0 does not expose a programmatic API and recommends the TypeScript
6 compatibility package for tools that still need it. The selected
`typescript-eslint` version requires TypeScript `<6.1.0`. Adopting TypeScript 7
before those constraints change would either create two competing compilers or
disable typed linting.

The root compiler configuration enables:

- `strict`;
- `noUncheckedIndexedAccess`;
- `exactOptionalPropertyTypes`;
- `noImplicitOverride`;
- `noFallthroughCasesInSwitch`;
- `noImplicitReturns`;
- `noUnusedLocals` and `noUnusedParameters`;
- `useUnknownInCatchVariables`;
- `verbatimModuleSyntax`;
- ESM/Node module semantics;
- no JavaScript input, no emit during type checking, and no unchecked library
  checking bypass.

`skipLibCheck` remains false. `allowJs`, `checkJs`, and escape-hatch compiler
flags remain disabled. Any future exception must be narrow, commented, and
approved as a contract change.

## 5. Repository layout

```text
packages/
├── contracts/
│   ├── package.json
│   └── src/
│       ├── index.ts
│       └── version.ts
├── adapters/
│   ├── package.json
│   └── src/
│       └── index.ts
└── runtime/
    ├── package.json
    └── src/
        ├── cli.test.ts
        ├── cli.ts
        └── main.ts
scripts/
├── build.mjs
└── verify-package.mjs
schemas/
└── README.md
fixtures/
└── README.md
tests/
└── bundle-smoke.test.ts
docs/
├── adr/
├── architecture/
├── development/
│   └── toolchain.md
└── superpowers/
```

- `@mestre-yoda/contracts` owns only host-neutral public types and versioned
  constants.
- `@mestre-yoda/adapters` owns the host adapter protocol boundary, with no
  Claude Code or Codex implementation in this issue.
- `@mestre-yoda/runtime` owns CLI composition and the minimal smoke surface.
- `schemas/` and `fixtures/` reserve documented ownership for later contract and
  compatibility issues; this issue does not invent schemas or fixture formats.
- `tests/` contains black-box tests of the final bundle. Focused unit tests stay
  beside their source.

All workspace packages are private and ESM. Internal package exports point to
TypeScript source during development; esbuild resolves and embeds them in the
final artifact.

## 6. Dependency policy

The repository has **zero production dependencies** in this issue. Every tool is
an exactly pinned root `devDependency`:

- `typescript` aliased to `@typescript/typescript6@6.0.2`;
- `@eslint/js@10.0.1`;
- `@types/node@24.13.3`;
- `eslint@10.8.0`;
- `typescript-eslint@8.66.0`;
- `prettier@3.9.6`;
- `vitest@4.1.10`;
- `@vitest/coverage-v8@4.1.10`;
- `esbuild@0.28.1`.

Version ranges are not permitted in manifests. The lockfile is the complete
transitive resolution. Automated dependency updates must change one logical
tool family at a time and run the entire verification suite.

npm's strict lifecycle-script allowlist permits only the exactly pinned
`esbuild@0.28.1` installer, which selects its locked native binary. The optional
`fsevents@2.3.3` script is explicitly denied for cross-platform lockfile
consistency. Any uncovered script fails installation until a reviewed manifest
change assigns an explicit allow or deny decision.

The runtime may import Node built-ins and internal workspace modules only.
Package verification rejects a staged artifact that references `node_modules`,
loads a repository-relative module, or requires a file outside the staged plugin
root.

## 7. Commands

The root manifest exposes the following deterministic commands:

| Command | Responsibility |
| --- | --- |
| `npm ci` | Install exactly the committed lockfile |
| `npm run format:check` | Check supported source and configuration files with Prettier |
| `npm run lint` | Run ESLint with type-aware TypeScript rules and zero warnings |
| `npm run typecheck` | Run `tsc6` with strict root configuration and no emit |
| `npm test` | Run unit and clean-room bundle tests once with Vitest |
| `npm run test:coverage` | Run deterministic coverage with configured thresholds |
| `npm run build` | Clean and generate `dist/plugin/runtime/yoda.mjs` with esbuild |
| `npm run package:verify` | Validate staged contents and execute help/version outside the checkout |
| `npm run verify` | Run format, lint, typecheck, tests, coverage, build, and package verification in order |

Commands do not download tools after `npm ci`, mutate dependency versions,
depend on a global package, or hide subprocess failures.

## 8. Minimal runtime smoke surface

`packages/runtime/src/cli.ts` exposes a pure `runCli` function that accepts
arguments and output/error writers and returns a process exit code. The
executable `main.ts` wrapper passes `process.argv` and Node streams to it.

Supported behavior in this issue is deliberately limited:

- no arguments or `--help` prints English usage and exits 0;
- `--version` prints `0.0.0-development` and exits 0;
- an unknown argument prints an actionable English error and exits 2;
- the module does not read project state, the network, environment secrets, or
  host-specific files.

The version constant lives in `@mestre-yoda/contracts` so the bundle and tests
share one value. This smoke surface is development infrastructure, not the final
command contract owned by later compatibility/runtime issues.

## 9. Build and package verification

`scripts/build.mjs` invokes the esbuild JavaScript API with the `main.ts` runtime entry,
ESM output, Node 24 target, bundled internal modules, a Unix shebang, a metafile,
and no source-map path leakage. It removes only the known `dist/plugin` staging
directory before building and makes the resulting file executable.

The staged plugin contains exactly one file for this issue:

```text
dist/plugin/runtime/yoda.mjs
```

`scripts/verify-package.mjs` verifies:

1. the staged tree contains exactly that regular file;
2. the file begins with the Node shebang and has executable permissions on
   POSIX systems;
3. the bundle contains no `node_modules` or source-workspace path reference;
4. esbuild metadata reports no external non-built-in import;
5. a temporary directory outside the repository can execute `--help` and
   `--version` with an empty module search path;
6. both commands exit 0 and produce the expected English output/version.

The package verifier never rewrites the staged artifact.

## 10. Testing and coverage

The test-first sequence begins with failing CLI behavior tests, followed by the
minimal implementation. Black-box tests then fail until the build and package
verification scripts create a standalone artifact.

Vitest runs in a single deterministic Node environment with no network use. V8
coverage includes the executable CLI decision logic and enforces 100%
statements, branches, functions, and lines for the minimal runtime smoke
surface. The process-only `main.ts` wrapper is proven by black-box execution;
type-only contract and adapter declarations are excluded from executable
coverage rather than credited as covered code.

The clean-room smoke test creates a temporary directory outside the checkout,
copies only `yoda.mjs`, sets its working directory there, clears module lookup
influences, and executes help/version. Passing from source or from a populated
workspace is insufficient.

## 11. Formatting and linting

Prettier owns TypeScript, JavaScript module scripts, JSON/JSONC, and workflow
YAML formatting. Markdown remains under markdownlint so the existing public
documentation is not mechanically rewritten by a source-code formatter.

ESLint uses flat configuration with the base recommended rules plus
type-aware strict TypeScript rules. Warnings fail the command. Explicit `any`,
unsafe assignment/calls/returns, floating promises, unhandled async work, and
type-only import inconsistencies are rejected.

Generated `dist/`, coverage output, and dependency directories are ignored by
formatting, linting, and Git.

## 12. CI boundary

This issue makes every command CI-compatible and documents the exact clean
sequence. The existing Documentation workflow continues validating Markdown and
links. Issue #7 owns the pull-request Node workflow, required-check behavior,
intentional failure evidence, cancellation policy, and fork validation after
this toolchain is merged.

This separation prevents a workflow from depending on scripts that do not exist
on its base branch. Issue #7 will run the same `npm ci` and `npm run verify`
commands rather than introduce CI-only behavior.

## 13. Documentation and clean-checkout evidence

`docs/development/toolchain.md` records prerequisites, exact versions, the clean
install/verify sequence, artifact path, dependency classification, and common
failure recovery. A contributor can reproduce acceptance with:

```bash
git clone https://github.com/thiagocorreanet/mestre-yoda.git
cd mestre-yoda
npm ci
npm run verify
```

Final evidence is collected from a fresh temporary clone of the feature commit
using Node 24.18.0 and npm 11.16.0. The verification records command versions,
test counts, coverage, artifact size/hash, help/version output, and staged file
inventory.

## 14. Compatibility and migration impact

No existing public runtime behavior changes because the TypeScript runtime did
not previously exist in this repository. The Go v3 baseline remains untouched
and continues to define later differential behavior.

The new package boundaries follow the approved plugin/runtime/adapter/contracts
ownership model. No `.brain/`, `.claude/`, `.codex/`, schema, event, reason-code,
or migration contract is introduced here. Future packages may extend the
workspace without changing the single-bundle distribution requirement.

## 15. Acceptance mapping

| Issue requirement | Design section |
| --- | --- |
| Node/npm policy and pinning | 3 |
| Focused repository boundaries | 5 |
| Strict TypeScript, ESM, lint, format, tests, coverage, bundle | 4, 7, 9–11 |
| Lockfile and deterministic scripts | 3, 6–7 |
| Development-only dependencies and no runtime `node_modules` | 6, 9 |
| Clean checkout succeeds | 13 |
| Single executable ESM artifact | 1, 9 |
| Help/version outside repository | 8–10 |
| Clean-room smoke test | 10 |
| CI-compatible verification | 7, 12–13 |
