# Governance

Kratos uses a lead-maintainer model while the public rewrite is
experimental. Authority is explicit, decisions are reviewable, and access is
limited to what each role needs.

## Roles

- **Project Lead: `@thiagocorreanet`.** Accountable for project direction,
  governance, releases, security response, maintainer appointments, ownership,
  and final tie-breaking.
- **Maintainers.** Contributors explicitly appointed through a public governance
  pull request after sustained, trusted work. Their review, triage, and merge
  authority is limited to documented ownership and repository permissions.
- **Contributors.** Everyone who participates under the
  [Code of Conduct](CODE_OF_CONDUCT.md), follows the
  [contribution guide](CONTRIBUTING.md), and certifies commits under DCO 1.1.

Write access alone does not silently appoint a maintainer, code owner, security
contact, or Project Lead. Appointment requires a governance change that names
the role, scope, and effective date.

## Decision process

Routine, reversible changes use lazy consensus through issues and pull request
review. Maintainers should state objections with concrete technical or community
impact and a viable alternative.

The following require a written design or ADR as applicable and explicit
approval from the Project Lead or a delegated code owner:

- public schemas, commands, reason codes, and compatibility contracts;
- architecture, security boundaries, supply-chain policy, and state ownership;
- migrations, legacy-parity exceptions, and irreversible data changes;
- release/support policy, governance, licensing, and ownership changes.

Security and conduct investigations are handled privately to protect reporters
and affected people. Maintainers publish only information safe for coordinated
disclosure or an agreed community outcome. When consensus cannot be reached,
the Project Lead documents the considered alternatives and makes the final
decision.

## Appointing and removing maintainers

A nomination is a public governance pull request describing sustained
contributions, demonstrated review judgment, security/provenance awareness, the
proposed ownership scope, and any conflicts of interest. The Project Lead
approves appointments after community review.

Maintainers may step down at any time. Access may be suspended or removed for
security, inactivity, role change, or Code of Conduct enforcement. Inactivity
never transfers credentials or authority automatically. Repository permissions
are reviewed for least privilege and revoked when no longer necessary.

## Changing governance

This document changes only through a focused pull request with public rationale,
community review, and Project Lead approval. Emergency security restrictions may
be applied immediately, but the safe rationale and durable policy change must be
recorded when disclosure no longer creates risk.
