# Security Policy

Kratos is an experimental development harness that can inspect repositories,
write project state, invoke tooling, and influence agent workflows. Please report
security problems privately so maintainers can triage and coordinate a fix before
details expose users.

## Supported versions

No public release is supported yet.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Public tags/releases | None published |
| Private Go predecessor | No |
| Third-party forks | No |

When releases begin, this table will list each supported line explicitly.
Support is never inferred from the existence of a tag, branch, fork, or private
legacy installation.

## Report a vulnerability

Use GitHub's private
[Report a vulnerability](https://github.com/thiagocorreanet/kratos-harness/security/advisories/new)
form. **Do not open a public issue**, pull request, discussion, or paste
containing suspected vulnerability, secret, or exploit details before
maintainers complete private triage and agree on coordinated disclosure.

Include when available:

- affected version, tag, or commit;
- impact and realistic attack scenario;
- prerequisites and affected platforms/hosts;
- minimal safe reproduction steps or proof of concept;
- logs with secrets, personal data, and private paths removed;
- suggested remediation and disclosure constraints;
- how you would like to be credited.

If the private form is temporarily unavailable, open a public issue asking only
for a private security contact. Do not include a vulnerability title, affected
component, reproduction clue, or other sensitive detail in that issue.

## Response expectations

These are good-faith targets measured in business days, not a paid support SLA:

- acknowledge a report within 3 business days;
- provide initial severity and scope triage within 7 business days;
- send a private status update at least every 14 days while the report is active;
- when feasible, target remediation for critical issues within 7 days and high
  issues within 30 days; other timing depends on impact and fix complexity.

Maintainers will privately accept, request information, identify a duplicate, or
explain why a report is invalid/out of scope. Valid reports are coordinated
through a fix, tests, an advisory, reporter credit, and a CVE request when
appropriate. Public disclosure waits until affected users have a reasonable
remediation path and timing is coordinated with the reporter.

## Safe research rules

Do not:

- access, retain, or publish data that is not yours;
- place real secrets, customer data, personal data, or proprietary material in a
  report or proof of concept;
- disrupt services, degrade availability, or perform destructive testing;
- use social engineering, phishing, credential attacks, or attacks against
  systems you do not own or lack permission to test;
- expand beyond the minimum access needed to demonstrate the issue;
- publish details before private triage and coordinated disclosure.

Stop testing when you encounter sensitive data or risk harm. Report the minimum
redacted evidence necessary for maintainers to reproduce the problem safely.

## Security scope examples

Useful reports include path traversal or unsafe symlink handling, command or
prompt injection that crosses a documented trust boundary, secret disclosure,
supply-chain compromise, signature/hash/evidence bypass, unauthorized state
mutation, unsafe migration, concurrency/fencing failure with integrity impact,
or plugin installation/update compromise.

General support questions, expected experimental limitations, and bugs without
security impact belong in the public paths described by [SUPPORT.md](SUPPORT.md).
