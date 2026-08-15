# Post-1.0 extension boundary

These experimental modules are implemented under
`packages/runtime/src/domain/extensions`. They are callable prototypes, but are
not registered in the 1.0 CLI. This keeps the local deterministic runtime fully
usable without a service, external judge, or signing key.

| Extension | Input | Output | Forbidden authority |
| --- | --- | --- | --- |
| Risk profiles | Trusted versioned pack and observed risk facts | Replayable selected profile and merged requirements | Weakening the organization floor |
| Dual judge | Two independently identified observations bound to equal digests | Candidate evidence or explicit human review | Mutating state or overriding a gate |
| Control Tower | Redacted, encrypted, signed evidence envelope | Optional outbound publication plan | Writing `.brain` or granting approval |
| Attestation | Digest-only claims and trusted key lifecycle | Offline typed trust result | Treating invalid evidence as unsigned success |

## Risk-adaptive profiles and policy packs

A pack declares selection authority, default and minimum profiles, inheritance,
ordered risk rules, requirements, version, and digest. Selection uses explicit
facts only. Profile inheritance can add gates, evidence, approvals, or judges;
merging takes the strictest numeric requirement and a sorted union. The
organization minimum is always a candidate, so a lower-ranked project default
cannot weaken it. Unknown profiles, duplicate identifiers, untrusted packs, and
inheritance cycles fail closed. The selected pack version and digest remain on
the decision for historical replay.

Threats include a malicious pack update, rule-order manipulation, hidden input,
cycle denial of service, and an approval-bypass profile. Mitigations are trust
verification at the package boundary, stable rule ordering, explicit facts,
cycle detection, and floor enforcement. Shadow evaluation compares candidate
decisions with recorded pilot history before a pack can be promoted.

## Independent dual judge

Each observation binds the same artifact digest, criteria digest, rubric
version, time, verdict, and an independence key. Exactly two distinct judge and
independence identities are required. Equal supported verdicts produce a
candidate; disagreement, unavailable service, timeout, stale content,
insufficient observations, or common identity requires human review. There is
no averaging or silent tie-break.

The module accepts no mutation port, prompt, source, credential, or approval
capability. Prompt injection therefore cannot directly change policy. A labeled
calibration corpus and weighted rubric live under `quality/evaluations`; false
positive and false negative trends are release evidence, not deterministic
truth.

## Optional Control Tower

The Tower is an opt-in consumer of encrypted, redacted, signed evidence. A
publish plan rejects tenant mismatch, read-only roles, unsigned evidence,
unencrypted data, and envelopes that declare source, prompt, or secret content.
Offline and disabled modes return a local-only result. Divergence always keeps
the local bundle authoritative. Tenant-scoped export and deletion require an
administrator role.

A production service must define authentication, authorization, encryption in
transit and at rest, retention, revocation, audit, deletion, export, offline
queues, and conflict handling before an API is approved. Hosted, self-hosted,
and static aggregation remain deployment choices; none can become a local
transition authority. Cross-tenant access, replay, tampering, compromised
server, deletion, and offline divergence are mandatory threat scenarios.

## Signed evidence and remote verification

An Ed25519 attestation signs canonical digest-only claims: subject and bundle
digests, issuer, key identifier, issue and expiry instants, and a nonce. Offline
verification checks claims digest, issuer/key trust, key validity, revocation,
expiry, replay, and signature. It needs no private project path or content.
Tampering or an unknown, revoked, expired, or invalid key returns a typed
failure. Absence of an attestation remains supported but is explicitly labeled
`unsigned-local-evidence`; invalid signed evidence is never downgraded to that
state.

Production key custody, rotation, revocation distribution, transparency logs,
selective disclosure, and issuer governance require a separate approved threat
model. Non-production keys and sanitized fixtures are the only prototype
inputs.
