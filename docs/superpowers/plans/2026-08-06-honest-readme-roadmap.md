# Honest README and Maturity Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the front page impossible to mistake for an installable product and publish objective Experimental-to-Stable promotion gates with reproducible spelling/link validation.

**Architecture:** README remains the concise project entrypoint and links a focused ROADMAP for evidence gates. A reader-contract test protects availability claims and command honesty; exactly pinned CSpell joins the deterministic development-only verification chain.

**Tech Stack:** Markdown, Vitest 4.1.10, CSpell 10.0.1, markdownlint, Lychee, existing Documentation GitHub Action.

## Global Constraints

- Keep all public text and tool configuration English.
- State that no supported installation, public distribution, production runtime, or usable SDD command exists today.
- Identify the current ESM bundle as internal smoke infrastructure supporting only `--help` and `--version`.
- Do not show planned install commands or private predecessor distribution commands.
- Preserve no-global-binary and project-owned `.brain/`, `.claude/`, `.codex/` architecture.
- Use only the real Documentation workflow badge; issue #7 owns the future Node workflow.
- Pin CSpell exactly at `10.0.1` as development-only and retain zero external runtime dependencies.
- Preserve the legacy PRD/spec parity and issue #4 provenance policy.
- Sign every commit under DCO 1.1.

---

### Task 1: Define a failing clean-room reader contract

**Files:**

- Create: `tests/readme-honesty.test.ts`

**Interfaces:**

- Consumes: `README.md`, future `ROADMAP.md`, and `package.json` as text.
- Produces: assertions for real badges, availability boundaries, working commands, architecture ownership, maturity gates, and acknowledgements.

- [x] **Step 1: Write the failing reader tests**

Read the three files from the repository root. Assert README contains these exact
boundaries:

```typescript
expect(readme).toContain("There is no supported installation method");
expect(readme).toContain("supports only `--help` and `--version`");
expect(readme).toContain("not runnable in the current bundle");
expect(readme).toContain("[Objective maturity gates](../../../ROADMAP.md)");
expect(readme).toContain("actions/workflows/docs.yml/badge.svg?branch=main");
expect(readme).not.toMatch(/claude plugin install|codex plugin add|npm install -g/);
```

Assert the README development shell block contains only `npm ci`,
`npm run spellcheck`, `npm run verify`, `npm run build`, and
`npm run package:verify`, and package text defines every named script. Assert
roadmap contains all four stages, `Promotion to Preview`, `Promotion to Beta`,
`Promotion to Stable`, every epic #1/#8/#15/#24/#34/#40/#48/#57, regression/
rollback rules, pilots, P0/P1 parity, and predecessor retirement.

- [x] **Step 2: Confirm RED**

Run: `npm test -- tests/readme-honesty.test.ts`

Expected: FAIL because `ROADMAP.md` does not exist.

### Task 2: Add deterministic English spelling validation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.cspell.json`
- Modify: `docs/development/toolchain.md`
- Modify: `docs/superpowers/specs/2026-08-06-typescript-toolchain-design.md`

**Interfaces:**

- Consumes: npm 11.16.0 strict install policy and tracked Markdown.
- Produces: `npm run spellcheck` and a `verify` chain that fails on unknown documentation words.

- [x] **Step 1: Pin CSpell and add scripts**

Add exact dev dependency `"cspell": "10.0.1"`, script
`"spellcheck": "cspell --no-progress --show-suggestions \"**/*.md\""`, and run
`npm run spellcheck` between formatting and lint in `verify`.

- [x] **Step 2: Configure narrow project vocabulary**

Create `.cspell.json` with version `0.2`, language `en,en-GB,en-US`,
`useGitignore: true`, explicit ignores for `node_modules`, `dist`, `coverage`,
and a sorted words list containing legitimate names such as `BetaUp`, `CODEOWNERS`,
`esbuild`, `metafile`, `MWTC`, `relicensing`, `TypeScript`, and `Vitest`. Do not
ignore README, ROADMAP, or all-uppercase words broadly.

- [x] **Step 3: Regenerate and verify the strict lockfile**

Using exact Node/npm:

```bash
npm install --package-lock-only
npm ci
npm run spellcheck
```

Expected: clean installation succeeds under strict lifecycle-script policy; the
spellcheck initially reports only genuine vocabulary/configuration gaps, which
are corrected narrowly until it passes.

