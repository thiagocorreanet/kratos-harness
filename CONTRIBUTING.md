# Contributing to Mestre Yoda

Thank you for helping build Mestre Yoda. The project is experimental, public,
and contract-first. Contributions are welcome when their behavior, provenance,
and verification can be reviewed safely.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md), the
[governance model](GOVERNANCE.md), and the [Developer Certificate of Origin](DCO).
Security-sensitive reports follow [SECURITY.md](SECURITY.md), not public issues.

## Normative language

English is the normative language for source code, comments, tests, fixtures,
errors, documentation, issues, reviews, commit messages, and pull requests.
Translations may be submitted as clearly labeled informational copies that link
to the English original. If they differ, the English policy controls.

Maintainers will respond respectfully to accessibility or language needs and
may help translate an initial report, but durable project decisions are recorded
in English.

## Before starting

1. Search the [public backlog](https://github.com/thiagocorreanet/mestre-yoda/issues)
   for an existing issue and read its epic, dependencies, and architecture links.
2. For a new public contract or structural change, open a focused issue before
   implementation. Do not use an issue for confidential vulnerabilities.
3. Keep one issue and one coherent outcome per pull request.
4. Use the repository Superpowers process: brainstorming for features,
   systematic debugging for bugs, a written implementation plan, test-driven
   development, independent review, and evidence before completion.
5. Read the [architecture specification](docs/superpowers/specs/2026-08-06-yoda-observable-architecture-design.md)
   and applicable [ADRs](docs/adr/README.md). Structural decisions require an
   ADR or approved design; they cannot live only in a commit message.

## Development workflow

Use Node.js `24.18.0` and npm `11.16.0` exactly. The complete environment and
command contract is in the [deterministic toolchain guide](docs/development/toolchain.md).

```bash
git switch main
git pull --ff-only
git switch -c <type>/<issue-and-short-name>
npm ci
npm run verify
```

Start with a failing test for behavior or a failing contract test for policy and
configuration. Run focused checks while iterating, then the complete suite. Do
not modify unrelated files, weaken deterministic gates, or introduce public
behavior outside the tracking issue.

## Developer Certificate of Origin

Every commit must certify the [DCO 1.1](DCO). Sign off with your real name and a
reachable email address:

```bash
git commit -s -m "type: concise English summary"
```

The resulting commit contains:

```text
Signed-off-by: Your Name <your.email@example.com>
```

The sign-off certifies that you have the right to submit the contribution under
the repository's license; it is not a copyright assignment. Do not sign for
another person. If one of your commits lacks a valid sign-off, amend or rebase
your own commits and force-push your contribution branch safely. Maintainers do
not add certification on a contributor's behalf.

## Intellectual-property provenance checklist

Access to private material does not grant permission to publish or relicense it.
Include this completed checklist in any pull request that uses legacy or
third-party code, prompts, schemas, fixtures, tests, or documentation:

- [ ] I identified every legacy or third-party source used by this change.
- [ ] I recorded whether each source is public or private and its owner/license.
- [ ] I classified the contribution as original, behavioral clean-room, adapted, or verbatim.
- [ ] Adapted/verbatim material has reviewable MIT-compatible publication authority.
- [ ] Required notices and attribution are preserved.
- [ ] No secrets, credentials, customer/personal data, private infrastructure, or confidential business information are included.

For the private Go Yoda, BetaUp, and MWTC material, the safe default is a
**behavioral clean-room** contribution: record externally observable inputs,
outputs, ordering, gates, reason codes, and edge cases, then write new English
TypeScript and tests without copying private source or prose. The predecessor is
the compatibility oracle for PRD/spec behavior, not automatic relicensing
authority.

Adapted or verbatim private material requires evidence in the pull request that
the rights holder authorized publication under MIT. Secrets and customer or
confidential data are never accepted. **Unclear provenance blocks merge.**

## Pull requests

A pull request must:

- link its issue with `Closes #<number>` when it completes that issue;
- explain the design choice and alternatives when judgment was required;
- describe public-contract, compatibility, state, migration, and security impact;
- list exact verification commands and current results;
- include useful failure evidence from the test-first cycle;
- complete the provenance checklist when legacy or third-party material was used;
- contain only signed-off commits and English repository content;
- leave no unresolved placeholder or unrelated opportunistic refactor.

Review feedback is evaluated technically and resolved with tests or evidence.
All available required checks must pass before merge. The Project Lead or a
delegated owner makes the final merge decision under [GOVERNANCE.md](GOVERNANCE.md).

## Where to ask for help

Use [SUPPORT.md](SUPPORT.md) to choose the correct public or confidential path.
Never include vulnerability details, credentials, private customer information,
or proprietary BetaUp/MWTC material in a public issue.
