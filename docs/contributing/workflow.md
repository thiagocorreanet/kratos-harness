# Contribution Workflow and Work Taxonomy

This guide defines how Kratos classifies, plans, and integrates public
work. It complements [CONTRIBUTING.md](../../CONTRIBUTING.md); the contribution,
security, conduct, governance, provenance, DCO, and English rules there remain
normative.

## Intake workflow

Search the backlog before opening an issue. Select the form whose evidence
matches the work:

- **Bug report:** reproducible non-security behavior with expected/actual output
  and regression evidence.
- **Feature or design proposal:** one user problem, objective outcome, acceptance
  evidence, alternatives, and architecture/risk impact.
- **Compatibility regression:** authorized clean-room oracle comparison with
  exact inputs and redacted differential evidence.
- **Public security hardening:** only information safe for immediate disclosure;
  never vulnerabilities, exploits, exposed secrets, or sensitive details.
- **Documentation report:** one reader/location problem and the checks that will
  prove the correction.

Blank public issues are disabled. Suspected vulnerabilities and exposed secrets
use [private vulnerability reporting](https://github.com/thiagocorreanet/kratos-harness/security/advisories/new),
not an Issue Form. General routing follows [SUPPORT.md](../../SUPPORT.md).

Maintainers triage duplicates, scope, dependencies, work ID, labels, milestone,
priority, and readiness. A form submission does not itself approve a public
contract, assign a maintainer, or authorize implementation.

## Label taxonomy

Use labels as independent dimensions:

- exactly one `type:*` label identifies the primary work product when a
  namespaced type applies;
- one or more `area:*` labels identify architecture boundaries materially
  affected by the work;
- exactly one `priority:p0` through `priority:p3` communicates delivery order;
- `status:blocked` means a named dependency or external condition prevents work;
- GitHub intake aliases (`bug`, `enhancement`, `documentation`, `question`) aid
  discovery and may coexist with namespaced labels;
- community labels (`good first issue`, `help wanted`) describe contribution
  suitability, not priority, ownership, or approval;
- lifecycle outcomes (`duplicate`, `invalid`, `wontfix`) require a public triage
  explanation before closure;
- `english-only` records the normative public-language contract;
- `future` is reserved for work beyond the first public beta.

### Type labels

| Label | Meaning |
| --- | --- |
| `type:ci` | Continuous integration and automation |
| `type:documentation` | Documentation work |
| `type:epic` | Coordinated body of work and exit criteria |
| `type:feature` | New product capability |
| `type:maintenance` | Repository and maintenance work |
| `type:research` | Discovery or compatibility research |
| `type:security` | Security hardening or validation |
| `type:testing` | Test infrastructure or quality assurance |

### Area labels

| Label | Meaning |
| --- | --- |
| `area:adapters` | Claude Code and Codex integrations |
| `area:community` | Open-source governance and contribution |
| `area:compatibility` | Legacy parity and compatibility contracts |
| `area:foundation` | Repository and architecture foundation |
| `area:migration` | Legacy migration, upgrade, and recovery |
| `area:observability` | Events, evidence, explanation, and dashboards |
| `area:quality` | Testing and quality engineering |
| `area:release` | Packaging, releases, and distribution |
| `area:runtime` | Deterministic TypeScript runtime |
| `area:security` | Security-sensitive architecture and hardening |
| `area:state` | State model, schemas, and persistence |
| `area:workflow` | SDD workflow and gates |

### Priority and status labels

| Label | Meaning |
| --- | --- |
| `priority:p0` | Required before all other work |
| `priority:p1` | Required for the first public beta |
| `priority:p2` | Important after the beta foundation |
| `priority:p3` | Future or optional capability |
| `status:blocked` | Cannot start until named dependencies are complete |

The remaining GitHub intake/community labels are `bug`, `documentation`,
`duplicate`, `enhancement`, `english-only`, `future`, `good first issue`,
`help wanted`, `invalid`, `question`, and `wontfix`. Maintainers preserve the
descriptions and colors configured in GitHub; a taxonomy change requires a
focused issue/PR so repository documentation and platform state stay aligned.

## Milestones

Milestones are evidence campaigns, not calendar promises. The public sequence is:

| Milestone | Evidence boundary |
| --- | --- |
| Foundation | Repository, architecture, governance, and CI foundation |
| Compatibility Contract | Frozen Go baseline and measurable TypeScript parity |
| Deterministic Runtime | Core runtime, state, filesystem, and Git services |
| SDD Workflow Parity | Objective-to-done workflow and deterministic gates |
| Host Integrations | Claude Code and Codex adapters without a global binary |
| Migration and Observability | Safe migration, replay, repair, and evidence |
| Quality Campaign | Layered tests, platforms, security, and compatibility |
| Public Beta | Documentation, distribution, release, and pilot readiness |
| Post-1.0 Ideas | Advanced adaptive and collaborative capabilities |

A non-epic issue belongs to at most one milestone: the campaign whose exit
criteria it advances. An epic uses that same milestone to coordinate its child
issues. A bug belongs to the milestone that owns its fix, not automatically to
the release where it was observed. Moving work between milestones requires a
public triage rationale; due dates do not replace objective exit evidence.

## Stable work IDs

Accepted backlog items use `[STREAM-NN]` at the beginning of the title. `NN` is
the next unused positive two-digit sequence within its stream:

| Stream | Scope |
| --- | --- |
| `FND` | Foundation |
| `CMP` | Compatibility Contract |
| `RUN` | Deterministic Runtime |
| `SDD` | SDD Workflow Parity |
| `ADP` | Host Integrations |
| `MIG` | Migration |
| `OBS` | Observability |
| `QAL` | Quality Campaign |
| `BET` | Public Beta |
| `FUT` | Post-1.0 Ideas |

Coordinating epics use `[EPIC]`. Maintainers allocate IDs during triage after
checking the complete open and closed backlog. Contributors should not guess an
ID in a new form.

Once assigned, a work ID is immutable and never reused, even when an issue is
closed, moved, superseded, or cancelled. GitHub issue numbers remain the
canonical URL and relationship key; work IDs provide stable human references
across roadmap exports, migrations, and repository history.

## Branch and release flow

The proposed flow is not active until [issue #60](https://github.com/thiagocorreanet/kratos-harness/issues/60)
creates/configures the branches and protections:

```text
feature/*, fix/*, docs/*, refactor/* -> developer -> approved release PR -> main
```

Short-lived contribution branches use
`<type>/<issue-number>-<short-name>`, contain one coherent issue outcome, and
will target `developer`. Approved release pull requests will move reviewed
integration commits from `developer` to protected `main`.

Until issue #60 activates that model, contributors must use the base branch
named by the current repository instructions and GitHub pull-request interface.
Documentation of the target flow does not create a `developer` branch, change
the default branch, activate protection, or imply that unavailable checks run.

## Pull requests

Use the repository pull-request template. A reviewable PR closes one issue,
names its stable work ID, explains design and compatibility impact, and separates
deterministic tests from prompt/model evaluations. It includes RED evidence,
exact current commands/results, provenance, DCO, migration/security/rollback
impact, and normative-English confirmation.

Probabilistic model evaluation is supplementary and is never accepted as a
substitute for deterministic runtime, state, compatibility, migration, package,
or security tests. All available required checks must pass before merge.

### Prompt size ceiling reviews

Changes affecting host skills, phase agent prompts, managed instruction blocks,
or document templates are subject to deterministic prompt size ceiling enforcement
(see [prompt size ceilings architecture](../architecture/prompt-size-ceilings.md)):

- **Zero uncategorized prompts:** Every shipped or generated prompt surface must
  be declared under an approved category in `@kratos/runtime/domain/prompt-ceilings`.
  New prompt files cannot pass CI unchecked.
- **Strict category ceilings:** Prompts must remain within their category limit in
  their final rendered form. Category ceilings are hard attention-budget boundaries
  and are never increased to accommodate prompt expansion.
- **Externalize details on breach:** If a prompt approaches or breaches its limit,
  detailed guidance or examples must be factored into external documentation files
  (e.g., in `docs/` or separate markdown files) and linked from the prompt.
- **Host parity:** Prompt changes must maintain identical constraints and limits
  across all supported host distributions (Claude Code, Codex, Antigravity).
- **Verification:** Run `npm run prompts:ceilings:check` (or `npm run verify`) to
  confirm zero ceiling breaches before submitting a pull request.
