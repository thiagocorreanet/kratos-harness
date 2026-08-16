# Yoda Observable Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue #2 with an approved canonical architecture specification, four accepted ADRs, documentation CI, and reproducible lint, link, and manual-trace evidence.

**Architecture:** Keep the approved canonical specification at `docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md`, record each structural choice in one focused ADR, and make the README the navigation entrypoint. Add one least-privilege documentation workflow now; later TypeScript, platform, security, compatibility, nightly, and release workflows remain owned by their dependency-ordered backlog issues.

**Tech Stack:** Markdown, Mermaid, GitHub Actions, markdownlint-cli2 0.23.2, Lychee 0.24.2, actionlint 1.7.7, Bash verification commands

## Global Constraints

- All repository content, workflow names, comments, commit messages, and PR text are English-only.
- Preserve the Go v3 phase order `research -> prd -> spec -> review -> code -> eval -> done`.
- Preserve PRD Problem Discovery, adaptive 5 Whys, 5W2H, structured output, blocking/open question semantics, lineage, and content-bound human approval.
- Runtime development is TypeScript, but distribution is one self-contained ESM JavaScript artifact with no global Yoda binary and no runtime `node_modules`.
- Project state lives under project-owned `.brain/`; host wiring lives under `.claude/` and `.codex/`; runtime, schemas, skills, adapters, and templates remain plugin-owned.
- No runtime implementation code is part of issue #2.
- Third-party GitHub Actions are pinned to immutable commit SHAs, workflow permissions are read-only, and jobs have explicit timeouts and fork-safe behavior.
- The documentation workflow must not claim to validate TypeScript, platform, compatibility, security, or release behavior before those suites exist.

---

## File map

- `docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md`: canonical architecture and milestone traceability.
- `docs/adr/0001-event-sourced-project-history.md`: event log authority and derived snapshots.
- `docs/adr/0002-embedded-esm-runtime.md`: TypeScript development and self-contained ESM distribution.
- `docs/adr/0003-project-local-brain-state.md`: in-project `.brain/` ownership and legacy migration boundary.
- `docs/adr/0004-host-adapter-boundary.md`: host-neutral core and Claude Code/Codex adapters.
- `docs/adr/README.md`: ADR index and lifecycle rules.
- `docs/architecture/verification.md`: required manual end-to-end trace and reproducible evidence commands.
- `.markdownlint-cli2.jsonc`: repository Markdown policy.
- `.lychee.toml`: deterministic link-check policy and retry behavior.
- `.github/workflows/docs.yml`: documentation quality workflow.
- `README.md`: links to the canonical architecture, ADR index, and verification evidence.

### Task 1: Record the four architecture decisions

**Files:**

- Create: `docs/adr/0001-event-sourced-project-history.md`
- Create: `docs/adr/0002-embedded-esm-runtime.md`
- Create: `docs/adr/0003-project-local-brain-state.md`
- Create: `docs/adr/0004-host-adapter-boundary.md`
- Create: `docs/adr/README.md`

**Interfaces:**

- Consumes: Sections 4–7 and 11 of the canonical architecture specification.
- Produces: Five stable relative paths used by the README, verification document, and future implementation issues.

- [ ] **Step 1: Run the ADR presence check and observe failure**

Run:

```bash
for file in \
  docs/adr/0001-event-sourced-project-history.md \
  docs/adr/0002-embedded-esm-runtime.md \
  docs/adr/0003-project-local-brain-state.md \
  docs/adr/0004-host-adapter-boundary.md; do
  test -s "$file" || { echo "missing: $file"; exit 1; }
done
```

Expected: FAIL on `docs/adr/0001-event-sourced-project-history.md`.

- [ ] **Step 2: Write ADR 0001**

Create `docs/adr/0001-event-sourced-project-history.md` with status `Accepted`, the context that mutable state alone cannot prove why a decision occurred, and this exact decision:

