# Contributing and governance

Kratos is contract-first, test-first, deterministic, and evidence-driven. A
contribution should make its compatibility, state, migration, security, and
verification impact explicit.

## Before opening a change

1. Read the [Contribution guide](../CONTRIBUTING.md).
2. Check the [backlog](../KRATOS_BACKLOG.md) and open project work.
3. Identify the affected contract, architecture, or operational boundary.
4. For a structural change, add or reference an ADR or approved design.
5. Decide how the behavior will be verified before implementing it.

## Language and provenance

Source code, comments, tests, fixtures, errors, documentation, issues, commits,
and pull requests use English.

Every contribution requires Developer Certificate of Origin sign-off:

```bash
git commit -s
```

The pull request must also state intellectual-property provenance. Unclear
provenance blocks merge, especially for behavior reconstructed from a prior
implementation.

## Change taxonomy

| Change | Expected evidence |
| --- | --- |
| Domain rule | Focused unit/property tests and reason policy |
| Port or infrastructure | Shared contract suite plus real adapter evidence |
| Persisted contract | Schema, fixture, generated type, migration, compatibility tests |
| CLI command | Registry, parser, prerequisite, output, package smoke evidence |
| Architecture boundary | Dependency test and architecture documentation / ADR |
| Distribution | Reproducible build, package manifest, integrity, black-box smoke |
| Security control | Negative/adversarial tests and threat-model update |

## Determinism checklist

- No ambient clock, randomness, process state, filesystem, or Git in domain.
- No locale-dependent ordering at a persistence boundary.
- Same observation and request produce the same decision and plan.
- Retry behavior uses correlation identifiers or exact revisions.
- Preview and commit share the same decision path.
- Public output contains stable, sanitized values only.

## Contract evolution

- Select contract version before reading the payload as current state.
- Add compatible fields according to the family policy.
- Keep reason catalogs append-only across published revisions.
- Update schemas, fixtures, types, docs, and equivalence tests together.
- Treat persisted event, snapshot, lock, approval, evidence, transaction, and
  migration formats as public compatibility surfaces.

## Pull requests

A useful pull request explains:

- what behavior changes;
- what stays compatible;
- what can fail and how recovery works;
- what state is read or written;
- which tests provide executable evidence;
- whether the result affects release maturity.

## Governance

Kratos currently uses a lead-maintainer model. Architectural, contract, release,
security, and governance changes require the ownership and review described in
[Governance](../GOVERNANCE.md) and repository CODEOWNERS.

Community standards:

- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Support policy](../SUPPORT.md)
- [Security policy](../SECURITY.md)
- [Contribution workflow](../docs/contributing/workflow.md)
- [Verification guide](../docs/contributing/verification.md)

