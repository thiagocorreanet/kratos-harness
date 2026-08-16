# Issue 114 Code Scanning and Dependency Policy Evidence

## Result

Issue [#114](https://github.com/thiagocorreanet/kratos-harness/issues/114)
(`QAL-04a`) adds the scanning half of `QAL-04` and the license and
vulnerability policy the released dependency set is measured against. What
follows is what was reproduced locally. The GitHub-hosted runs are on the pull
request itself; a scheduled CodeQL scan has by definition not run when the
workflow that schedules it is still under review.

Local verification used Node.js `24.18.0` and npm `11.16.0`:

```text
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/*.yml
```

`npm run verify` passed every gate: 3803 tests across 134 files, 100%
statements, branches, functions, and lines on the measured runtime surface,
and a verified standalone package. `actionlint` reported no diagnostic on any
of the four workflows.

## The license census this policy was written from

The allowlists in [the dependency policy](../security/dependency-policy.md)
were not chosen in the abstract. They were written against what the tree
actually contains, so the policy describes a set that exists rather than one it
would be pleasant to have. The 266 third-party packages installed by
`npm ci` declare:

| Declaration | Packages |
| --- | --- |
| `MIT` | 222 |
| `Apache-2.0` | 16 |
| `ISC` | 9 |
| `BSD-2-Clause` | 7 |
| `BSD-3-Clause` | 7 |
| `MPL-2.0` | 2 |
| `CC BY-SA 4.0` | 1 |
| `Python-2.0` | 1 |
| `BlueOak-1.0.0` | 1 |

No `GPL`, `LGPL`, `AGPL`, source-available, or undeclared license is present.
The single non-SPDX spelling, `CC BY-SA 4.0` from
`@cspell/dict-en-common-misspellings`, is recorded in the policy and accepted
by name rather than normalized.

`tests/dependency-policy.test.ts` re-runs that census on every test run and
refuses anything outside the allowlist. It asserts the walk found more than 200
packages first, so a walk that returned nothing cannot pass by having nothing
to refuse.

## The attribution gap this closed

`scripts/build.mjs` bundles with `legalComments: "none"`. The four packages the
bundle carries are licensed `MIT` and `BSD-3-Clause`, both of which permit
everything the build does to them except dropping the notice:

| Package | Version | License |
| --- | --- | --- |
| `ajv` | 8.20.0 | `MIT` |
| `fast-deep-equal` | 3.1.3 | `MIT` |
| `fast-uri` | 3.1.5 | `BSD-3-Clause` |
| `json-schema-traverse` | 1.0.0 | `MIT` |

Before this change the released plugin was three files and none of them
carried a notice. It is now four, and `runtime/THIRD-PARTY-NOTICES.txt` is
built from the installed packages on every build.

## Failure campaign against the notices verifier

`scripts/verify-package.mjs` re-derives the bundled set from the build metadata
rather than trusting the file the builder wrote. Each scenario below started
from a clean `npm run build`, changed one thing in the staged notices, and ran
`npm run package:verify`:

| Scenario | Reported failure |
| --- | --- |
| Heading removed, license text left in place | `does not attribute ajv 8.20.0 (MIT)` |
| Section appended for a package the bundle does not carry | `attributes unbundled left-pad 1.3.0 (WTFPL)` |
| First section's license text emptied, heading kept | `carries no license text for ajv 8.20.0 (MIT)` |
| Build-machine path appended to the file | `contains forbidden reference: node_modules` |

Each message is prefixed `Package verification failed: runtime/THIRD-PARTY-NOTICES.txt`.
The heading carries the version because the check matches on the exact package
directory the bundle read from: a nested copy is a different version than a
hoisted one, and a notice naming the wrong version attributes nothing.

Each is held by a test in `tests/package-verifier.test.ts`, so the guard is
proven to reject rather than assumed to.

## No token or sensitive path in what the new automation produces

The two new workflows produce no artifact and upload no log. Neither
references a secret, and `tests/supply-chain-contract.test.ts` asserts that
over the whole workflow directory rather than per file — which is what makes
the assertion apply to the next workflow as well as these two.

The artifact the pipeline does produce is unchanged: `ci.yml` uploads
`.ci-diagnostics/`, `coverage/`, and `dist/` on failure only, from same-repository
events only, and `tests/ci-workflow-contract.test.ts` continues to refuse
`.npm`, `npm-debug`, and environment paths in that list.

The one new staged file is held to the same reference rule as the bundle it
ships beside: `node_modules`, `/packages/`, and the absolute repository root
are refused in `runtime/THIRD-PARTY-NOTICES.txt` exactly as they are in
`runtime/kratos.core.mjs`. The last row of the campaign table above is that rule
failing on purpose.

## What is still absent

Stated here as well as in the policy, because an evidence document that lists
only what passed is the marketing version:

- no SBOM, provenance, or signature verification — `BET-02` (#59);
- CodeQL runs on the push a merge produces, not on the pull request, because a
  fork cannot upload an analysis;
- nothing scans the released bundle itself;
- dependency review depends on the dependency graph being enabled in
  repository settings, which no file in this repository can assert.
