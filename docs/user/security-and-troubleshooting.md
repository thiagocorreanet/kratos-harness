# Security and troubleshooting

## Security rules

- Treat host and model text as untrusted input.
- Keep policy, transition, and authorization decisions in the runtime.
- Bind approvals, migrations, repairs, and attestations to canonical digests.
- Do not persist prompts, secrets, source contents, or credentials in evidence.
- Refuse symlinks and paths that escape the selected project root.
- Verify package checksums, SBOM, provenance, versions, and host compatibility.

## Troubleshooting sequence

1. Run `kratos version` and `kratos handshake`.
2. Run `kratos doctor --root PATH`.
3. Run `kratos status --json` and inspect the stable reason code.
4. Run `kratos explain REASON_CODE`.
5. Preview migration or repair; do not authorize it until the digest and
   affected paths are understood.

Common findings:

| Finding | Meaning | Recovery |
| --- | --- | --- |
| Context unreadable | Managed configuration cannot be trusted | Restore or migrate a valid configuration |
| Revision conflict | State changed after observation | Re-read status and retry with the new revision |
| Dirty worktree | A transition requires a stable Git observation | Commit, stash, or explicitly clean the intended files |
| Stale approval | Bound content or policy changed | Review the new digests and issue a new approval |
| Evidence mismatch | Referenced bytes changed | Record new evidence after verifying the content |
| Lock conflict | Another operation owns the same scope | Wait for completion or recover an expired lease |
| Corrupt event chain | History integrity failed | Preserve files, audit, and use only an offered safe repair |

If diagnosis reports an unsupported or unrecoverable condition, preserve
`.brain`, stop mutation, and attach the redacted evidence bundle to a security
or support report.
