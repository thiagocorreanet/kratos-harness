# Contribution Intake and Work Taxonomy Design

- Status: Approved
- Decision date: 2026-08-06
- Tracking issue: [#6](https://github.com/thiagocorreanet/mestre-yoda/issues/6)
- Depends on: [#4](https://github.com/thiagocorreanet/mestre-yoda/issues/4)
- Approval basis: Maintainer-authorized autonomous recommendation

## 1. Outcome

Every new public issue enters through a GitHub-native form that requests the
acceptance or reproduction evidence appropriate to its work type. Every pull
request carries one linked issue, explicit compatibility and risk analysis,
separate deterministic-test and model-evaluation evidence, provenance, DCO, and
English confirmations. Contributors can determine the meaning of every label,
milestone, work ID, and branch without relying on oral convention.

Confidential vulnerability details never enter a public form. GitHub's private
vulnerability-reporting URL is the primary security contact and remains visible
from both the issue chooser and the security-safe public form.

## 2. Approaches considered

| Approach | Advantages | Costs | Decision |
| --- | --- | --- | --- |
| Free-form Markdown templates | Small and familiar | Weak required-field semantics, ambiguous intake, easy to omit evidence | Rejected |
| GitHub Issue Forms plus repository contract tests | Native discovery and validation, typed required fields, reviewable YAML, no bot permissions | YAML schema and local draft rendering must be maintained | Selected |
| Custom intake bot or external form | Arbitrary validation and routing | New credentials, privacy boundary, availability dependency, and maintenance surface | Rejected |

## 3. Issue chooser and forms

`.github/ISSUE_TEMPLATE/config.yml` disables blank public issues. Its first
contact link routes suspected vulnerabilities and exposed secrets directly to
GitHub private vulnerability reporting. A second link routes support questions
to `SUPPORT.md`; neither link creates an issue.

The chooser exposes exactly five public forms:

| File | Purpose | Default labels | Required evidence |
| --- | --- | --- | --- |
| `bug.yml` | Reproducible non-security defect | `bug`, `english-only` | affected commit/version, environment, minimal reproduction, expected/actual behavior, regression evidence |
| `feature.yml` | New behavior or design proposal | `enhancement`, `type:feature`, `english-only` | problem, proposed outcome, acceptance evidence, alternatives, contract/state/security impact |
| `compatibility.yml` | Go-v3 or host parity regression | `type:research`, `area:compatibility`, `english-only` | oracle/provenance boundary, exact input, expected/observed output, classification, redacted differential evidence |
| `security-safe.yml` | Public hardening/documentation request with no sensitive details | `type:security`, `area:security`, `english-only` | safe scope, desired hardening, acceptance evidence, mandatory no-vulnerability/no-secret attestations |
| `documentation.yml` | Public documentation correction | `documentation`, `type:documentation`, `english-only` | location, audience problem, proposed change, acceptance evidence |

All forms begin with a Markdown warning to use normative English, search for a
duplicate, and exclude secrets, customer data, and private source. All use
stable kebab-case field IDs, unique within their form. Required checkboxes make
the public-safety and contribution-policy boundaries explicit.

The security-safe form is intentionally not a vulnerability form. Its title,
description, opening warning, and required attestations all redirect suspected
vulnerabilities, secrets, and exploit details to the private advisory URL. It is
appropriate only for public security hardening, threat-model, or documentation
work whose full content is safe to disclose.

## 4. Pull-request contract

`.github/pull_request_template.md` is one structured review contract. It asks
for:

- a closing issue reference and stable work ID;
- outcome, design choice, alternatives, and scope boundary;
- public-contract and Go-v3 compatibility impact;
- state, migration, security, privacy, and rollback impact;
- a dedicated deterministic-test section with exact commands/results and RED
  evidence;
- a separate prompt/model-evaluation section that permits `Not applicable` but
  never treats probabilistic evaluation as a substitute for deterministic tests;
- legacy and third-party provenance classification and publication authority;
- an English-only, DCO, focused-change, documentation, and no-placeholder
  checklist.

The template does not claim that future CI or branch protection exists. It asks
contributors to report the evidence available for their change and leaves
automated enforcement to issue #7.

## 5. Labels, milestones, and stable work IDs

The contributor workflow documents the existing GitHub taxonomy rather than
silently creating a competing set:

- one `type:*` label describes the work product;
- one or more `area:*` labels describe affected architecture boundaries;
- one `priority:p0` through `priority:p3` communicates ordering;
- `status:blocked` records an unmet dependency;
- GitHub intake labels such as `bug`, `enhancement`, and `documentation` remain
  discoverability aliases and may coexist with the namespaced labels;
- community-routing labels such as `good first issue` and `help wanted` do not
  change priority or ownership.

Milestones represent delivery campaigns, not due-date promises. Each non-epic
work item belongs to at most one milestone matching the epic whose exit criteria
it advances. A bug is assigned to the milestone that owns its fix, not merely
the version where it was observed. Moving a work item requires a public triage
rationale.

Backlog work IDs use `[STREAM-NN]` at the start of the title. The maintained
streams are `FND`, `CMP`, `RUN`, `SDD`, `ADP`, `MIG`, `OBS`, `QAL`, `BET`, and
`FUT`; coordinating epics use `[EPIC]`. Maintainers allocate the next unused
positive two-digit sequence within a stream. An assigned ID is immutable and
never reused, even after closure, transfer, or cancellation. Contributors may
leave the proposed ID field blank; triage assigns it before work is accepted.
GitHub issue numbers remain canonical links, while work IDs remain stable human
references across exports and migrations.

## 6. Branch flow

The target contribution flow is:

```text
feature/*, fix/*, docs/*, refactor/*
                    |
                    v
               developer
                    |
        approved release pull request
                    |
                    v
                  main
```

Short-lived branches contain one issue and use
`<type>/<issue-number>-<short-name>`. `developer` is the future integration
branch; `main` is the protected release line. Issue #60 owns creating that
branch, changing repository defaults, enabling protection, and publishing the
release cadence. Until #60 is implemented, contributors follow the base branch
named by the active repository instructions and PR UI. The template and guide
label the flow proposed rather than pretending protection already exists.

## 7. Deterministic validation and discoverability

The repository pins Ajv `8.20.0` and YAML `2.9.0` as development-only validators
and keeps zero production dependencies. `npm run templates:validate` downloads
the GitHub Issue Forms schema from the immutable SchemaStore commit
`4b00bca7dc9307b9dd34ca13d8c87329d66ad4ce`, rejects any content whose SHA-256
is not `c2722dbf00334ce4fdeffa960b8c9047caf4f1cbb8f3809663f4d604b1d3ae76`,
and validates all five forms against that complete snapshot.

`tests/github-contribution-contract.test.ts` starts red while the templates are
absent, then validates repository-specific policy:

- the exact chooser/form inventory and parseable YAML object shape;
- parseable YAML, supported keys/types, unique IDs, required attributes, valid
  option shapes, and existing default labels;
- form-specific reproduction or acceptance evidence;
- private vulnerability routing and public safety attestations;
- the PR template's required risk, evidence, provenance, DCO, and English
  sections;
- the documented label namespaces, milestones, work-ID streams, immutability,
  and proposed branch boundary.

The test renders one filled Markdown draft for every form into an operating-
system temporary directory, verifies that all required fields are discoverable,
and deletes the draft tree. This proves local draft creation without opening a
real issue or notifying maintainers.

The implementation PR references #6 without a closing keyword. After merge,
GitHub's issue-template API must discover exactly the five forms, every direct
form URL must render its title and required fields, and the community profile
must recognize issue and pull-request templates. Only an evidence follow-up may
use `Closes #6`. This keeps the issue open until the platform-level discovery and
rendering gate has actually passed.

## 8. Compatibility, security, and provenance

This change affects contribution intake only. It does not alter runtime, state,
schema, migration, SDD, host, or legacy PRD/spec behavior. The private Go
repository was checked only for repository-template precedent and contains no
Issue Forms or pull-request template to copy. All public form prose and tests are
original clean-room work grounded in public GitHub behavior and this repository's
approved governance rules.

No form accepts credentials, customer/personal data, proprietary source, or
uncoordinated vulnerability details. The template reinforces that model/prompt
evaluation is supplementary evidence and cannot weaken deterministic runtime or
compatibility gates.
