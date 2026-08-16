# Dependency Policy

Issue [#114](https://github.com/thiagocorreanet/kratos-harness/issues/114)
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

**Redistributed.** The temporary Codex and Claude Code packages carry
dependency-free JavaScript emitted from this repository's own TypeScript. The
runtime schema validator is also repository source. No `node_modules` tree or
third-party runtime package is copied into either plugin. Package verification
walks both host packages and rejects development-only files or dependencies.

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

### Compliance means the package states what it carries

Every plugin includes `runtime/THIRD-PARTY-NOTICES.txt`. The current file
states that the source-only runtime carries no third-party runtime code. If a
future change adds redistributed code, this policy requires its exact package,
version, license, and license text to be recorded before release.

### Where the license policy is enforced

- `.github/dependency-review-config.yml` — the allowlist, applied to every
  dependency a pull request adds, before it merges.
- `tests/dependency-policy.test.ts` — the installed development tree carries no
  license outside the allowlist, both plugins contain no dependency tree, and
  this document agrees with the configuration.
- `scripts/verify-package.mjs` — both staged plugins contain no TypeScript,
  source maps, `node_modules`, or symbolic links.

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

A Dependabot pull request is a contribution like any other, and the gates in
`ci.yml` apply to it unchanged.

**An update to a package that runs an install script does not carry itself.**
`.npmrc` sets `strict-allow-scripts=true`, and `package.json` approves each
install script at an exact version. A new release of such a package is new
attacker-reachable code that runs on every `npm ci`, including one a fork pull
request triggers, so it is approved again or not at all — the approval
deliberately does not follow a version bump.

The cost is that the bump and the approval have to travel together, and
Dependabot can only write the first half.
[#120](https://github.com/thiagocorreanet/kratos-harness/pull/120) bumped
`esbuild` from 0.28.1 to 0.28.2, merged with the approval still naming 0.28.1,
and `npm ci` then refused on `main` for everyone. Re-approve in the same pull
request as the bump:

```text
"allowScripts": { "esbuild@<new version>": true, ... }
```

`tests/supply-chain-contract.test.ts` holds the approved version against the
declared one, so a bump that leaves the approval behind now fails a test
instead of an install.

**A group carries compatible moves only.** Every group restricts itself to
`minor` and `patch`, so a major release leaves the group and arrives as its own
pull request. Grouping exists to spare a reviewer three pull requests that need
nothing from them; a major needs the opposite, and a group hides it.
[#119](https://github.com/thiagocorreanet/kratos-harness/pull/119) bumped
`@types/node` from 24 to 26 inside the `types` group, and the breaking change it
carried surfaced as four `TS2722` errors in the worker fixtures rather than as
anything the pull request said. The restriction does not refuse a major — it
refuses to review one as routine.

## Release evidence and remaining external controls

Stated here rather than left for someone to discover:

**SBOM, checksums, and build provenance.** `release.yml` creates a deterministic
plugin archive, `SHA256SUMS`, a CycloneDX SBOM, and a GitHub build-provenance
attestation. The workflow is executable, but a protected release environment
and published immutable release are external repository controls and therefore
must still be evidenced before promotion. The exact source-side gates are
documented in [release gates](../distribution/release-gates.md).

**Dependency signature verification.** The lockfile pins every package to an
integrity digest from one registry. The release attests the built artifact, but
npm publisher provenance and signatures are not independently verified during
installation.

**CodeQL runs after a merge, not before one.** A fork pull request carries a
read-only token and cannot upload an analysis, so the scan runs on the push
that the merge produces and on a weekly schedule. A defect introduced by a pull
request is found on the branch, not on the pull request.

**Dependency review needs a repository setting.** The action reads the
dependency graph, which is enabled in repository settings rather than in a file
in this repository. Nothing here can assert it is on.

**No scanning of the released bundle.** The checks above look at the dependency
set and at this repository's sources. Nothing scans `runtime/kratos.core.mjs`
itself, which is the artifact a user actually runs.