```markdown
## Decision

Each run owns an append-only, hash-linked event stream as its authoritative history. A validated `state.json` snapshot accelerates startup but is derived from the event cursor and hash. Markdown checkboxes, status pages, dashboards, and summaries are regenerable views.

Every committed decision event records normalized inputs, contract and policy versions, prior and resulting state identities, stable reason code, effect summary, artifact digests, and observed host/model identity when available. Events reference sensitive evidence by digest. The hash chain detects mutation; it does not authenticate an author.
```

Record consequences: deterministic replay, auditable recovery, additional transaction discipline, explicit corruption handling, and future signed attestations remaining separate.

- [ ] **Step 3: Write ADR 0002**

Create `docs/adr/0002-embedded-esm-runtime.md` with status `Accepted` and this exact decision:

```markdown
## Decision

Develop the runtime and supporting packages in strict TypeScript and distribute the executable runtime as one self-contained JavaScript ESM file at `runtime/yoda.mjs` inside the installed plugin. Runtime execution must not require TypeScript sources, a global `yoda` binary, project-local dependencies, a runtime `node_modules`, or network access.

The plugin manifest binds the plugin, runtime, schema, skill, adapter, and template versions. Black-box tests execute the final bundle from a clean fixture before release.
```

Record consequences: version coherence and easy installation, a required bundling/package-verification pipeline, source maps handled as release artifacts, and rejection of global Go/Node CLI and unbundled package alternatives.

- [ ] **Step 4: Write ADR 0003**

Create `docs/adr/0003-project-local-brain-state.md` with status `Accepted` and this exact decision:

```markdown
## Decision

Project-specific Yoda state lives under `.brain/` inside the user project. Claude Code wiring lives under `.claude/`, and Codex wiring lives under `.codex/`. Runtime code, schemas, skills, adapters, and templates remain plugin-owned.

The Go v3 sibling `<repo>-brain/.brain/` layout is a legacy source only. Migration is explicit, previewable, backed up, transactional, verified, and reversible. Discovery never mutates either location.
```

Record consequences: portable project state and simpler discovery, explicit repository privacy/ignore policy, managed-path confinement, and a migration obligation before Go retirement.

- [ ] **Step 5: Write ADR 0004**

Create `docs/adr/0004-host-adapter-boundary.md` with status `Accepted` and this exact decision:

```markdown
## Decision

The decision engine, reducers, contracts, state services, and result semantics are host-neutral. Claude Code and Codex integrate through thin adapters that translate invocation, capability discovery, observed identity, and response rendering. Adapters never own transition policy and never mutate canonical state directly.

Both adapters must pass one shared conformance suite. A future host is added by implementing the same versioned adapter protocol rather than branching the core.
```

Record consequences: behavioral parity across hosts, explicit capability gaps, no lowest-common-denominator weakening, and host-specific E2E tests in addition to shared conformance tests.

- [ ] **Step 6: Write the ADR index**

Create `docs/adr/README.md` with an `# Architecture Decision Records` heading, links and one-sentence summaries for ADRs 0001–0004, and lifecycle rules: accepted ADRs are immutable; superseding decisions add a new ADR and link both directions; structural implementation PRs cite the governing ADR.

- [ ] **Step 7: Re-run the ADR presence and decision checks**

Run:

```bash
for file in docs/adr/000{1,2,3,4}-*.md; do
  test -s "$file"
  rg -q '^Status: Accepted$' "$file"
  rg -q '^## Decision$' "$file"
  rg -q '^## Consequences$' "$file"
done
```

Expected: PASS with exit code 0.

- [ ] **Step 8: Commit the ADRs**

```bash
git add docs/adr
git commit -m "docs: record foundational architecture decisions"
```

### Task 2: Add documentation quality automation

**Files:**

- Create: `.markdownlint-cli2.jsonc`
- Create: `.lychee.toml`
- Create: `.github/workflows/docs.yml`
- Modify: `docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md`

**Interfaces:**

- Consumes: Markdown files and HTTP/file links in the repository.
- Produces: Required `Documentation` workflow check and local commands identical to CI tool versions.

- [ ] **Step 1: Run Markdown lint without repository configuration**

Run:

