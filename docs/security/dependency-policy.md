# Dependency Policy

Issue [#114](https://github.com/thiagocorreanet/mestre-yoda/issues/114)
(`QAL-04a`) asks which dependencies this project may take and what happens when
one of them turns out to be vulnerable. This document answers both, names the
file or test that enforces each answer, and states plainly where enforcement is
still absent.

[The threat model](threat-model.md) covers what the runtime is defended
against. This covers what it is built and shipped from. Reporting a
vulnerability, in a dependency or in this code, goes through
[SECURITY.md](../../SECURITY.md).

## Two dependency sets

A dependency is governed by where it ends up, not by which section of
`package.json` declares it.

**Redistributed.** `runtime/yoda.core.mjs` is a bundle. Whatever the entry
point reaches is inlined into it and shipped to every user of the plugin. That
set is read from the build's own metadata rather than from a manifest, because
a declared dependency and a bundled one are different things. Today it is four
packages:

| Package | Version | License |
| --- | --- | --- |
| `ajv` | 8.20.0 | `MIT` |
| `fast-deep-equal` | 3.1.3 | `MIT` |
| `fast-uri` | 3.1.5 | `BSD-3-Clause` |
| `json-schema-traverse` | 1.0.0 | `MIT` |

**Development.** Everything else: the compiler, the linter, the test runner,
the bundler, and their trees. None of it is shipped, but all of it runs on the
machine that produces the release, so a compromised build-time package is not
a smaller problem than a compromised shipped one — it is a larger one with a
shorter blast radius.

## License policy

A redistributed package may carry only a license that permits redistribution
in a modified, minified, combined form and asks for nothing back but the
notice:

`0BSD`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MIT`,
`Unlicense`.

A development-only package may additionally carry `BlueOak-1.0.0`,
`CC-BY-SA-4.0`, `MPL-2.0`, or `Python-2.0`. Those are file-scoped or
weak-copyleft terms that reach nothing this project distributes.

Refused in both sets: `GPL`, `LGPL`, and `AGPL` in every version; the
source-available families (`SSPL`, `BUSL`, `Elastic-2.0`); anything marked
`UNLICENSED`; and any package that declares no license at all. A package whose
license cannot be resolved is treated as refused until a person resolves it,
never as permitted by default.

One spelling exception is recorded rather than normalized away:
`@cspell/dict-en-common-misspellings` declares its license as `CC BY-SA 4.0`,
with spaces, which is not the SPDX identifier. `tests/dependency-policy.test.ts`
accepts that exact string and nothing else like it.

### Compliance means the notice ships

Every license on the redistributed list is permissive about modification and
combination, and strict about exactly one thing: the copyright notice and
license text travel with the copy. The bundler is configured with
`legalComments: "none"`, which strips those notices out of the minified
output — so they are rebuilt.

`scripts/build.mjs` reads the packages the bundle carries, copies each one's
license text out of the installed package unmodified, and writes
`runtime/THIRD-PARTY-NOTICES.txt` beside the runtime. It fails the build if a
bundled package declares no license or ships no license text.

`scripts/verify-package.mjs` re-derives the bundled set from the build metadata
and checks the staged file against it. A notices file the builder validated
against its own idea of what it bundled would prove only that the build agrees
with itself.

### Where the license policy is enforced

- `.github/dependency-review-config.yml` — the allowlist, applied to every
  dependency a pull request adds, before it merges.
- `tests/dependency-policy.test.ts` — the installed tree carries no license
  outside the allowlist; the bundled set carries none outside the narrower
  redistributed list; the configuration file and this document agree.
- `scripts/verify-package.mjs` — the staged plugin attributes exactly the
  packages it carries, each with license text under it.

## Vulnerability policy

`.npmrc` sets `audit=false`. That is deliberate — an advisory database check
that runs during install makes every `npm ci` depend on a network service and
reports against the whole tree rather than against the change — but it means
the check has to come from somewhere else. It comes from three places:

| Check | Runs on | Enforces |
| --- | --- | --- |
| `dependency-review.yml` | every pull request | no new dependency with a known advisory or a refused license |
| `codeql.yml` | push to `developer`/`main`, weekly | code-level defects in this repository's own sources |
| `dependabot.yml` | weekly | proposes the updates that pinning otherwise prevents |

Dependency review refuses at severity `low`, the lowest the API reports, in
every scope. A threshold above `low` would be this repository deciding in
advance, and without a reader, that some known vulnerable dependency is
acceptable. `warn-only` is never enabled: a finding is remediated or recorded,
not downgraded to a passing run.

### Ownership and remediation

Maintainers listed in [CODEOWNERS](../../.github/CODEOWNERS) own every finding
these checks produce; there is no separate security team to escalate to. The
targets below are good-faith commitments measured in business days, consistent
with the response expectations in [SECURITY.md](../../SECURITY.md):

| Severity | Redistributed set | Development set |
| --- | --- | --- |
| Critical | fix or remove within 7 days | fix or remove within 14 days |
| High | within 14 days | within 30 days |
| Moderate | within 30 days | next scheduled update |
| Low | next scheduled update | next scheduled update |

Remediation is, in order of preference: take the fixed version; drop the
dependency; or vendor a patch and record why. Until one of those lands, the
pull request that would introduce the finding does not merge.

An advisory that cannot be remediated on that schedule is recorded as an
explicit `allow-ghsas` entry in `.github/dependency-review-config.yml`, with
the advisory identifier, the reason, and the condition that would remove it.
An exception with no recorded reason is a failure of this policy, not a use of
it.

A vulnerability found in this project rather than in a dependency goes through
the private path in [SECURITY.md](../../SECURITY.md) and never through a public
issue, pull request, or advisory comment.

### Updates

Dependabot proposes weekly npm and GitHub Actions updates, grouped so a
toolchain that moves together is reviewed once. Every action in this
repository is pinned to a commit with its version in a trailing comment, and an
Actions update rewrites both — which is the only supported way to move a pin
without a person resolving a tag by hand.

A Dependabot pull request is a contribution like any other. The DCO gate in
`ci.yml` applies to it, so the range is signed with
`git rebase --signoff <base>` before it merges.

## Absent

Stated here rather than left for someone to discover:

**No SBOM.** This policy describes the dependency set; nothing yet publishes
it as a released artifact with checksums and provenance. That is
[#59](https://github.com/thiagocorreanet/mestre-yoda/issues/59) (`BET-02`), and
this policy is what that artifact will be checked against.

**No provenance or signature verification.** The lockfile pins every package to
an integrity digest from one registry, which proves the bytes did not change
after they were published. It does not prove who published them. npm provenance
attestations are not verified.

**CodeQL runs after a merge, not before one.** A fork pull request carries a
read-only token and cannot upload an analysis, so the scan runs on the push
that the merge produces and on a weekly schedule. A defect introduced by a pull
request is found on the branch, not on the pull request.

**Dependency review needs a repository setting.** The action reads the
dependency graph, which is enabled in repository settings rather than in a file
in this repository. Nothing here can assert it is on.

**No scanning of the released bundle.** The checks above look at the dependency
set and at this repository's sources. Nothing scans `runtime/yoda.core.mjs`
itself, which is the artifact a user actually runs.
