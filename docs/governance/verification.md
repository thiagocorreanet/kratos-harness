# Governance and Community-Path Verification

- Verification date: 2026-08-06 (America/Sao_Paulo)
- Tracking issue: [#4](https://github.com/thiagocorreanet/kratos-harness/issues/4)
- Branch: `docs/issue-4-governance`
- Policy commit: `dc6e40d`
- Status: Complete

## Contribution path dry run

The README links the contribution guide, Code of Conduct, governance, support,
and security policies directly. The contribution guide then links DCO 1.1, the
pinned development toolchain, architecture/ADR rules, support routing, and the
mandatory intellectual-property provenance checklist. Every required policy is
reachable from README in one or two links.

The DCO trailer parser was exercised without creating a commit:

```bash
printf '%s\n' 'Example commit' '' 'Signed-off-by: Example Contributor <contributor@example.com>' | git interpret-trailers --parse
```

Observed output:

```text
Signed-off-by: Example Contributor <contributor@example.com>
```

This proves the documented trailer form is recognized by Git. It does not claim
automated enforcement, which remains owned by issues #6 and #7.

Every commit in the issue #4 branch was then inspected with
`git interpret-trailers --parse` and contains exactly one valid
`Signed-off-by` trailer from its author.

## Vulnerability path dry run

Private vulnerability reporting was enabled through the GitHub repository API.
The read-only state check returned:

```json
{"enabled":true}
```

The documented `security/advisories/new` URL resolved with HTTP 200. No report,
draft advisory, vulnerability detail, or notification was created. README,
SECURITY, SUPPORT, and the Code of Conduct all route confidential matters to the
enabled private form and prohibit premature public details.

## Repository verification

Using Node.js `v24.18.0` and npm `11.16.0`:

| Check | Result |
| --- | --- |
| `npm run format:check` | Pass |
| `npm run lint` | Pass, zero warnings |
| `npm run typecheck` | Pass, strict/no emit |
| `npm test` | Pass, 4 files and 16 tests |
| `npm run test:coverage` | Pass, 100% configured runtime statements/branches/functions/lines |
| `npm run build` | Pass, one 386-byte ESM artifact |
| `npm run package:verify` | Pass, isolated exact help/version |
| markdownlint | Pass, 22 Markdown files and zero errors |
| Lychee | Pass, 90 links and zero errors |
| `git diff --check` | Pass |

The community-health contract specifically checks seven policy/navigation
behaviors, required file presence, DCO/provenance rules, confidential security
routing, support boundaries, conduct attribution, governance, CODEOWNERS, and
unfilled-template rejection.

## Post-merge closure evidence

PR [#72](https://github.com/thiagocorreanet/kratos-harness/pull/72) merged as
`f10d4b3d2be6760c17ce7bbfae8d38b8da7d2bb8`. The following checks were then
performed against `main`:

| GitHub check | Observed result |
| --- | --- |
| Community profile | Health 85%; contribution, conduct, MIT license, and README files recognized |
| Code of Conduct classification | `code_of_conduct_file` non-null; adapted policy classified as `other` |
| Security policy | `/security/policy` resolved with HTTP 200 |
| CODEOWNERS errors | Empty `errors` array |
| Private vulnerability reporting | `enabled: true` |
| Documentation workflow | Successful (predecessor run `31141856101`) |

The remaining community-profile percentage belongs to issue and pull request
templates, intentionally owned by issue #6. GitHub recognizes the adapted Code
of Conduct as a valid custom community file rather than misidentifying it as the
unmodified bundled template.
