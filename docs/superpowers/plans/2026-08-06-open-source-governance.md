# Open-Source Governance and Security Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish GitHub-recognized contribution, conduct, governance, security, support, ownership, DCO, and IP-provenance policies with tested navigation and confidential reporting.

**Architecture:** Root community health files form a linked policy graph entered from README, while `.github/CODEOWNERS` protects repository ownership and GitHub private vulnerability reporting supplies the confidential channel. A Vitest contract prevents missing files, placeholders, or drift in critical policy clauses; manual API checks prove GitHub recognition and reporting state.

**Tech Stack:** Markdown, Contributor Covenant 3.0, Developer Certificate of Origin 1.1, GitHub community health/private vulnerability reporting/CODEOWNERS APIs, Vitest 4.1.10, markdownlint, Lychee.

## Global Constraints

- All normative repository artifacts and contributor communication are English.
- Treat private Go Yoda, BetaUp, and MWTC material as behavioral clean-room input unless explicit MIT-compatible relicensing evidence exists.
- Never publish secrets, customer/personal data, exploit details, or private infrastructure information.
- Use GitHub private vulnerability reporting; do not invent an email address or submit a real vulnerability during verification.
- Assign only the verified repository owner/administrator `@thiagocorreanet` in CODEOWNERS.
- Preserve Contributor Covenant 3.0 attribution and DCO 1.1 verbatim terms.
- Keep issue/PR templates and DCO automation in issue #6 and Node CI in issue #7.
- Do not change SDD runtime or legacy PRD/spec behavior.

---

### Task 1: Define failing community-health contracts

**Files:**

- Create: `tests/community-health.test.ts`

**Interfaces:**

- Consumes: repository root resolved from `import.meta.url`.
- Produces: executable expectations for `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SECURITY.md`, `SUPPORT.md`, `DCO`, `.github/CODEOWNERS`, and README navigation.

- [ ] **Step 1: Write the missing-file and policy-contract tests**

Use `readFile` from `node:fs/promises` and Vitest. Assert all required paths can
be read, then assert:

```typescript
expect(readme).toContain("[Contribution guide](CONTRIBUTING.md)");
expect(readme).toContain("[Security policy](SECURITY.md)");
expect(contributing).toContain("git commit -s");
expect(contributing).toContain("Signed-off-by: Your Name <your.email@example.com>");
expect(contributing).toContain("Intellectual-property provenance checklist");
expect(security).toContain("Report a vulnerability");
expect(security).toContain("Do not open a public issue");
expect(codeowners).toContain("* @thiagocorreanet");
expect(codeowners).toContain("/.github/CODEOWNERS @thiagocorreanet");
```

Scan the six policy documents for common unfinished-work markers, unfilled
template instructions, and missing enforcement contacts. Assert the DCO
identifies version 1.1 and the code of conduct identifies/attributes Contributor
Covenant 3.0.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/community-health.test.ts`

Expected: FAIL with `ENOENT` for `CONTRIBUTING.md`.

- [ ] **Step 3: Commit only after the policy implementation makes this test GREEN**

The failing test remains uncommitted until Tasks 2–3 add the required policies;
then commit it with the policy set so every commit on the branch remains usable.

### Task 2: Publish contribution, DCO, governance, and ownership policies

**Files:**

- Create: `DCO`
- Create: `CONTRIBUTING.md`
- Create: `GOVERNANCE.md`
- Create: `.github/CODEOWNERS`

**Interfaces:**

- Consumes: DCO 1.1 official text, pinned toolchain guide, architecture/ADR rules, verified owner `@thiagocorreanet`.
- Produces: signed contribution workflow, IP provenance gate, decision model, maintainer roles, and review ownership.

- [ ] **Step 1: Add DCO 1.1 verbatim**

Copy the official DCO 1.1 text from `https://developercertificate.org/` without
editing its terms, including its copyright/copy permission and clauses (a)–(d).

- [ ] **Step 2: Write the operational contribution guide**

Include prerequisites, issue selection, Superpowers feature/bug paths, branch
and scope rules, `npm ci`/`npm run verify`, English, DCO sign-off and amendment,
PR evidence, reviews, architecture/ADR triggers, security routing, and this
mandatory checklist:

```markdown
### Intellectual-property provenance checklist

- [ ] I identified every legacy or third-party source used by this change.
- [ ] I recorded whether each source is public or private and its owner/license.
- [ ] I classified the contribution as original, behavioral clean-room, adapted, or verbatim.
- [ ] Adapted/verbatim material has reviewable MIT-compatible publication authority.
- [ ] Required notices and attribution are preserved.
- [ ] No secrets, credentials, customer/personal data, private infrastructure, or confidential business information are included.
```

State that unclear provenance blocks merge and that private legacy access alone
is not relicensing permission.

- [ ] **Step 3: Write governance roles and decision rules**

Define Project Lead `@thiagocorreanet`, explicitly appointed maintainers, and
contributors; lazy consensus for routine changes; design/ADR plus explicit owner
approval for contracts/security/compatibility/migration/governance; private
security/conduct decisions; documented tie-breaking; public governance PRs;
least-privilege access and no automatic role transfer.

- [ ] **Step 4: Add secure default ownership**

Create `.github/CODEOWNERS` with:

