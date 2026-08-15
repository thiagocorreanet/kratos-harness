# Public beta pilot protocol

## Selection matrix

The pilot set must cover small and large repositories, monorepos and
single-project layouts, clean initialization and legacy migration, Claude Code
and Codex, and every supported native platform. Participation is explicit and
adds no hidden telemetry.

## Rollout

1. **Shadow:** Kratos records decisions but the existing process remains
   authoritative.
2. **Parallel:** Teams compare decisions and record every divergence with an
   owner and reproduction.
3. **Authoritative:** Kratos gates the selected projects; rollback remains
   available and rehearsed.

Each stage has a written entry decision, exit decision, time window, evidence
manifest, and rollback owner. Failure evidence is classified as parity,
migration, platform, host, security, performance, behavior, environment, or
process.

## Hard graduation criteria

- All mandatory compatibility rows pass.
- Supported migrations succeed or recover without losing the only valid copy.
- Native platform and deterministic real-host suites pass.
- No unresolved release-blocking security finding exists.
- Performance budgets pass on declared reference hardware.
- Every user-blocking defect has an accepted fix or a go/no-go blocker.
- The Project Lead approves the evidence-bound decision.

Go runtime retirement is prohibited before every hard criterion passes. A date
or majority vote cannot replace evidence.

## Evidence and privacy

Collect only digests, version observations, stable reason codes, durations, and
explicitly reviewed attachments. Never collect source, prompts, credentials, or
conversation content by default. Each participant can export and request
deletion of contributed evidence.
