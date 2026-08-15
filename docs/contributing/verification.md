# Contribution Intake Verification

- Local verification date: 2026-08-06 (America/Sao_Paulo)
- Platform verification date: 2026-08-07 (America/Sao_Paulo)
- Tracking issue: [#6](https://github.com/thiagocorreanet/mestre-yoda/issues/6)
- Branch: `docs/issue-6-contribution-templates`
- Reviewed implementation commit: `b9c5876`
- Status: Complete through the platform gate; this evidence follow-up closes #6

## Test-first evidence

`tests/github-contribution-contract.test.ts` was introduced before any template.
Its first run had 11 failures: `.github/ISSUE_TEMPLATE`, the pull-request
template, and the workflow guide did not exist. The YAML dependency-isolation
assertion was the only passing test. After implementation, all 12 focused tests
pass.

The contract checks the exact chooser/form inventory, supported form shape,
unique IDs, required evidence, existing default labels, private vulnerability
routing, PR evidence sections, taxonomy, work IDs, milestones, proposed branch
flow, and dependency isolation. It also creates five filled Markdown drafts in
an OS temporary directory, verifies every required field is discoverable, and
removes the complete draft tree in `finally`.

## Pinned schema validation

`npm run templates:validate` retrieves the SchemaStore GitHub Issue Forms schema
from immutable commit `4b00bca7dc9307b9dd34ca13d8c87329d66ad4ce` and rejects it unless its SHA-256
is `c2722dbf00334ce4fdeffa960b8c9047caf4f1cbb8f3809663f4d604b1d3ae76`.
Ajv 8.20.0 validated all five parsed forms against the complete snapshot:

```text
valid: bug.yml
valid: compatibility.yml
valid: documentation.yml
valid: feature.yml
valid: security-safe.yml
forms: 5
```

The complete schema detected and prevented two errors that the initial policy
subset did not: empty assignee arrays and unsupported checkbox-level validation
objects. Required checkbox options now carry their own GitHub-supported
`required: true` flags.

## Form and evidence inventory

| Form | Default labels | Required evidence boundary |
| --- | --- | --- |
| Bug | `bug`, `english-only` | version, environment, reproduction, expected/actual behavior, regression evidence |
| Compatibility | `type:research`, `area:compatibility`, `english-only` | oracle/provenance, exact input, two results, class, differential evidence |
| Documentation | `documentation`, `type:documentation`, `english-only` | location, audience problem, proposed change, acceptance evidence |
| Feature | `enhancement`, `type:feature`, `english-only` | problem, outcome, acceptance evidence, alternatives, architecture/risk impact |
| Security-safe | `type:security`, `area:security`, `english-only` | public scope, hardening, safe evidence, no-vulnerability/no-secret attestations |

Blank issues are disabled. The first chooser contact link and the opening text
of every form route suspected vulnerabilities to GitHub private vulnerability
reporting. The security-safe form cannot be submitted until the reporter attests
that it contains no suspected vulnerability, exploit, secret, customer/private
data, confidential infrastructure, or proprietary source.

## Local verification

Using Node.js `v24.18.0` and npm `11.16.0`:

| Check | Result |
| --- | --- |
| `npm ci` | Pass; 261 locked development packages installed |
| `npm ls ajv yaml --depth=0` | Ajv 8.20.0 and YAML 2.9.0 exactly |
| Focused contract | Pass; 1 file and 12 tests |
| `npm run verify` | Pass; 6 files and 42 tests |
| Coverage | 100% configured runtime statements, branches, functions, and lines |
| `npm run templates:validate` | Five forms valid against pinned schema/hash |
| Form/template CSpell | 8 files, zero issues |
| Markdown CSpell | 30 files, zero issues |
| markdownlint | 31 files, zero errors |
| Lychee | 117 links checked, 66 unique, zero errors |
| Package verification | Exact 386-byte ESM; unchanged help/version and SHA-256 |
| `git diff --check` | Pass |

The root still has zero production dependencies. Ajv/YAML are development-only;
the package verifier reports the same sole `runtime/kratos.mjs` artifact and
`24293983cba88bb6e96ba4586bb5492b5e84bd18a8d5f0b7b536e8ad8d2108ee` hash.
No runtime, state, migration, host, PRD, or spec behavior changed.

## Independent review

The first independent review found that a hand-written schema subset could not
prove GitHub fidelity and that the original publication order closed #6 before
platform discovery. The complete pinned-schema validator was added, and the
publication flow was split so a follow-up can close #6 only after GitHub renders
every form on `main`.

Re-review found one contradictory sentence describing the offline `verify`
chain; the guide now separates it from the online pinned-schema command. Final
review reported no Critical, Important, or Minor findings.

## GitHub platform discovery and rendering

Implementation PR [#76](https://github.com/thiagocorreanet/mestre-yoda/pull/76)
merged as `7210222db48edb98309807aea0f6dde223bde63c`. Its Documentation check passed,
and the merge commit passed again on `main` in
[run 31144110180](https://github.com/thiagocorreanet/mestre-yoda/actions/runs/31144110180).

The PR body avoided `Closes #6`, but the explanatory phrase `close #6` was also
recognized by GitHub as a closing keyword. Issue #6 was immediately reopened
before platform testing and remained open throughout the gate.

An authenticated clean chooser inspection at
[`issues/new/choose`](https://github.com/thiagocorreanet/mestre-yoda/issues/new/choose)
rendered exactly these five forms in source order, both configured contact links,
GitHub's native private vulnerability entry, and `Blank issue — Maintainers only`:

| Direct form | Rendered title | Visible first required evidence | Labels rendered |
| --- | --- | --- | --- |
| [`bug.yml`](https://github.com/thiagocorreanet/mestre-yoda/issues/new?template=bug.yml) | `[BUG]` | Affected version or commit | `bug`, `english-only` |
| [`compatibility.yml`](https://github.com/thiagocorreanet/mestre-yoda/issues/new?template=compatibility.yml) | `[COMPATIBILITY]` | Oracle and compared build | `area:compatibility`, `english-only`, `type:research` |
| [`documentation.yml`](https://github.com/thiagocorreanet/mestre-yoda/issues/new?template=documentation.yml) | `[DOCUMENTATION]` | Documentation location | `documentation`, `english-only`, `type:documentation` |
| [`feature.yml`](https://github.com/thiagocorreanet/mestre-yoda/issues/new?template=feature.yml) | `[FEATURE]` | Problem and user impact | `english-only`, `enhancement`, `type:feature` |
| [`security-safe.yml`](https://github.com/thiagocorreanet/mestre-yoda/issues/new?template=security-safe.yml) | `[SECURITY-SAFE]` | Public and non-sensitive scope | `area:security`, `english-only`, `type:security` |

Every direct URL rendered a GitHub Issue Form with required-field asterisks and
the expected descriptions/placeholders. No issue was submitted and no
notification was created.

GitHub's GraphQL `pullRequestTemplates` field returned the complete repository
PR template, and the community profile recognized it at the canonical path with
100% health. In the same observation, GraphQL `issueTemplates` was empty and the
community profile's legacy `issue_template` field was null even though the Issue
Forms visibly rendered. Those legacy/template metadata fields are therefore not
used as Issue Forms discovery evidence; the authenticated chooser and five
direct rendered forms are the platform gate.

All required platform observations now exist. This evidence follow-up carries
`Closes #6`, so closure occurs only when the verified record merges.