```text
# Default ownership for all repository content.
* @thiagocorreanet

# Protect repository automation, ownership, governance, and security policy.
/.github/ @thiagocorreanet
/GOVERNANCE.md @thiagocorreanet
/SECURITY.md @thiagocorreanet
```

The `.github/` rule protects CODEOWNERS itself and later automation.

### Task 3: Publish conduct, security, support, and README navigation

**Files:**

- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Contributor Covenant 3.0, GitHub private-reporting URL, issue/support boundaries.
- Produces: recognized community policies and one-click README entrypoints.

- [ ] **Step 1: Adopt Contributor Covenant 3.0**

Use the official 3.0 Markdown and replace its reporting note with a confidential
route to `https://github.com/thiagocorreanet/mestre-yoda/security/advisories/new`.
Require title prefix `CODE OF CONDUCT`, allow GitHub platform reporting for
hosted-content violations, preserve confidentiality and the CC BY-SA 4.0
attribution.

- [ ] **Step 2: Write the security policy**

List only `main` as supported before releases; exclude the private predecessor
and forks. Require private GitHub reporting, forbid public pre-triage details,
request safe reproduction/impact/version, define prohibited testing, set 3/7/14
business-day response targets and feasible critical/high remediation targets,
and explain coordinated disclosure, credit, advisories, and CVEs.

- [ ] **Step 3: Write support boundaries**

Route public reproducible bugs/features to Issues, security and conduct to their
confidential routes, and explicitly exclude proprietary BetaUp/MWTC/customer
systems. State experimental status, no SLA/production support, English, and no
secrets/private data.

- [ ] **Step 4: Replace provisional README policy text**

Make the Contributing section link `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`GOVERNANCE.md`, and `SUPPORT.md`. Make Security link `SECURITY.md` and its
private report path. A contributor reaches every policy directly or through the
contribution guide within two clicks.

- [ ] **Step 5: Run the focused contract and confirm GREEN**

```bash
npm test -- tests/community-health.test.ts
npm run typecheck
npm run lint
```

Expected: all community-health tests pass; static checks exit 0 without warnings.

- [ ] **Step 6: Commit the tested policy graph**

```bash
git add DCO CONTRIBUTING.md CODE_OF_CONDUCT.md GOVERNANCE.md SECURITY.md SUPPORT.md README.md .github/CODEOWNERS tests/community-health.test.ts
git commit -m "docs: add open-source governance policies"
```

### Task 4: Enable and prove the contribution/security paths

**Files:**

- Create: `docs/governance/verification.md`
- Modify: `docs/superpowers/plans/2026-08-06-open-source-governance.md`

**Interfaces:**

- Consumes: merged/pushed policy files and GitHub repository administration API.
- Produces: reproducible local/API evidence without a fake vulnerability or project commit.

- [ ] **Step 1: Enable private vulnerability reporting**

Run the GitHub API operation that enables private vulnerability reporting for
`thiagocorreanet/mestre-yoda`, then verify read-only state:

```bash
gh api --method PUT repos/thiagocorreanet/mestre-yoda/private-vulnerability-reporting
gh api repos/thiagocorreanet/mestre-yoda/private-vulnerability-reporting
```

Expected JSON: `{"enabled":true}`. This setting is the only external mutation in
the issue and is required to make the documented confidential route real.

- [ ] **Step 2: Dry-run DCO and navigation locally**

Parse, without committing, a sample trailer:

```bash
printf '%s\n' 'Signed-off-by: Example Contributor <contributor@example.com>' | git interpret-trailers --parse
```

Expected: the identical valid trailer. Follow every README/policy relative link
with Lychee and record the resolved contribution, conduct, governance, support,
and security paths.

- [ ] **Step 3: Record pre-merge evidence**

Document date, branch/commit, private-reporting enabled state, sample DCO parse,
test counts, Markdown/link results, and that the reporting page was opened
without submitting a report. Mark post-merge community-profile and CODEOWNERS
recognition as a required closure check rather than claiming it early.

- [ ] **Step 4: Run complete verification**

```bash
npm run verify
npx --yes markdownlint-cli2@0.20.0 "README.md" "*.md" "docs/**/*.md" "schemas/**/*.md" "fixtures/**/*.md"
lychee --config .lychee.toml README.md CONTRIBUTING.md CODE_OF_CONDUCT.md GOVERNANCE.md SECURITY.md SUPPORT.md docs schemas fixtures
git diff --check
```

Expected: toolchain suite passes; all policy tests pass; Markdown has zero
errors; links have zero failures; diff check is empty.

- [ ] **Step 5: Review, publish, and close**

Request independent review against issue #4 and IP/security risks. Resolve
validated findings, rerun verification, push `docs/issue-4-governance`, and open
a PR with `Closes #4`, design rationale, compatibility impact, exact evidence,
and the private-reporting setting change. After green checks and merge, verify:

```bash
gh api repos/thiagocorreanet/mestre-yoda/community/profile
gh api repos/thiagocorreanet/mestre-yoda/codeowners/errors
gh issue view 4 --repo thiagocorreanet/mestre-yoda --json state,closedAt
```

Expected: community profile recognizes contribution, conduct, license, and
security files; CODEOWNERS reports no errors; issue #4 is closed. Add this
post-merge evidence to the issue before moving to #5.
