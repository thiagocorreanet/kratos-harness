# Kratos completion status

Snapshot date: 2026-08-15

## Issue coverage

All 77 public source issues are present in `KRATOS_BACKLOG.md`: 32 closed
baseline issues and 45 open delivery issues. The public-source implementation
now includes the workflow, host, migration, observability, quality, release,
documentation, pilot, and post-1.0 design/prototype deliverables described by
those issues.

## Remaining implementation blocker

The frozen compatibility matrix contains 400 legacy Go v3 behavior rows:

- 378 are `not_started`;
- 22 are `in_progress`;
- 0 have the four evidence layers required for parity credit.

The public repository contains behavior summaries and cryptographic identities,
not the private Go implementation, private distribution files, or executable
oracle. Exact completion therefore requires authorized read access or supplied
clean archives for:

| Input | Frozen identity |
| --- | --- |
| `betaup-sistemas/mestre-yoda` | commit `632f1e9bb283cf83412ef3e9e0b642daefdb0784` |
| `betaup-sistemas/mestre-yoda-dist` | commit `e6e6803c9329a53d362217a8f829a2801c83609d` |
| Linux Go v3 oracle | SHA-256 `da4ec4a2394ae90a94722f633bcb9157ddc5ee0133f46540b7c2c700abe378b8` |

Hashes prove identity but cannot reconstruct behavior. Marking these rows
complete without the authorized inputs would be fabricated parity.

## Validation and external acceptance

These items do not represent missing source code, but they remain required to
close the original issues under their definitions of done:

- install the locked npm dependencies and run `npm run verify`;
- execute native platform and signed-in Claude Code/Codex suites;
- activate and verify GitHub branch rulesets and the protected release
  environment;
- publish and verify an immutable release candidate;
- run representative public pilots and record the Project Lead decision.

## Experimental extensions completed in source

Issues #63–#67 now have isolated callable prototypes and threat models for:

- deterministic risk-adaptive policy packs with floor enforcement and shadow
  comparison;
- independent dual-judge candidate evidence and explicit human escalation;
- opt-in tenant-safe Control Tower evidence publication, conflict handling,
  export, and deletion authorization;
- Ed25519 evidence attestations with digest binding, key validity, revocation,
  expiry, replay defense, and honest unsigned evidence.

They are intentionally not registered as stable 1.0 CLI commands.
