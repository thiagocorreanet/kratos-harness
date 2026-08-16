# Pull request

## Linked issue and work ID

Closes #ISSUE_NUMBER

Work ID: `<STREAM-NN>`

## Outcome and design

Describe the observable outcome, selected design, alternatives considered, and
the explicit out-of-scope boundary. Link the approved design/ADR when required.

## Compatibility and public contracts

Describe effects on Go-v3 parity, PRD/spec behavior, commands, schemas, reason/
exit codes, fixtures, host contracts, documentation, and other public behavior.
Use `None` only with a concrete rationale.

## State, migration, security, and rollback

Describe project-state, event, filesystem, Git, concurrency, migration,
privacy/security, supply-chain, and rollback impact. Identify new trust
boundaries, permissions, secrets, or data handling. Use `None` with rationale
where a dimension does not apply.

## Deterministic test evidence

List exact focused and complete commands with current results, including test
counts, coverage/gate results, platforms, and artifact identity where relevant.

```text
command
observed result
```

## Prompt and model evaluations

List prompt/model evaluations only where deterministic tests cannot answer the
question, including model/host identity, sample size, rubric, and observed
limitations. Write `Not applicable` when none are required. A probabilistic
prompt or model evaluation is not a substitute for deterministic tests.

## Failure evidence

Show the initial failing test or contract check and explain why it failed before
the implementation. For a bug, include the minimal reproduction and regression
test. Do not include secrets, private data, or confidential vulnerability detail.

## Provenance

- Sources used (including whether each is public/private and its owner/license):
- Contribution method (`original`, `behavioral clean-room`, `adapted`, or `verbatim`):
- Publication authority and required notices for adapted/verbatim material:
- Confirmation that no secret, credential, customer/personal data, private
  infrastructure, or confidential business information is included:

## Checklist

- [ ] The PR contains one coherent outcome and no unrelated opportunistic refactor.
- [ ] The closing issue, epic, dependencies, work ID, design, and ADRs are linked.
- [ ] Public-contract, compatibility, state, migration, security, and rollback impact is explicit.
- [ ] Deterministic tests are separate from any prompt/model evaluations.
- [ ] Focused tests and the complete required verification suite pass.
- [ ] Failure evidence from the test-first cycle is included.
- [ ] Documentation and migration/recovery guidance are updated where required.
- [ ] All repository text and durable discussion use normative English.
- [ ] Every commit contains the contributor's own valid `Signed-off-by` DCO trailer.
- [ ] Legacy/third-party provenance and publication authority are reviewable.
- [ ] No unresolved placeholder, secret, private data, or confidential detail remains.