- [x] **Step 4: Update toolchain documentation**

List CSpell `10.0.1` in the exact development dependencies and add `spellcheck`
to the command tables and clean verification sequence. State it scans tracked
Markdown and remains absent from the runtime bundle.

### Task 3: Publish the honest README and objective roadmap

**Files:**

- Modify: `README.md`
- Create: `ROADMAP.md`

**Interfaces:**

- Consumes: issue #5 design, phase epic exit criteria, real Documentation workflow, current smoke CLI.
- Produces: one entrypoint with truthful availability and one evidence-based maturity model.

- [x] **Step 1: Add the real workflow badge and current-state warning**

Link the badge image
`https://github.com/thiagocorreanet/kratos-harness/actions/workflows/docs.yml/badge.svg?branch=main`
to the real workflow page. Near the top state no installation/production/usable
SDD commands and smoke-only help/version.

- [x] **Step 2: Add Installation and Usage preview sections**

Installation contains no install command. Describe only the planned embedded
plugin model and issue #61 gate. Usage preview lists planned operations in prose
and labels them not runnable. Explicitly reject old private distribution
instructions for this public rewrite.

- [x] **Step 3: Expand Development with only working commands**

Show one shell block:

```bash
npm ci
npm run spellcheck
npm run verify
npm run build
npm run package:verify
```

Explain artifact path and that help/version prove packaging, not product readiness.

- [x] **Step 4: Write ROADMAP objective gates**

Create current Experimental status and promotion sections for Preview, Beta, and
Stable exactly as approved. Link the phase epics, define no-calendar/evidence-
only policy, regression rollback/degradation, known release gates, and Go oracle
retirement. Separate stage entry from promotion evidence.

- [x] **Step 5: Add acknowledgements and align FAQ/roadmap copy**

Credit the predecessor as behavioral oracle subject to provenance, the agent
hosts without endorsement implication, and Node/TypeScript/esbuild/ESLint/
Prettier/Vitest/CSpell plus Contributor Covenant/DCO. Ensure FAQ repeats no
installation and roadmap section links `[Objective maturity gates](../../../ROADMAP.md)`.

- [x] **Step 6: Confirm GREEN and commit**

```bash
npm test -- tests/readme-honesty.test.ts
npm run spellcheck
npm run typecheck
npm run lint
git add README.md ROADMAP.md tests/readme-honesty.test.ts package.json package-lock.json .cspell.json docs/development/toolchain.md docs/superpowers/specs/2026-08-06-typescript-toolchain-design.md
git commit -s -m "docs: publish honest README and maturity roadmap"
```

Expected: reader contract, spelling, typecheck, and lint pass.

### Task 4: Prove comprehension and publish

**Files:**

- Create: `docs/roadmap/verification.md`
- Modify: `docs/superpowers/plans/2026-08-06-honest-readme-roadmap.md`

**Interfaces:**

- Consumes: final README/ROADMAP and verification results.
- Produces: clean-room reader evidence and issue closure.

- [x] **Step 1: Run complete local verification**

```bash
npm run verify
npx --yes markdownlint-cli2@0.20.0 "README.md" "*.md" "docs/**/*.md" "schemas/**/*.md" "fixtures/**/*.md"
lychee --config .lychee.toml README.md ROADMAP.md docs schemas fixtures
git diff --check
```

Expected: all suites, spelling, Markdown, and links pass with zero errors.

- [x] **Step 2: Request two independent review lenses**

The code review checks issue/spec acceptance and command truth. The clean-room
reader receives only README/ROADMAP and answers: current maturity, whether/how it
can be installed, what commands work, where state/runtime live, and what promotes
each stage. Any answer that treats planned behavior as available is Important.

- [x] **Step 3: Record evidence**

Document branch/commit, test/spell/link counts, real badge URL/status, all
presented command executions, and both review outcomes. Include a table mapping
each reader answer to the exact README/ROADMAP evidence.

- [x] **Step 4: Publish, merge, and close**

Push `docs/issue-5-readme-roadmap`, open a DCO-signed PR with `Closes #5`, design/
compatibility impact, failure evidence, and exact results. Wait for the real
Documentation check, merge when green, confirm issue #5 closed, synchronize main,
and only then begin #6.
