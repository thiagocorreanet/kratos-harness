# Mestre Yoda Maturity Roadmap

Mestre Yoda advances through evidence, not dates, feature counts, or demos. This
roadmap defines when the public rewrite may describe itself as Experimental,
Preview, Beta, or Stable. The linked issues remain the detailed source of scope;
this document is the promotion contract.

No calendar date or feature demo promotes the project. Every criterion for the
next stage must be backed by current, reproducible evidence. Promotion criteria
cannot be waived. If equivalent evidence does not exist, the project remains at
its current maturity stage while maintainers revise scope or close the gap through
a separately reviewed public change.

## Experimental

**Current stage.** Experimental means the architecture and implementation are
being developed publicly while contracts may still change. There is no supported
installation or production-use promise.

The delivery sequence is visible through these public epics:

- [Foundation](https://github.com/thiagocorreanet/mestre-yoda/issues/1)
- [Compatibility Contract](https://github.com/thiagocorreanet/mestre-yoda/issues/8)
- [Deterministic Runtime](https://github.com/thiagocorreanet/mestre-yoda/issues/15)
- [SDD Workflow Parity](https://github.com/thiagocorreanet/mestre-yoda/issues/24)
- [Host Integrations](https://github.com/thiagocorreanet/mestre-yoda/issues/34)
- [Migration and Observability](https://github.com/thiagocorreanet/mestre-yoda/issues/40)
- [Quality Campaign](https://github.com/thiagocorreanet/mestre-yoda/issues/48)
- [Public Beta](https://github.com/thiagocorreanet/mestre-yoda/issues/57)

### Promotion to Preview

All exit criteria in Foundation, Compatibility Contract, Deterministic Runtime,
SDD Workflow Parity, and Host Integrations must pass. Evidence must show:

- the authoritative Go v3 oracle is frozen, inventoried, licensed appropriately
  for its role, and connected to a P0/P1 traceability matrix;
- schemas, reason/exit codes, state versions, fixtures, and differential
  comparison are versioned and reproducible;
- the bundled TypeScript runtime executes the complete local objective-to-done
  trail, and invalid transitions never mutate state;
- deterministic gates, content-bound approvals, budgets, evidence, recovery,
  lineage, and human acceptance pass differential and integration tests;
- Claude Code and Codex pass the shared adapter contract and end-to-end trail;
- host adapters remain thin, while `.brain/`, `.claude/`, and `.codex/` are the
  only generated project-owned state/configuration surfaces;
- the embedded ESM runtime works without a global Yoda binary, project runtime
  dependency, network lookup, or separately versioned executable;
- governance, security, contribution, package, and pull-request CI foundations
  are public and green.

## Preview

Preview means a versioned build is available for evaluation by users who accept
contract change and provide feedback. It is not a production-support promise.
Known limitations and supported evaluation paths must be explicit.

### Promotion to Beta

All exit criteria in Migration and Observability and the Quality Campaign must
pass. Public Beta documentation, release, developer-flow, and distribution work
in issues #58–#61 must also pass. Evidence must show:

- legacy discovery is no-write by default, and migration is transactional,
  backed up, verified, idempotent, and reversible;
- replay, integrity audit, divergence reporting, safe repair, evidence export,
  and the local dashboard preserve provenance and privacy;
- native supported platforms pass filesystem, Git, concurrency, failure-
  injection, migration, bundle, installation, and update tests;
- security, supply-chain, mutation, property/model, performance, and regression
  campaigns meet their published thresholds;
- Claude Code and Codex pass real host E2E tests against the final package;
- a new user can follow complete English installation, initialization, trail,
  diagnosis, update, migration, rollback, and uninstall documentation;
- release artifacts are reproducible and carry checksums, SBOM, provenance, and
  all required gate results;
- plugin installation, update, compatibility checks, rollback, and uninstall are
  atomic and version-coherent for both hosts;
- no release-blocking critical security, integrity, migration, recovery,
  compatibility, or host defect remains unresolved.

## Beta

Beta means the release is public, installable, documented, and supported within
explicit boundaries. It may still make pre-1.0 contract changes with migration
and release notes. Beta is the stage for representative pilot projects, not a
shortcut around their evidence.

### Promotion to Stable

The public-beta pilot issue #62 and every architecture retirement gate must pass.
Evidence must show:

- representative pilot projects install, initialize, complete a real trail,
  diagnose failures, update, migrate, roll back, and uninstall successfully;
- P0/P1 differential parity remains current against the frozen Go oracle;
- all supported operating systems and both host adapters pass release E2E using
  the final immutable artifacts;
- recovery, crash, concurrency, migration, and rollback drills demonstrate no
  hidden data loss or stale authorization;
- performance and regression budgets remain within published thresholds;
- security gates pass with no unresolved critical blocker, and disclosure/
  support procedures operate during pilots;
- known limitations, supported versions, compatibility policy, release decision,
  and rollback decision are public and accurate;
- the Project Lead records human acceptance of the complete evidence set.

## Stable

Stable begins only after all Beta promotion gates pass. Stable establishes
explicit supported versions, migration commitments, and compatibility promises.
It does not mean the project stops evolving; changes continue through versioned
contracts, deprecation, migration, review, and evidence.

## Regression and rollback

Promotion evidence must remain current. A failed security, integrity, parity,
migration, recovery, package, platform, or host gate blocks promotion even when
all planned features exist.

If evidence becomes invalid after a release, maintainers mark the affected stage
or version degraded, stop unsafe promotion/distribution, publish the safe impact,
and use the tested rollback or remediation path. A stage label may be downgraded
when its guarantees no longer hold. Restoring a label requires fresh evidence,
not an assertion that the regression is probably harmless.

## Go predecessor retirement

The private Go v3 implementation remains the behavioral oracle until all of the
following are proven:

- the parity inventory covers every required surface with an owner and fixture;
- P0/P1 differential parity and golden scenarios pass against the frozen oracle;
- legacy migration, backup, verification, and rollback pass representative data;
- Linux, Windows, macOS, Claude Code, and Codex release E2E pass as supported;
- clean package install, update, crash recovery, and rollback are proven;
- security and privacy gates have no unresolved retirement blocker;
- representative pilot projects complete the full lifecycle successfully.

A feature-complete TypeScript implementation, passing demo, or elapsed date does
not retire the oracle. Private predecessor code, prompts, fixtures, and prose may
enter the MIT repository only under the [provenance policy](CONTRIBUTING.md#intellectual-property-provenance-checklist).