```bash
npx --yes markdownlint-cli2@0.23.2 '**/*.md'
```

Expected: FAIL on existing intentional formatting such as long lines or inline HTML, proving the check is active before policy configuration.

- [ ] **Step 2: Add the Markdown policy**

Create `.markdownlint-cli2.jsonc`:

```jsonc
{
  "config": {
    "default": true,
    "MD013": false,
    "MD024": {
      "siblings_only": true
    },
    "MD033": {
      "allowed_elements": [
        "p",
        "img"
      ]
    }
  },
  "globs": [
    "**/*.md",
    "!node_modules"
  ]
}
```

This keeps structural rules enabled while allowing the README's centered image and prose that must preserve literal commands and URLs.

- [ ] **Step 3: Add the link policy**

Create `.lychee.toml`:

```toml
no_progress = true
max_retries = 3
retry_wait_time = 2
timeout = 20
max_concurrency = 8
accept = ["200..=204"]
include_fragments = "full"
include_mail = false
```

- [ ] **Step 4: Add the documentation workflow**

Create `.github/workflows/docs.yml`:

```yaml
name: Documentation

on:
  pull_request:
    branches: [developer, main]
    paths:
      - "**/*.md"
      - ".markdownlint-cli2.jsonc"
      - ".lychee.toml"
      - ".github/workflows/docs.yml"
  push:
    branches: [developer, main]
    paths:
      - "**/*.md"
      - ".markdownlint-cli2.jsonc"
      - ".lychee.toml"
      - ".github/workflows/docs.yml"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: docs-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  documentation:
    name: Markdown and links
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Lint Markdown
        uses: DavidAnson/markdownlint-cli2-action@21c1be1b93ad9ed58fa840aacc3f279cde2a72ff # v24.2.0
        with:
          globs: |
            **/*.md
            #node_modules
      - name: Check links
        uses: lycheeverse/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8 # v2.9.0
        with:
          args: --config .lychee.toml './**/*.md'
          fail: true
          failIfEmpty: true
          jobSummary: true
```

- [ ] **Step 5: Run Markdown lint and fix only reported violations**

Run:

```bash
npx --yes markdownlint-cli2@0.23.2 '**/*.md'
```

Expected: PASS with `Summary: 0 error(s)` after minimal formatting fixes.

- [ ] **Step 6: Validate workflow semantics**

Run:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/docs.yml
```

Expected: PASS with no output.

- [ ] **Step 7: Check links with the pinned Lychee release**

Run Lychee 0.24.2 against `./**/*.md` using `.lychee.toml`. Expected: PASS with zero excluded broken local links and zero failed links. If an external service returns a reproducible rate-limit response, configure only that exact host/status behavior and document the reason; do not add a blanket URL exclusion.

- [ ] **Step 8: Commit documentation automation**

```bash
git add .github/workflows/docs.yml .markdownlint-cli2.jsonc .lychee.toml docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md
git commit -m "ci: validate project documentation"
```

### Task 3: Add trace evidence and navigation

**Files:**

- Create: `docs/architecture/verification.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md`

**Interfaces:**

- Consumes: The canonical command flow, state model, event contract, and ADR links.
- Produces: A reproducible host-to-response trace and discoverable public architecture entrypoints.

- [ ] **Step 1: Prove navigation and trace evidence are absent**

Run:

```bash
test -s docs/architecture/verification.md && \
rg -q 'Yoda Observable Architecture Specification' README.md && \
rg -q 'Architecture Decision Records' README.md
```

Expected: FAIL because `docs/architecture/verification.md` does not exist.

- [ ] **Step 2: Write the manual trace evidence**

Create `docs/architecture/verification.md` with:

- scope and date;
- preconditions: initialized project, active run at valid PRD/spec approval boundary, no lock owner, valid event chain;
- input: Codex or Claude Code requests `continue --gate aprovacao_spec`;
- numbered observations for adapter normalization, command/schema validation, project resolution, fenced lease, state/event verification, pure decision, transaction, `spec_approved` event, state snapshot, and structured response;
- expected event fields: normalized operation, prior/resulting state identities, policy/contract versions, PRD/spec hashes, human-approval evidence reference, reason code, and effect summary;
- expected response: success, state changed, evidence references, and next action `code` without exposing sensitive content;
- negative trace: wrong gate token returns deterministic blocked result, appends no state-changing event, and instructs the exact current gate;
- exact lint, link, actionlint, placeholder, and `git diff --check` commands used for issue evidence.

- [ ] **Step 3: Link ADRs from the canonical specification**

Add a `## 17. Architecture decision records` section linking ADRs 0001–0004 by relative path and stating that the specification defines the system while ADRs preserve the reason and consequences of each structural choice.

