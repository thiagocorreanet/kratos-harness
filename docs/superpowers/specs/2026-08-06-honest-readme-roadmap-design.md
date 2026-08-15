# Honest README, Roadmap, and Maturity Model Design

- Status: Approved
- Decision date: 2026-08-06
- Tracking issue: [#5](https://github.com/thiagocorreanet/mestre-yoda/issues/5)
- Depends on: [#2](https://github.com/thiagocorreanet/mestre-yoda/issues/2)
- Approval basis: Maintainer-authorized autonomous recommendation

## 1. Outcome

The repository front page explains what Mestre Yoda is, what exists today, what
does not exist, how contributors can validate the current source, and which
objective evidence is required for Experimental, Preview, Beta, and Stable.

A clean-room reader cannot mistake architectural intent, a usage preview, the
minimal internal smoke CLI, or the private Go predecessor for an installable
public product. Every displayed command works from a clean checkout at the
commit that documents it.

## 2. Approaches considered

| Approach | Advantages | Costs | Decision |
| --- | --- | --- | --- |
| Replace README with a short landing page | Easy to scan | Loses architecture, reliability, and public backlog context already approved | Rejected |
| Preserve the architecture narrative and add explicit availability boundaries plus a separate roadmap | Retains useful context, keeps front page honest, gives maturity gates room to be objective | Requires synchronized README/roadmap contract tests | Selected |
| Document planned installation commands with warnings | Helps readers imagine future packaging | Commands are copied, indexed, and run without their warnings; violates acceptance | Rejected |

## 3. README information architecture

The README retains the existing problem, principles, SDD trail, architecture,
planned capabilities, reliability, failure contract, community links, FAQ, and
license. It adds or strengthens these front-page paths:

1. **Real badges:** experimental status, the actual Documentation workflow on
   `main`, MIT license, and normative English. The workflow badge links to the
   workflow page and exposes its current pass/fail state.
2. **Current status:** a warning that this is an active rewrite with no supported
   installation, no production runtime, and no usable SDD commands. The checked-
   in bundle supports only `--help` and `--version` for toolchain smoke testing.
3. **Installation:** states that no supported method exists. It describes the
   planned plugin-embedded distribution concept without a shell/npm/marketplace
   command that could be mistaken for working installation.
4. **Usage preview:** names the planned agent trail and operational capabilities
   as conceptual interface only. It contains no runnable code block and clearly
   says the current bundle cannot execute them.
5. **Architecture:** preserves the no-global-binary model and conceptual
   ownership of `.brain/`, `.claude/`, and `.codex/`.
6. **Roadmap:** summarizes the four maturity stages and links `ROADMAP.md` for
   evidence gates, rollback, and legacy retirement.
7. **Development:** lists only clean-checkout commands that already work:
   `npm ci`, `npm run spellcheck`, `npm run verify`, `npm run build`, and
   `npm run package:verify`.
8. **Acknowledgements:** credits the private predecessor as a behavioral oracle
   without implying its source license, plus the open-source tools and community
   standards the new repository uses.

The README remains English and uses the exact architecture terms “embedded ESM
runtime,” “project-owned state,” “event log,” “host adapter,” and “human
acceptance.”

## 4. Installation and preview honesty contract

The strongest availability statement appears near the top and is repeated in
Installation and FAQ:

- there is no supported installation method or public distribution today;
- the repository is not production-ready;
- the existing ESM artifact is an internal foundation smoke artifact;
- only `--help` and `--version` exist today;
- `objective`, `start`, `continue`, `done`, and operational commands are planned,
  not runnable;
- legacy private Go installation/distribution instructions do not apply to this
  public rewrite;
- release installation instructions appear only after issue #61 supplies tested,
  version-coherent artifacts.

Planned distribution is described in prose: Claude Code and Codex receive thin
host adapters plus the same embedded `runtime/yoda.mjs`; user projects receive
only their `.brain/`, `.claude/`, and `.codex/` state/configuration surfaces.
There is no global Yoda binary and no project runtime `node_modules`.

## 5. Objective maturity model

`ROADMAP.md` is evidence-based, has no dates, and links each public epic.

### Experimental — current

The project may change contracts and is not installable. Promotion to Preview
requires all exit criteria of Foundation, Compatibility Contract, Deterministic
Runtime, SDD Workflow Parity, and Host Integrations, including:

- frozen Go oracle plus P0/P1 traceability and differential comparison;
- complete local objective-to-done trail with invalid transitions non-mutating;
- Claude Code and Codex shared adapter/E2E conformance;
- standalone embedded bundle with no global/project runtime dependency;
- published security, governance, contribution, and CI foundations.

### Preview

Preview is installable only for evaluation with change-tolerant users. Promotion
to Beta requires Migration and Observability, the Quality Campaign, and public-
beta documentation/release/distribution issues #58–#61:

- transactional migration, backup, rollback, replay, audit, and privacy-reviewed
  evidence;
- native platform, security, bundle, installation/update, host E2E, mutation,
  fault, concurrency, and performance gates at agreed thresholds;
- complete English user/reference docs;
- reproducible signed release artifacts with checksum, SBOM, and provenance;
- tested atomic install/update/rollback for both hosts;
- no unresolved release-blocking critical security, integrity, migration, or
  compatibility defect.

### Beta

Beta is public and supportable but may still change before 1.0. Promotion to
Stable requires issue #62 pilot evidence and all architecture retirement gates:

- representative projects install, initialize, complete, diagnose, update,
  migrate, roll back, and uninstall successfully;
- P0/P1 differential parity is maintained against the frozen oracle;
- supported native platforms and both hosts pass release E2E;
- recovery and rollback drills prove no hidden data loss;
- performance/regression budgets and security gates remain within thresholds;
- support/security processes operate during pilots with no unresolved critical
  blocker;
- release/rollback decisions and known limitations are public.

### Stable

Stable begins only after all Beta gates pass. It establishes explicit supported
versions and compatibility promises; it is not a declaration that the project
will never change.

Any regression in a promotion gate blocks promotion. A released stage may be
marked degraded or rolled back when security, integrity, migration, parity, or
host evidence becomes invalid. Marketing language never overrides gate evidence.

## 6. Go predecessor retirement

The private Go implementation remains the behavior oracle until the approved
architecture retirement gates pass: inventory complete, P0/P1 differential
parity, golden scenarios, migration/rollback, platform and host E2E, package
recovery, security, and pilots. Feature completeness or a working demo is not
retirement evidence.

The roadmap describes behavior and evidence only. It does not copy or claim MIT
rights over private predecessor source, prompts, fixtures, or documentation; the
issue #4 provenance policy remains mandatory.

## 7. Reproducible spelling check

CSpell `10.0.1` becomes an exactly pinned root development dependency. Root
script `spellcheck` scans tracked Markdown with `.cspell.json`; `verify` runs it
after formatting and before lint. The configuration:

- uses English dictionaries;
- respects Git ignores and excludes generated/dependency output and lockfiles;
- lists only legitimate project/tool names and stable domain vocabulary;
- does not hide whole documents or use broad regex exclusions;
- reports unknown words with suggestions and fails nonzero.

This dependency remains development-only, does not enter the bundle, and does
not change runtime install requirements. The deterministic toolchain docs and
design are updated to list the command and exact dependency.

## 8. Test-first reader contract

`tests/readme-honesty.test.ts` fails before README/ROADMAP changes and then
asserts:

- Documentation badge points to `.github/workflows/docs.yml` and `main`;
- README contains all required content categories and direct community links;
- unavailability, smoke-only CLI, and conceptual preview statements are explicit;
- no installation shell block or legacy private installation command exists;
- every shell command presented by README is a current clean-checkout development
  command found in `package.json` or standard `npm ci`;
- no-global-binary and project state ownership match the architecture;
- ROADMAP contains all stages, promotion headings, linked epics, objective gates,
  regression/rollback behavior, and Go retirement criteria;
- acknowledgements distinguish the predecessor's behavioral role and provenance.

Independent review receives a clean-room-reader prompt: read README without issue
context, state whether installation/production/maturity can be misunderstood,
and cite any misleading line. “No findings” is required before merge.

## 9. Actions boundary

The only status workflow badge is Documentation because it exists and validates
the files affected by this issue. Static badges may describe Experimental, MIT,
and English but cannot imply build/runtime health.

Issue #7 will add the fast Node pull-request workflow and may then add its real
badge. Issue #55 owns later platform, nightly, compatibility, security, and
release workflows. README must not display planned checks as if they run today.

## 10. Scope and compatibility

This issue changes public documentation, spelling validation, and tests only. It
does not implement installation, SDD commands, adapters, schemas, migration,
state, CI workflows, or releases. It does not alter the legacy PRD/spec parity
contract.

## 11. Acceptance mapping

| Issue requirement | Design section |
| --- | --- |
| Problem, principles, architecture, status, installation, usage, development, community, security, license, acknowledgements | 3–4 |
| Experimental → Preview → Beta → Stable objective roadmap | 5 |
| Active rewrite until compatibility evidence | 3–6 |
| No global binary and project-owned state | 3–4 |
| Only working commands documented | 4, 8 |
| Real workflow badges | 3, 9 |
| English and architecture terminology | 3 |
| Link and spelling checks | 7–8 |
| Clean-room maturity/installation review | 8 |
