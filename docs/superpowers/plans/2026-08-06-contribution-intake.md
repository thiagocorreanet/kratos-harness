# Contribution Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public issue and pull request arrive with typed context, safe routing, deterministic evidence, and a stable work-taxonomy reference.

**Architecture:** GitHub-native Issue Forms and one PR template remain static repository artifacts. A Vitest contract parses every YAML form, enforces the supported schema subset and repository policy, and renders temporary local drafts; a contributor guide owns labels, milestones, IDs, and the proposed branch flow.

**Tech Stack:** GitHub Issue Forms YAML, Markdown, TypeScript, Vitest 4.1.10, YAML 2.9.0, GitHub community profile/template APIs.

## Global constraints

- Keep every public artifact and test in normative English.
- Do not expose a public vulnerability intake path or collect sensitive details.
- Do not claim `developer` or branch protection exists before issue #60.
- Preserve the private Go predecessor only as a behavioral oracle; do not copy private prose.
- Keep YAML development-only and retain zero production dependencies.
- Do not alter runtime, state, migration, host, or PRD/spec behavior.
- Sign every commit under DCO 1.1.

---

### Task 1: Add deterministic YAML parsing

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/development/toolchain.md`
- Modify: `docs/superpowers/specs/2026-08-06-typescript-toolchain-design.md`

**Interfaces:**

- Consumes: exact npm lockfile and Issue Form YAML.
- Produces: one development-only YAML parser available to Vitest.

- [ ] **Step 1: Pin YAML exactly**

Add `"yaml": "2.9.0"` to root `devDependencies`. Do not add a production
dependency or a new public script.

- [ ] **Step 2: Regenerate and verify the lockfile**

Using exact Node/npm:

```bash
npm install --package-lock-only
npm ci
npm ls yaml --depth=0
```

Expected: YAML resolves exactly to `2.9.0`; strict lifecycle policy still passes.

- [ ] **Step 3: Update the toolchain contract**

List YAML 2.9.0 as the development-only configuration parser and state that it
does not enter the embedded runtime bundle.

### Task 2: Define the failing GitHub contribution contract

**Files:**

- Create: `tests/github-contribution-contract.test.ts`

**Interfaces:**

- Consumes: `.github/ISSUE_TEMPLATE/*.yml`, PR template, workflow guide, package manifest.
- Produces: schema, policy, discovery, and local draft assertions.

- [ ] **Step 1: Write schema-subset helpers**

Parse YAML with `parseDocument`, reject parser warnings/errors, require object
roots, and validate exactly the GitHub-supported form keys and body element
types. Validate unique kebab-case IDs, required attributes, option shapes,
existing labels, and form-level names/descriptions/titles.

- [ ] **Step 2: Write intake-policy tests**

Assert exact form inventory plus `config.yml`; blank issues disabled; the first
contact link is private vulnerability reporting. Assert each form contains its
designated reproduction/acceptance IDs and safe required checkboxes. Assert the
security-safe form cannot be mistaken for confidential reporting.

- [ ] **Step 3: Write PR/workflow contract tests**

Assert PR headings for issue/work ID, design, compatibility, state/migration/
security, deterministic tests, model evaluations, failure evidence, provenance,
DCO, English, and focused scope. Assert workflow guide contains the complete
label taxonomy, nine milestones, ten work-ID streams, immutability/no reuse, and
the proposed `developer` to `main` boundary owned by issue #60.

- [ ] **Step 4: Write local draft rendering test**

For each form, render a filled Markdown draft into an OS temporary directory,
assert every required non-Markdown field has a visible heading/value, then remove
the tree in `finally`. No GitHub issue or notification is created.

- [ ] **Step 5: Confirm RED**

Run: `npm test -- tests/github-contribution-contract.test.ts`

Expected: FAIL because `.github/ISSUE_TEMPLATE` and the PR/workflow templates do
not exist.

### Task 3: Implement the five Issue Forms

**Files:**

- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/compatibility.yml`
- Create: `.github/ISSUE_TEMPLATE/security-safe.yml`
- Create: `.github/ISSUE_TEMPLATE/documentation.yml`

**Interfaces:**

- Consumes: GitHub Issue Form schema and approved governance/security policy.
- Produces: exactly five discoverable public forms and two non-issue contact links.

- [ ] **Step 1: Configure the chooser**

Set `blank_issues_enabled: false`. Put private vulnerability reporting first and
the repository support policy second.

- [ ] **Step 2: Implement bug and compatibility forms**

Bug requires affected version/commit, environment, minimal reproduction,
expected/actual behavior, regression test/evidence, and policy confirmations.
Compatibility additionally requires oracle/provenance boundary, exact input,
expected/observed result, severity class, and redacted differential evidence.

- [ ] **Step 3: Implement feature and documentation forms**

Feature requires problem, outcome, alternatives, objective acceptance evidence,
and contract/state/migration/security impact. Documentation requires location,
audience problem, proposed change, acceptance evidence, and safety confirmation.

- [ ] **Step 4: Implement the security-safe form**

Use a public-hardening title and prominent private-report URL. Require safe scope,
desired hardening, acceptance evidence, and attestations that no suspected
vulnerability, exploit, secret, customer/private data, or confidential source is
present.

### Task 4: Implement pull-request and taxonomy documentation

**Files:**

- Create: `.github/pull_request_template.md`
- Create: `docs/contributing/workflow.md`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: contribution/governance policy and current GitHub labels/milestones.
- Produces: one review contract and one authoritative taxonomy/branch guide.

- [ ] **Step 1: Write the PR template**

Add all design-required sections and separate deterministic tests from prompt/
model evaluations. Include closing reference, stable work ID, compatibility,
risk, migration, security, rollback, failure evidence, provenance, DCO, English,
documentation, and focused-scope confirmations.

- [ ] **Step 2: Document labels and milestones**

Inventory every current namespaced and GitHub intake/community label with usage
rules. Document the nine public milestones as evidence campaigns without date
promises and one-milestone ownership.

- [ ] **Step 3: Document stable IDs and proposed branches**

Specify `[STREAM-NN]`, all ten streams, immutable/no-reuse allocation, and
`[EPIC]`. Document short-lived branch names, proposed integration into
`developer`, approved release PRs into `main`, and issue #60 ownership. State the
current repository/PR instructions control until activation.

- [ ] **Step 4: Link the workflow entrypoint**

Add the guide to CONTRIBUTING and the README contribution path without expanding
the installation or product-readiness claims.

- [ ] **Step 5: Confirm GREEN and commit**

```bash
npm test -- tests/github-contribution-contract.test.ts
npm run spellcheck
npm run typecheck
npm run lint
git add .github package.json package-lock.json tests docs CONTRIBUTING.md README.md
git commit -s -m "docs: add structured contribution intake"
```

Expected: all contract tests and focused static checks pass.

### Task 5: Verify, review, publish, and prove GitHub discovery

**Files:**

- Create: `docs/contributing/verification.md`
- Modify: `docs/superpowers/plans/2026-08-06-contribution-intake.md`

**Interfaces:**

- Consumes: final templates, checks, independent review, GitHub APIs.
- Produces: reproducible local and platform discovery evidence and issue closure.

- [ ] **Step 1: Run complete local verification**

```bash
npm run verify
npx --yes markdownlint-cli2@0.20.0 "README.md" "*.md" "docs/**/*.md"
lychee --config .lychee.toml './**/*.md'
git diff --check
```

Expected: full suite, spelling, Markdown, links, package, and whitespace pass.

- [ ] **Step 2: Request independent review**

Review issue/design/plan acceptance, YAML schema fidelity, security routing,
command truth, label/milestone/ID rules, and proposed-vs-active branch wording.
Resolve every finding and rerun affected plus complete checks.

- [ ] **Step 3: Record pre-merge evidence**

Record exact versions, test/file/link counts, local temporary draft inventory,
form labels/required fields, review outcome, DCO trailers, and no production
dependency/runtime-bundle change.

- [ ] **Step 4: Publish, merge, and close**

Push `docs/issue-6-contribution-templates`, open a signed PR with `Closes #6`,
wait for all available checks, merge, confirm issue #6 closed, and synchronize
`main`.

- [ ] **Step 5: Prove platform discovery post-merge**

Use GitHub's issue-template and community-profile APIs to verify exactly five
forms plus recognized issue/PR template paths on `main`. Record the merged commit
and green workflow, publish the evidence follow-up, then begin issue #7.