- [ ] **Step 4: Add README navigation**

In the README Architecture section, add links to:

```markdown
The canonical [Yoda Observable Architecture Specification](../specs/2026-08-06-yoda-observable-architecture-design.md) defines the runtime, state, security, migration, testing, and rollout contracts. Structural choices and their consequences are indexed in the [Architecture Decision Records](../../adr/README.md), and the required end-to-end architecture trace is recorded in [verification evidence](../../architecture/verification.md).
```

- [ ] **Step 5: Run the complete documentation verification**

Run:

```bash
npx --yes markdownlint-cli2@0.23.2 '**/*.md'
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/docs.yml
rg -n '\b(T[O]DO|T[B]D|F[I]XME|X[X]X)\b' README.md docs .github || true
git diff --check
```

Expected: Markdown lint and actionlint pass; placeholder scan prints no matches; `git diff --check` prints no errors. Run Lychee 0.24.2 with `.lychee.toml` and expect zero failed links.

- [ ] **Step 6: Perform the manual trace review**

Read `docs/architecture/verification.md` in order and verify each transition appears in canonical specification Section 6 or 7, every persisted field is named in Section 6, the approval/hash behavior appears in Section 7.3, and response semantics appear in Section 8. Expected: every trace step maps to the specification without an invented component or state mutation.

- [ ] **Step 7: Commit navigation and evidence**

```bash
git add README.md docs/architecture/verification.md docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md
git commit -m "docs: add architecture verification evidence"
```

### Task 4: Final issue and publication evidence

**Files:**

- Verify: all files changed on `docs/issue-2-yoda-observable`

**Interfaces:**

- Consumes: Commits from Tasks 1–3 and the initial canonical-spec commit.
- Produces: A reviewable PR linked to issue #2 and closure evidence.

- [ ] **Step 1: Check issue acceptance coverage**

Run commands that assert the motto, ownership directories, TypeScript/ESM decision, all required architecture section headings, all nine milestone rows, and four accepted ADR links exist. Expected: all assertions exit 0.

- [ ] **Step 2: Run the complete verification suite from a clean worktree state**

Run Markdown lint, Lychee, actionlint, placeholder scan, `git diff --check`, and `git status --short`. Expected: all checks pass and only intentional committed changes exist.

- [ ] **Step 3: Review the branch diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only architecture documentation, documentation policy/workflow, and README navigation changes; no runtime implementation.

- [ ] **Step 4: Publish a draft PR targeting the available integration branch**

Push `docs/issue-2-yoda-observable` and open a PR that links `Closes #2`, explains PRD compatibility and the intentional state/distribution changes, states security and migration impact, and lists exact verification commands and results. Target `developer` if it exists; otherwise target `main` and explicitly note that issue #60 will establish the future integration branch.

- [ ] **Step 5: Confirm CI and complete maintainer review**

Wait for the Documentation workflow to pass. Review the rendered GitHub Markdown, Mermaid diagrams, workflow annotations, and changed-files list. Record maintainer approval on the PR; the user's explicit autonomous-approval instruction authorizes the recommended design, but CI and rendered-document review still must provide objective evidence.

- [ ] **Step 6: Merge and close issue #2**

Merge only after CI is green and the PR has no unresolved review findings. Confirm GitHub closes issue #2 through `Closes #2`, then proceed to issue #3 in dependency order.
