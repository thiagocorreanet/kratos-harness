# Open-Source Governance, Security, and Contribution Design

- Status: Approved
- Decision date: 2026-08-06
- Tracking issue: [#4](https://github.com/thiagocorreanet/mestre-yoda/issues/4)
- Depends on: [#2](https://github.com/thiagocorreanet/mestre-yoda/issues/2)
- Approval basis: Maintainer-authorized autonomous recommendation

## 1. Outcome

A first-time contributor can move from the README to an actionable contribution,
support, conduct, governance, or private vulnerability path in at most two links.
Every contribution certifies provenance through DCO 1.1, English is normative,
and private BetaUp/MWTC material cannot enter the MIT repository without explicit
rights evidence.

The repository uses GitHub-native community health locations and private
vulnerability reporting. Policies are durable repository artifacts rather than
oral convention or external-only pages.

## 2. Approaches considered

| Approach | Advantages | Costs | Decision |
| --- | --- | --- | --- |
| Minimal custom policy files | Short and project-specific | Easy to omit enforcement, attribution, recognition, and reporting details | Rejected |
| Standards-first repository policies plus GitHub private reporting | Recognized by GitHub, familiar to contributors, versioned with the project, private disclosure without inventing an email | Requires maintaining several linked documents and one repository setting | Selected |
| Link only to external policies | Little repository content | External content can drift; offline clones lack rules; project-specific IP controls disappear | Rejected |

## 3. Standards and placement

The repository adopts:

- [GitHub community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
  in supported root locations;
- [Developer Certificate of Origin 1.1](https://developercertificate.org/)
  verbatim in `DCO`;
- [Contributor Covenant 3.0](https://www.contributor-covenant.org/version/3/0/code_of_conduct/)
  in `CODE_OF_CONDUCT.md`, with its required attribution;
- [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
  as the primary confidential channel;
- `.github/CODEOWNERS`, the location GitHub recommends for protecting ownership
  rules themselves.

The root owns `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`,
`SECURITY.md`, `SUPPORT.md`, and `DCO`. GitHub recognizes the community files
there, and cloned/downloaded source retains the complete policies.

`.github/CODEOWNERS` assigns the verified repository owner and administrator
`@thiagocorreanet` as the default owner. A collaborator's write permission alone
does not silently grant a governance or security role. Future owners require an
explicit governance change and sufficient GitHub permission.

## 4. Contribution workflow

`CONTRIBUTING.md` is the operational entrypoint. It directs contributors to:

1. search the backlog and discuss public-contract changes before implementation;
2. branch from the current default branch and keep one issue per change;
3. follow the repository's Superpowers process: brainstorming for features,
   systematic debugging for bugs, written plans, TDD, review, and verification;
4. use the pinned toolchain and run `npm ci` plus `npm run verify`;
5. keep source, tests, docs, issues, commits, and PRs in normative English;
6. complete the IP provenance checklist;
7. sign every commit with `git commit -s` under DCO 1.1;
8. open a PR that links its issue, explains compatibility/security impact, and
   supplies exact evidence.

Unsigned commits are not accepted. Contributors amend/rebase their own commits
rather than maintainers adding certification on their behalf. A sign-off records
the contributor's real name and reachable email in the standard
`Signed-off-by: Name <email>` trailer; it is not a copyright assignment.

Issue/PR forms and automated DCO enforcement remain owned by issue #6 and CI
enforcement by issue #7. This issue defines the normative rules and testable
repository artifacts those later workflows consume.

## 5. Intellectual-property provenance

Access to private material is not permission to relicense it. Every PR that uses
legacy code, prompts, fixtures, schemas, tests, or documentation answers a
provenance checklist:

- exact source and whether it is public or private;
- original author/copyright owner;
- applicable license or written relicensing authorization;
- contribution method: original, behaviorally reimplemented, adapted, or
  verbatim;
- whether customer, employee, secret, credential, internal-infrastructure, or
  confidential business data is present;
- evidence that any third-party notices and attribution are preserved.

The safe default for the private Go Yoda, BetaUp, and MWTC material is
**behavioral clean-room reimplementation**: document externally observable
inputs, outputs, ordering, gates, reason codes, and edge cases, then write new
English TypeScript/tests without copying private source or prose. The old
repository remains the compatibility oracle for PRD/spec behavior, but that
does not itself authorize copying implementation text.

Verbatim or adapted private material may enter only when the PR carries
reviewable evidence that the rights holder authorized publication under MIT.
Unclear provenance blocks merge. Secrets and customer/confidential data are
never accepted, regardless of copyright permission.

## 6. Normative language

English is normative for repository artifacts and contributor communication:
source, comments, tests, fixtures, errors, documentation, issues, discussions,
commit messages, reviews, and pull requests. This creates one reviewable public
record and matches the architecture language contract.

Community translations are welcome only as clearly labeled informational
copies that link to the English original. When translations differ, English
controls. Personal accessibility needs are handled respectfully; maintainers
may help translate an initial report, but the durable repository decision is
recorded in English.

## 7. Governance and decisions

The project starts with a lead-maintainer model appropriate for its experimental
stage:

- **Project Lead:** `@thiagocorreanet`, accountable for vision, releases,
  security, governance, owner appointments, and final tie-breaking;
- **Maintainers:** contributors explicitly appointed through a public governance
  PR after sustained trusted work; they triage, review, and merge within their
  documented ownership;
- **Contributors:** everyone participating under the code of conduct and DCO.

Routine reversible changes use lazy consensus through issues and PR review.
Public contracts, architecture, security boundaries, compatibility, migrations,
and governance require a written design/ADR as applicable and explicit Project
Lead or delegated owner approval. Security and conduct cases are decided
privately to protect reporters; only safe outcomes are published. The Project
Lead resolves deadlock after documenting the rationale.

Governance amendments use a PR, public rationale, and Project Lead approval.
Maintainer inactivity never transfers credentials automatically; access is
reviewed and revoked when no longer necessary.

## 8. Security policy

Until public releases exist, only the current `main` branch is supported. The
private Go predecessor and third-party forks are not supported through this
public repository. Once releases begin, each supported line must be listed
explicitly rather than inferred.

Reports use GitHub's **Report a vulnerability** flow. The repository setting is
enabled and verified without creating a real report. Reporters must not open a
public issue, PR, discussion, or paste with vulnerability details before triage
and coordinated disclosure.

The policy requests impact, affected version/commit, prerequisites, safe
reproduction, proof of concept where appropriate, and suggested remediation.
It prohibits real secrets, personal/customer data, destructive testing, service
disruption, social engineering, and attacks against systems not owned by the
reporter.

Response targets, measured in business days, are:

- acknowledgement within 3 days;
- initial severity/scope triage within 7 days;
- private status updates at least every 14 days while active;
- remediation/disclosure timing agreed from severity and fix complexity, with
  critical issues targeted for 7 days and high issues for 30 days when feasible.

These are good-faith targets, not a paid support SLA. Maintainers coordinate a
fix, advisory, credit, CVE request where appropriate, and disclosure only after
affected users have a reasonable remediation path. Duplicate, invalid, or
out-of-scope reports receive a private explanation.

## 9. Conduct and support

Contributor Covenant 3.0 applies to repository spaces and official project
representation. Conduct incidents use a confidential maintainer channel: the
same GitHub private reporting form with a `CODE OF CONDUCT` title when private
contact is needed, or GitHub's platform reporting tools for content governed by
GitHub. Conduct reports and vulnerability reports remain separately triaged.

`SUPPORT.md` distinguishes:

- public, reproducible bugs and feature proposals in GitHub Issues;
- usage questions only when enough public context exists to answer safely;
- confidential vulnerabilities through private reporting;
- conduct reports through the confidential route;
- proprietary BetaUp/MWTC/customer systems as unsupported and out of scope.

The project is experimental and offers no guaranteed response time or production
support. Support requests must contain no secrets or private customer data.

## 10. Automated and manual verification

`tests/community-health.test.ts` fails first while the required artifacts are
absent, then permanently checks:

- all required files and `.github/CODEOWNERS` exist;
- README links contribution, security, support, conduct, and governance paths;
- DCO sign-off, English, verification, and IP provenance rules are present;
- supported-version and confidential-reporting requirements are present;
- no template placeholders remain in policy files;
- CODEOWNERS assigns the verified owner and protects its own path.

Documentation lint and link checks cover every Markdown policy. The manual dry
run records:

1. README-to-contribution navigation and all contributor decision branches;
2. parsing a sample DCO trailer without creating a project commit;
3. private vulnerability reporting enabled via the GitHub API;
4. the reporting URL resolves without submitting a vulnerability;
5. after merge, GitHub's community profile recognizes contribution, conduct,
   license, and security files, and the CODEOWNERS error API reports no errors.

The post-merge recognition checks may complete after the implementation PR is
merged; their evidence is recorded in the issue before closure.

## 11. Scope boundaries

This issue does not add issue/PR templates, labels, a DCO bot, branch rules,
Node CI, release support promises, legal ownership not backed by evidence, or
public behavior from the old runtime. Those changes remain in their dependency-
ordered issues.

No SDD runtime, PRD/spec workflow, schema, reason code, migration, or host
behavior changes. The legacy PRD compatibility requirement remains exactly as
approved in the observable architecture specification.

## 12. Acceptance mapping

| Issue requirement | Design section |
| --- | --- |
| Contribution, conduct, governance, security, support, CODEOWNERS | 3–9 |
| DCO workflow and sign-off | 4 |
| Disclosure channel, supported versions, response, no premature public details | 8 |
| Normative English | 6 |
| Legacy/private IP provenance checklist | 5 |
| GitHub recognition | 3, 10 |
| Clean-room versus authorized MIT relicensing | 5 |
| README discoverability within two links | 1, 4, 10 |
| Lint/link checks and manual dry runs | 10 |
