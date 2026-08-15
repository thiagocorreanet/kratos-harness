# Kratos inherited backlog

This document is the issue-level requirements snapshot used to reconstruct
Kratos. It records all 77 source issues observed on 2026-08-15.

- **Closed (32):** behavior to preserve and verify.
- **Open (45):** remaining requirement, epic, hardening item, or research idea.
- Source: <https://github.com/thiagocorreanet/mestre-yoda/issues>

Issue state is a snapshot, not a live synchronization mechanism.

## Closed source issues — preserved baseline

| Issue | Requirement |
| ---: | --- |
| [#1](https://github.com/thiagocorreanet/mestre-yoda/issues/1) | [EPIC] Foundation — repository, architecture, governance, and CI |
| [#2](https://github.com/thiagocorreanet/mestre-yoda/issues/2) | [FND-01] Write and approve the Yoda Observable architecture specification |
| [#3](https://github.com/thiagocorreanet/mestre-yoda/issues/3) | [FND-02] Establish the TypeScript repository and deterministic toolchain |
| [#4](https://github.com/thiagocorreanet/mestre-yoda/issues/4) | [FND-03] Add open-source governance, security, and contribution policies |
| [#5](https://github.com/thiagocorreanet/mestre-yoda/issues/5) | [FND-04] Publish an honest README, roadmap, and maturity model |
| [#6](https://github.com/thiagocorreanet/mestre-yoda/issues/6) | [FND-05] Configure issue templates, PR template, labels, and contribution workflow |
| [#7](https://github.com/thiagocorreanet/mestre-yoda/issues/7) | [FND-06] Create the pull-request CI foundation |
| [#9](https://github.com/thiagocorreanet/mestre-yoda/issues/9) | [CMP-01] Freeze and archive the authoritative Go v3 baseline |
| [#10](https://github.com/thiagocorreanet/mestre-yoda/issues/10) | [CMP-02] Build the exhaustive parity inventory and traceability matrix |
| [#11](https://github.com/thiagocorreanet/mestre-yoda/issues/11) | [CMP-03] Specify the universal result, error, reason-code, and exit-code contract |
| [#12](https://github.com/thiagocorreanet/mestre-yoda/issues/12) | [CMP-04] Version schemas and separate plugin, state, and host contracts |
| [#13](https://github.com/thiagocorreanet/mestre-yoda/issues/13) | [CMP-05] Build the golden-fixture and Go-vs-TypeScript differential harness |
| [#14](https://github.com/thiagocorreanet/mestre-yoda/issues/14) | [CMP-06] Define and prove the embedded runtime distribution contract |
| [#16](https://github.com/thiagocorreanet/mestre-yoda/issues/16) | [RUN-01] Implement runtime boundaries, ports, and dependency composition |
| [#17](https://github.com/thiagocorreanet/mestre-yoda/issues/17) | [RUN-02] Implement command routing and structured output rendering |
| [#18](https://github.com/thiagocorreanet/mestre-yoda/issues/18) | [RUN-03] Implement project discovery and `.brain` configuration resolution |
| [#19](https://github.com/thiagocorreanet/mestre-yoda/issues/19) | [RUN-04] Implement the schema registry and validation boundary |
| [#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20) | [RUN-05] Implement atomic filesystem transactions and crash recovery markers |
| [#21](https://github.com/thiagocorreanet/mestre-yoda/issues/21) | [RUN-06] Implement the append-only event store and cryptographic hash chain |
| [#22](https://github.com/thiagocorreanet/mestre-yoda/issues/22) | [RUN-07] Implement concurrency locks and recoverable work leases |
| [#23](https://github.com/thiagocorreanet/mestre-yoda/issues/23) | [RUN-08] Implement the Git service and repository-state classification |
| [#25](https://github.com/thiagocorreanet/mestre-yoda/issues/25) | [SDD-01] Implement idempotent project initialization and stack profiling |
| [#26](https://github.com/thiagocorreanet/mestre-yoda/issues/26) | [SDD-02] Implement the objective command and objective lifecycle |
| [#27](https://github.com/thiagocorreanet/mestre-yoda/issues/27) | [SDD-03] Implement the agent-only start and continue orchestration trail |
| [#35](https://github.com/thiagocorreanet/mestre-yoda/issues/35) | [ADP-01] Define the host adapter protocol and shared conformance suite |
| [#47](https://github.com/thiagocorreanet/mestre-yoda/issues/47) | [RUN-09] Implement universal dry-run plans and decision explanation primitives |
| [#94](https://github.com/thiagocorreanet/mestre-yoda/issues/94) | CI exceeds the 15-minute job limit since the event store landed |
| [#95](https://github.com/thiagocorreanet/mestre-yoda/issues/95) | Repository-wide DCO sign-off contract is stated but not met |
| [#99](https://github.com/thiagocorreanet/mestre-yoda/issues/99) | [RUN-07a] Harden the lock admission protocol against concurrent observers |
| [#101](https://github.com/thiagocorreanet/mestre-yoda/issues/101) | [RUN-05a] Extend the managed transaction surface to initialization destinations |
| [#108](https://github.com/thiagocorreanet/mestre-yoda/issues/108) | [RUN-06a] Reconcile the run layout with the frozen feature-scoped contract |
| [#114](https://github.com/thiagocorreanet/mestre-yoda/issues/114) | [QAL-04a] Add code scanning, dependency review, and the licence policy |

## Open source issues — Kratos delivery backlog

| Issue | Requirement | Kratos phase |
| ---: | --- | --- |
| [#8](https://github.com/thiagocorreanet/mestre-yoda/issues/8) | [EPIC] Compatibility Contract | Foundation verification |
| [#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15) | [EPIC] Deterministic Runtime | Foundation verification |
| [#24](https://github.com/thiagocorreanet/mestre-yoda/issues/24) | [EPIC] SDD Workflow Parity | MVP |
| [#28](https://github.com/thiagocorreanet/mestre-yoda/issues/28) | [SDD-04] Deterministic guardrails and gates | MVP |
| [#29](https://github.com/thiagocorreanet/mestre-yoda/issues/29) | [SDD-05] Content-bound approvals and challenges | MVP |
| [#30](https://github.com/thiagocorreanet/mestre-yoda/issues/30) | [SDD-06] Evidence, handoff, done, and acceptance | MVP |
| [#31](https://github.com/thiagocorreanet/mestre-yoda/issues/31) | [SDD-07] Status, statistics, and budgets | MVP |
| [#32](https://github.com/thiagocorreanet/mestre-yoda/issues/32) | [SDD-08] Doctor, explain, and failure diagnosis | MVP |
| [#33](https://github.com/thiagocorreanet/mestre-yoda/issues/33) | [SDD-09] Artifact lineage, model identity, and policy mode | MVP |
| [#34](https://github.com/thiagocorreanet/mestre-yoda/issues/34) | [EPIC] Host Integrations | Preview |
| [#36](https://github.com/thiagocorreanet/mestre-yoda/issues/36) | [ADP-02] Claude Code adapter, skills, agents, and hooks | Preview |
| [#37](https://github.com/thiagocorreanet/mestre-yoda/issues/37) | [ADP-03] Codex adapter, skills, and project instructions | Preview |
| [#38](https://github.com/thiagocorreanet/mestre-yoda/issues/38) | [ADP-04] Reconcile `.brain`, `.claude`, and `.codex` surfaces | Preview |
| [#39](https://github.com/thiagocorreanet/mestre-yoda/issues/39) | [ADP-05] Atomic plugin install, update, compatibility, and rollback | Preview |
| [#40](https://github.com/thiagocorreanet/mestre-yoda/issues/40) | [EPIC] Migration and Observability | Beta |
| [#41](https://github.com/thiagocorreanet/mestre-yoda/issues/41) | [MIG-01] Discover legacy Brain state and plan migration | Beta |
| [#42](https://github.com/thiagocorreanet/mestre-yoda/issues/42) | [MIG-02] Transactional migration, backup, verification, and rollback | Beta |
| [#43](https://github.com/thiagocorreanet/mestre-yoda/issues/43) | [MIG-03] Incremental state-contract upgrades | Beta |
| [#44](https://github.com/thiagocorreanet/mestre-yoda/issues/44) | [OBS-01] Replay, integrity audit, and divergence reports | Beta |
| [#45](https://github.com/thiagocorreanet/mestre-yoda/issues/45) | [OBS-02] Safe repair with preview and evidence | Beta |
| [#46](https://github.com/thiagocorreanet/mestre-yoda/issues/46) | [OBS-03] Evidence bundles and static local dashboard | Beta |
| [#48](https://github.com/thiagocorreanet/mestre-yoda/issues/48) | [EPIC] Quality Campaign | Continuous |
| [#49](https://github.com/thiagocorreanet/mestre-yoda/issues/49) | [QAL-01] Unit, property, and model-based tests | Continuous |
| [#50](https://github.com/thiagocorreanet/mestre-yoda/issues/50) | [QAL-02] Filesystem fault injection and concurrency campaigns | Continuous |
| [#51](https://github.com/thiagocorreanet/mestre-yoda/issues/51) | [QAL-03] Real-Git and cross-platform integration matrix | Continuous |
| [#52](https://github.com/thiagocorreanet/mestre-yoda/issues/52) | [QAL-04] Security tests and supply-chain scanning | Continuous |
| [#53](https://github.com/thiagocorreanet/mestre-yoda/issues/53) | [QAL-05] Black-box bundle, installation, and update tests | Beta |
| [#54](https://github.com/thiagocorreanet/mestre-yoda/issues/54) | [QAL-06] Mutation tests, performance baselines, and budgets | Beta |
| [#55](https://github.com/thiagocorreanet/mestre-yoda/issues/55) | [QAL-07] Platform, nightly, docs, and release Actions | Beta |
| [#56](https://github.com/thiagocorreanet/mestre-yoda/issues/56) | [QAL-08] Real host E2E tests and model evaluations | Beta |
| [#57](https://github.com/thiagocorreanet/mestre-yoda/issues/57) | [EPIC] Public Beta | Beta |
| [#58](https://github.com/thiagocorreanet/mestre-yoda/issues/58) | [BET-01] Complete English documentation and examples | Beta |
| [#59](https://github.com/thiagocorreanet/mestre-yoda/issues/59) | [BET-02] Reproducible releases, checksums, SBOM, and provenance | Beta |
| [#60](https://github.com/thiagocorreanet/mestre-yoda/issues/60) | [BET-03] Integration flow and protected releases | Beta |
| [#61](https://github.com/thiagocorreanet/mestre-yoda/issues/61) | [BET-04] Version-coherent Claude Code and Codex distributions | Beta |
| [#62](https://github.com/thiagocorreanet/mestre-yoda/issues/62) | [BET-05] Public-beta pilots and graduation/rollback criteria | Stable |
| [#63](https://github.com/thiagocorreanet/mestre-yoda/issues/63) | [EPIC] Post-1.0 Ideas | Post-1.0 |
| [#64](https://github.com/thiagocorreanet/mestre-yoda/issues/64) | [FUT-01] Risk-adaptive rigor profiles and policy packs | Post-1.0 |
| [#65](https://github.com/thiagocorreanet/mestre-yoda/issues/65) | [FUT-02] Independent dual-judge validation | Post-1.0 |
| [#66](https://github.com/thiagocorreanet/mestre-yoda/issues/66) | [FUT-03] Optional team Control Tower | Post-1.0 |
| [#67](https://github.com/thiagocorreanet/mestre-yoda/issues/67) | [FUT-04] Signed evidence and remote verification | Post-1.0 |
| [#68](https://github.com/thiagocorreanet/mestre-yoda/issues/68) | [QAL-09] Repository-wide English-only enforcement | Continuous |
| [#106](https://github.com/thiagocorreanet/mestre-yoda/issues/106) | [RUN-07b] Re-elect lost admission and isolate unrelated scopes | MVP hardening |
| [#112](https://github.com/thiagocorreanet/mestre-yoda/issues/112) | [SDD-03a] Run state machine, start, and continue | MVP |
| [#113](https://github.com/thiagocorreanet/mestre-yoda/issues/113) | [ADP-01a] Approval, hook, timeout, and cancellation payloads | MVP |

## Kratos delivery and evidence ledger

Every issue above is represented in the source snapshot. Representation is not
the same as accepted completion: source-controlled engineering, executable
verification, repository configuration, real-host evidence, and human
acceptance are tracked separately.

| Issues | Source delivery | Evidence still required |
| --- | --- | --- |
| Closed #1–#27, #35, #47, #94, #95, #99, #101, #108, #114 | Preserved and renamed from the inherited TypeScript baseline. | The dependency-backed `npm run verify` sequence must pass on Kratos. |
| #28–#33, #112, #113 | Workflow state machine, gates, digest-bound approvals, verified evidence, handoff, done, diagnostics, budgets, lineage, and host-operation payloads are implemented. | TypeScript, lint, Vitest, coverage, and differential execution in a fully installed environment. |
| #106 | Bounded admission re-election and unrelated run-scope isolation are implemented. | Process-contention and fault-campaign execution on all supported platforms. |
| #34, #36–#39 | Thin Claude Code and Codex packages, shared runtime protocol, atomic install/update/rollback/commit/uninstall, and version coherence are implemented. | Credentialed E2E inside both real hosts. |
| #40–#46 | No-write discovery, deterministic plan, transactional copy, strict rollback, declared upgrade chains, replay audit, authorized repair, evidence bundles, and static dashboard are implemented. | Representative private legacy fixtures and end-to-end migration drills; private Go content is not available in this repository. |
| #48–#55 | Unit/property/fault suites, mutation and performance tooling, plus dedicated CI, platform, compatibility, documentation, security, nightly, package, and release workflows are present. | CI execution with installed dependencies, native runners, coverage, benchmark, scanning, and package artifacts. |
| #56 | Host contracts, deterministic host fixtures, a versioned behavioral rubric, known-good/bad calibration corpus, and calibration runner are present. | Real signed-in model/host evaluation is external and cannot be synthesized by source code. |
| #57–#61 | The complete user guide, examples, deterministic archives, checksums, SBOM/provenance workflow, documented integration flow, expected rulesets, ruleset verifier, and coherent host archives are present. | An actual immutable release, active repository rulesets, and release-environment approvals. |
| #62 | Pilot selection, shadow/parallel/authoritative rollout, privacy, hard graduation, rollback, and go/no-go templates are published. | Representative public pilots and Project Lead acceptance are human/external evidence. |
| #63–#67 | Approved extension boundary, threat models, and isolated callable prototypes cover inherited risk profiles, shadow comparison, dual judges, optional tenant-safe Control Tower publication/export/deletion, Ed25519 attestations, revocation, replay, and honest unsigned evidence. | Promotion from experimental modules into a stable public CLI remains a later product decision; the issue-scoped design/prototype source is present. |
| #68 | Repository prose is covered by the English-only checker; the local static run passes. | The same gate must remain green in CI. |
| #8, #15, #24 | The compatibility inventory, runtime, and SDD surfaces exist and are connected to the new implementation. | The frozen matrix remains `0 / 400`; P0/P1 differential evidence against the private oracle is not proven. |

The remaining acceptance order is therefore evidence-first: obtain the private
Go v3 source and distribution oracle to implement and compare the 400 legacy
rows, install exact dependencies and run the full verification suite, execute
platform and host E2E, activate repository protections, publish an immutable
candidate, then run the public pilots. Experimental extensions are source
prototypes and must not be described as stable CLI features.
