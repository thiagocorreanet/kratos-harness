# README and Maturity Roadmap Verification

- Verification date: 2026-08-06 (America/Sao_Paulo)
- Tracking issue: [#5](https://github.com/thiagocorreanet/mestre-yoda/issues/5)
- Branch: `docs/issue-5-readme-roadmap`
- Reviewed implementation commit: `d246120`
- Status: Ready for pull request

## Command honesty

The README's complete development block was executed in its documented order
with Node.js `v24.18.0` and npm `11.16.0` from the exact lockfile.

| Presented command | Observed result |
| --- | --- |
| `npm ci` | Pass; 257 development packages installed from the lockfile |
| `npm run spellcheck` | Pass; 25 Markdown files and zero issues |
| `npm run verify` | Pass; formatting, spelling, lint, typecheck, 30 tests, coverage, build, and package verification |
| `npm run build` | Pass; one 386-byte embedded ESM smoke artifact |
| `npm run package:verify` | Pass; exact inventory, SHA-256, help, and version outside the checkout |

The package verification inventory was exactly `runtime/yoda.mjs`. Its SHA-256
was `24293983cba88bb6e96ba4586bb5492b5e84bd18a8d5f0b7b536e8ad8d2108ee`;
help was `Usage: yoda [--help | --version]`; version was
`0.0.0-development`. These observations prove foundation packaging only, not an
installable SDD product.

## Documentation checks

| Check | Observed result |
| --- | --- |
| CSpell 10.0.1 | 26 files, zero issues |
| markdownlint-cli2 0.20.0 | 26 files, zero errors |
| Lychee | 78 links checked, 55 unique, zero errors |
| `git diff --check` | Pass |
| DCO trailers | All four issue commits contain one `Signed-off-by` trailer |

The README badge targets the real
[`Documentation`](https://github.com/thiagocorreanet/mestre-yoda/actions/workflows/docs.yml)
workflow. Its most recent `main` run before publication was
[successful](https://github.com/thiagocorreanet/mestre-yoda/actions/runs/31142000139).
The pull-request run remains the publication gate.

## Independent review

The technical review compared the issue, design, plan, README contract test,
roadmap gates, and package scripts. It initially found an open-ended maturity
waiver and two command-test weaknesses. Promotion waivers were removed, ordered
build prerequisites were made explicit, and the test now parses exact scripts
and inventories all documented npm commands. The re-review reported no Critical,
Important, or Minor findings.

A clean-room reader received only README and ROADMAP. The first pass correctly
identified the current maturity and installation boundary but found present-tense
architecture copy that could imply delivery. All such copy was made explicitly
future-facing. The final clean-room pass reported no Critical, Important, or
Minor findings.

| Reader question | Verified answer | Public evidence |
| --- | --- | --- |
| Current maturity | Experimental active rewrite | README `Project status`; ROADMAP `Experimental` |
| Installation today | No supported method; clone is contribution-only | README `Installation` and FAQ |
| Working commands | The five ordered development commands above | README `Development` |
| Available runtime behavior | Internal bundle supports only help/version | README status and usage preview |
| Project-owned state | `.brain/`, `.claude/`, and `.codex/` | README principles and architecture |
| Runtime ownership | Future self-contained ESM inside the plugin package | README installation and architecture |
| Preview promotion | Foundation through host integration evidence | ROADMAP `Promotion to Preview` |
| Beta promotion | Migration, quality, documentation, and distribution evidence | ROADMAP `Promotion to Beta` |
| Stable promotion | Representative pilots and every retirement/release gate | ROADMAP `Promotion to Stable` |

No unavailable install or SDD command is presented as executable. Every
promotion criterion requires current reproducible evidence and cannot be waived.
