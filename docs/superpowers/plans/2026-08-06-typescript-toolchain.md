# Deterministic TypeScript Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible strict TypeScript workspace that emits and verifies one standalone executable ESM runtime bundle.

**Architecture:** Three private npm workspaces separate contracts, adapter boundaries, and runtime composition while a root-only development toolchain owns validation and bundling. The runtime exposes a pure CLI function for unit tests; esbuild embeds all internal code into `dist/plugin/runtime/yoda.mjs`, and a package verifier executes that one file outside the checkout.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, TypeScript 6.0.2 compatibility package, ESLint 10.8.0 with `@eslint/js` 10.0.1, typescript-eslint 8.66.0, Prettier 3.9.6, Vitest 4.1.10 with V8 coverage, esbuild 0.28.1.

## Global Constraints

- Pin Node.js to exactly 24.18.0 for development and CI; support only `>=24.18.0 <25`.
- Pin npm and `packageManager` to exactly 11.16.0 and use `npm ci` for clean installation.
- Keep every dependency development-only and exactly versioned; production dependencies remain empty.
- Use TypeScript 6.0.2 through `typescript: npm:@typescript/typescript6@6.0.2` and invoke `tsc6`.
- Preserve strict ESM compilation, including `skipLibCheck: false`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Stage exactly one executable file at `dist/plugin/runtime/yoda.mjs`; it must not need repository files, `node_modules`, or network access.
- Keep schemas, workflow behavior, host implementations, and legacy migration out of this issue.
- Do not add the Node GitHub Actions workflow; issue #7 owns that workflow after these commands exist on the base branch.

---

### Task 1: Pin the workspace and strict development toolchain

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.prettierignore`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/adapters/package.json`
- Create: `packages/runtime/package.json`

**Interfaces:**

- Consumes: the exact version and dependency policy in the approved design.
- Produces: root commands `format:check`, `lint`, `typecheck`, `test`, `test:coverage`, `build`, `package:verify`, and `verify`; workspace names `@mestre-yoda/contracts`, `@mestre-yoda/adapters`, and `@mestre-yoda/runtime`.

- [x] **Step 1: Add the pinned manifests and runtime selectors**

Create the root manifest with no `dependencies`, exact `devDependencies`, an
strict `allowScripts` policy permitting only `esbuild@0.28.1`, explicitly
denying `fsevents@2.3.3`, and this command graph:

```json
{
  "name": "mestre-yoda",
  "version": "0.0.0-development",
  "private": true,
  "type": "module",
  "packageManager": "npm@11.16.0",
  "engines": {
    "node": ">=24.18.0 <25",
    "npm": "11.16.0"
  },
  "workspaces": ["packages/*"],
  "scripts": {
    "format:check": "prettier --check .",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc6 --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "build": "node scripts/build.mjs",
    "package:verify": "node scripts/verify-package.mjs",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:coverage && npm run build && npm run package:verify"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "esbuild": "0.28.1",
    "eslint": "10.8.0",
    "prettier": "3.9.6",
    "typescript": "npm:@typescript/typescript6@6.0.2",
    "typescript-eslint": "8.66.0",
    "vitest": "4.1.10"
  },
  "allowScripts": {
    "esbuild@0.28.1": true,
    "fsevents@2.3.3": false
  }
}
```

Each workspace manifest is private, ESM, and exports its TypeScript source. Use `@mestre-yoda/contracts` as the runtime workspace dependency with version `0.0.0-development`; adapters has no dependencies.

- [x] **Step 2: Add deterministic environment and ignore files**

