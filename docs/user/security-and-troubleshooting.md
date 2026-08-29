# Security and troubleshooting

## Security rules

- Treat host and model text as untrusted input.
- Keep policy, transition, and authorization decisions in the runtime.
- Keep the phase map and canonical implementer/judge independence out of
  prompts and adapters; they are runtime-owned policy.
- Never infer observed model or effort from configuration, CLI flags, agent
  output, or conversation when the host reports `null`.
- Never fall back across roles, aliases, models, or efforts after a routing
  refusal.
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
| `model.config_migration_required` | The project configuration predates explicit model roles | Preview `kratos migrate config`, review the exact plan, then authorize it |
| `model.host_missing` or `model.role_missing` | The current host or mapped role is absent | Configure the named host and role, then request a fresh handoff |
| `model.resolution_unavailable` | The adapter catalog cannot resolve one canonical model | Correct the configured name or update the host adapter catalog |
| `model.effort_unsupported` | The resolved model does not offer the selected effort | Select one catalog-supported effort explicitly |
| `model.independence_violation` | Implementer and judge resolve to one canonical model | Configure a distinct canonical judging model; there is no warning-only mode |
| `model.assignment_stale` | Configuration, run, revision, phase, or assignment changed after handoff | Request a fresh handoff and rerun the phase |
| `model.execution_mismatch` | A known host-observed model or effort differs from selection | Correct host routing and rerun with a fresh handoff |

For a migration or routing refusal, inspect only bounded host/role/phase
subjects and stable reason codes. Public results intentionally do not echo an
invalid caller-supplied model name. Preserve the current `.brain` bytes before
manual recovery; do not rewrite old events to add missing execution metadata.

If diagnosis reports an unsupported or unrecoverable condition, preserve
`.brain`, stop mutation, and attach the redacted evidence bundle to a security
or support report.