Write `24.18.0` to both `.nvmrc` and `.node-version`. Configure `.npmrc` with `engine-strict=true`, `package-lock=true`, `save-exact=true`, `strict-allow-scripts=true`, `audit=false`, and `fund=false`. Ignore only generated/dependency material:

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
```

Set UTF-8, LF, final newlines, and two-space indentation in `.editorconfig`; exclude `.git`, `node_modules`, `dist`, `coverage`, Markdown, and the lockfile from Prettier.

- [x] **Step 3: Add strict compiler, lint, format, and coverage configuration**

Configure TypeScript with `target: ES2024`, `lib: ["ES2024"]`, `module` and `moduleResolution: "NodeNext"`, `types: ["node"]`, `strict: true`, all strict flags listed in the global constraints, `verbatimModuleSyntax: true`, `allowJs: false`, `checkJs: false`, `noEmit: true`, and `skipLibCheck: false`. Include `packages/**/*.ts`, `scripts/**/*.mjs`, `tests/**/*.ts`, and `vitest.config.ts`.

Use ESLint flat configuration with `eslint.configs.recommended`, `typescript-eslint.configs.strictTypeChecked`, and `typescript-eslint.configs.stylisticTypeChecked`; ignore generated directories and enable project-service typed linting. Configure Vitest for the Node environment, single-process deterministic execution, executable runtime coverage only, and 100% statements/branches/functions/lines thresholds.

- [x] **Step 4: Generate the lockfile with the pinned toolchain**

Run with Node 24.18.0 and npm 11.16.0:

```bash
npm install --package-lock-only
npm ci
node --version
npm --version
npm ls --depth=0
```

Expected: versions are `v24.18.0` and `11.16.0`; installation uses only the committed resolution; all nine root development dependencies are present and there are no production dependencies.

- [x] **Step 5: Commit the toolchain foundation**

```bash
git add package.json package-lock.json .nvmrc .node-version .npmrc .editorconfig .gitignore .prettierignore tsconfig.json eslint.config.mjs vitest.config.ts packages/*/package.json
git commit -m "build: establish deterministic TypeScript workspace"
```

### Task 2: Implement the minimal CLI through unit-test TDD

**Files:**

- Create: `packages/contracts/src/version.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/runtime/src/cli.test.ts`
- Create: `packages/runtime/src/cli.ts`
- Create: `packages/runtime/src/main.ts`

**Interfaces:**

- Consumes: workspace import `@mestre-yoda/contracts` from Task 1.
- Produces: `YODA_VERSION: "0.0.0-development"`, `TextWriter = (text: string) => void`, and `runCli(args: readonly string[], output: TextWriter, error: TextWriter): number`.

- [x] **Step 1: Write failing CLI behavior tests**

Create tests that capture output and assert these exact cases:

```typescript
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";

function invoke(args: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runCli(args, (text) => stdout.push(text), (text) => stderr.push(text));
  return { exitCode, stderr: stderr.join(""), stdout: stdout.join("") };
}

describe("runCli", () => {
  it.each([[], ["--help"]])("prints help for %j", (args) => {
    expect(invoke(args)).toEqual({ exitCode: 0, stderr: "", stdout: "Usage: yoda [--help | --version]\n" });
  });

  it("prints the development version", () => {
    expect(invoke(["--version"])).toEqual({ exitCode: 0, stderr: "", stdout: "0.0.0-development\n" });
  });

  it("rejects an unknown argument", () => {
    expect(invoke(["start"])).toEqual({
      exitCode: 2,
      stderr: "Unknown argument: start. Run yoda --help for usage.\n",
      stdout: ""
    });
  });
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- packages/runtime/src/cli.test.ts`

Expected: FAIL because `packages/runtime/src/cli.ts` does not exist.

- [x] **Step 3: Add the minimal host-neutral contract and CLI implementation**

Export `YODA_VERSION` from contracts and implement the exact behavior under test. The executable `main.ts` passes `process.argv.slice(2)` and stream writers to `runCli` and assigns the returned value to `process.exitCode`. Keep `packages/adapters/src/index.ts` as a type-only boundary exporting:

```typescript
export interface HostAdapter {
  readonly name: string;
}
```

- [x] **Step 4: Run tests and strict static checks**

```bash
npm test -- packages/runtime/src/cli.test.ts
npm run typecheck
npm run lint
```

Expected: four CLI cases pass; TypeScript and ESLint exit 0 with no warnings.

- [x] **Step 5: Commit the tested smoke surface**

```bash
git add packages/contracts/src packages/adapters/src packages/runtime/src
git commit -m "feat: add minimal runtime smoke CLI"
```

### Task 3: Bundle and verify the isolated runtime through black-box TDD

**Files:**

- Create: `tests/bundle-smoke.test.ts`
- Create: `scripts/build.mjs`
- Create: `scripts/verify-package.mjs`

**Interfaces:**

- Consumes: `packages/runtime/src/cli.ts`, exact CLI text, and the output path from Tasks 1–2.
- Produces: executable `dist/plugin/runtime/yoda.mjs`, `dist/build-meta.json`, and a package verifier that fails on unexpected staged content or external runtime dependencies.

- [x] **Step 1: Write the failing clean-room bundle test**

The test runs `node scripts/build.mjs`, creates a temporary directory with `mkdtemp`, copies only `dist/plugin/runtime/yoda.mjs`, and invokes it with `cwd` set to that directory and an environment containing only a safe `PATH`, `HOME`, `TMPDIR`, and empty `NODE_PATH`/`NODE_OPTIONS`. Assert `--help` and `--version` exit 0 with exact stdout and empty stderr; always remove the temporary directory in `finally`.

- [x] **Step 2: Confirm the black-box test is RED**

Run: `npm test -- tests/bundle-smoke.test.ts`

Expected: FAIL because `scripts/build.mjs` does not exist.

- [x] **Step 3: Implement deterministic bundling**

Use the esbuild API with:

```javascript
await build({
  absWorkingDir: repositoryRoot,
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  entryPoints: ["packages/runtime/src/main.ts"],
  format: "esm",
  logLevel: "info",
  metafile: true,
  outfile: "dist/plugin/runtime/yoda.mjs",
  platform: "node",
  sourcemap: false,
  target: "node24"
});
```

Resolve `repositoryRoot` from `import.meta.url`, remove only `dist/plugin`, recreate its runtime directory, write stable pretty-printed metadata to `dist/build-meta.json`, and set mode `0o755` on POSIX.

- [x] **Step 4: Implement staged-package verification**

Recursively inventory `dist/plugin` without following symlinks and require exactly `runtime/yoda.mjs`. Check the shebang, POSIX executable bits, forbidden strings `node_modules`, `/packages/`, and `\\packages\\`; inspect `dist/build-meta.json` and reject any output import whose `external` value is true unless its path starts with `node:`. Copy the artifact to a new temporary directory and spawn help/version with the same clean environment as the test. On success print the artifact SHA-256, byte size, inventory, help line, and version.

- [x] **Step 5: Run the full bundle checks**

```bash
npm test -- tests/bundle-smoke.test.ts
npm run build
npm run package:verify
find dist/plugin -type f -print
```

Expected: bundle smoke passes; package verification prints one SHA-256 and reports only `runtime/yoda.mjs`; `find` prints exactly `dist/plugin/runtime/yoda.mjs`.

- [x] **Step 6: Commit bundle construction and verification**

```bash
git add scripts/build.mjs scripts/verify-package.mjs tests/bundle-smoke.test.ts
git commit -m "build: verify standalone runtime bundle"
```

### Task 4: Document repository ownership and reproducible contribution

**Files:**

- Create: `schemas/README.md`
- Create: `fixtures/README.md`
- Create: `docs/development/toolchain.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: exact versions, commands, paths, and scope boundary from Tasks 1–3.
- Produces: clean-checkout instructions and discoverable ownership boundaries without defining premature schemas or fixtures.

- [x] **Step 1: Document reserved directory ownership**

State that `schemas/` will own versioned public runtime contracts and `fixtures/` will own compatibility/golden inputs, but that neither format is introduced by issue #3. Link both documents to the canonical architecture specification.

- [x] **Step 2: Write the contributor toolchain guide**

Document Node 24.18.0 and npm 11.16.0 prerequisites, `npm ci`, every root command and its purpose, the exact four-command clean-checkout flow, the zero-production-dependency policy, output path, clean-room guarantees, and recovery by removing only `node_modules`, `dist`, and `coverage` before rerunning `npm ci`. Explain that issue #7 will add Node CI using these same commands.

- [x] **Step 3: Update top-level project navigation and status**

Change the TypeScript deterministic runtime status from `Planned` to `Foundation available`, link the status to `docs/development/toolchain.md`, and add a short Development section linking the toolchain guide without claiming the runtime workflow is implemented.

- [x] **Step 4: Validate documentation and formatting**

```bash
npx --no-install markdownlint-cli2 "README.md" "docs/**/*.md" "schemas/**/*.md" "fixtures/**/*.md"
npx --no-install lychee --config .lychee.toml README.md docs schemas fixtures
npm run format:check
```

Expected: markdownlint reports zero errors, Lychee reports no excluded/failing links, and Prettier reports all matched source/config files formatted.

- [x] **Step 5: Commit contributor documentation**

```bash
git add README.md docs/development/toolchain.md schemas/README.md fixtures/README.md
git commit -m "docs: explain deterministic development workflow"
```

### Task 5: Prove reproducibility from a clean checkout

**Files:**

- Modify only if verification exposes a defect: files introduced in Tasks 1–4.

**Interfaces:**

- Consumes: the committed lockfile and all root verification commands.
- Produces: acceptance evidence suitable for the pull request and issue closure.

- [x] **Step 1: Run the complete repository verification**

```bash
npm run verify
git diff --check
git status --short
```

Expected: formatting, lint, strict typecheck, unit/black-box tests, 100% configured runtime coverage, build, and package verification all pass; diff check is empty; only intentional source changes are present.

- [x] **Step 2: Verify from a fresh temporary clone of the feature commit**

Commit any final corrections, clone the repository locally into a directory created by `mktemp -d`, check out the exact feature commit, and run with Node 24.18.0/npm 11.16.0:

```bash
npm ci
npm run verify
find dist/plugin -type f -print
sha256sum dist/plugin/runtime/yoda.mjs
dist/plugin/runtime/yoda.mjs --help
dist/plugin/runtime/yoda.mjs --version
```

Expected: the clean install and full suite pass; one artifact is listed; help prints `Usage: yoda [--help | --version]`; version prints `0.0.0-development`.

- [x] **Step 3: Check forbidden dependency and placeholder patterns**

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|node_modules|/packages/|\\\\packages\\\\' package.json packages scripts tests docs/development schemas fixtures dist/plugin/runtime/yoda.mjs
npm ls --omit=dev --all
```

Expected: no unresolved placeholders or forbidden bundle references; npm reports the root project with no production dependency tree. Documentation may mention `node_modules` only in the explicit clean-up/package-guarantee explanation and must be reviewed rather than blindly rejected.

- [ ] **Step 4: Request independent review and publish**

Use `superpowers:requesting-code-review` against the issue #3 acceptance criteria. Resolve every validated finding, rerun `npm run verify`, push `feat/issue-3-typescript-toolchain`, open a pull request containing the clean-room evidence, wait for all available checks, merge only when green, and confirm issue #3 is closed before beginning issue #4.
