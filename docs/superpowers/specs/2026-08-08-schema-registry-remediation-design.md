# Schema Registry Re-evaluation Remediation Design

Issue [#19](https://github.com/thiagocorreanet/mestre-yoda/issues/19)
(`RUN-04`). Pull request
[#91](https://github.com/thiagocorreanet/mestre-yoda/pull/91). This design
records the corrections required by the clean-checkout, adversarial-input, and
coverage re-evaluation of head `994cc6e`.

## Problem

The registry architecture is sound, but four delivery claims are not yet true:

- the distribution suite reads ignored `dist/` artifacts before it builds them;
- Ajv can execute accessor-backed properties and then return the same dynamic
  object as a typed value;
- the existing `adapter-message@1.0.0` handshake output bypasses
  `prepareContract` and is serialized directly;
- the configured 100% coverage excludes `infra/schema`, the central Ajv
  implementation added by this issue.

The version fixture corpus also needs direct registry evidence for malformed,
unsupported, and migration-only identities.

## Approaches considered

### A: Repair only the failing CI order

Building before `runtime-distribution.test.ts` would make the current check
green, but it would leave executable accessors, an unused output boundary, and
misleading coverage evidence. This is insufficient for a P0 validation
boundary.

### B: Focused boundary remediation

Make distribution tests self-contained, reject non-inert input before Ajv,
connect the existing adapter output to `prepareContract`, include the registry
implementation in coverage, and complete version-boundary evidence. This is
the selected approach because it closes the demonstrated gaps without adding a
writer, event store, command, schema, reason code, or compatibility rule.

### C: Redesign all filesystem and event effects now

Typing every `write_file` and `append_event` effect around state contracts would
anticipate the transaction and event-store designs owned by `RUN-05` and
`RUN-06`. The current CLI has no state-mutating command. This approach is
deferred to issues #20 and #21 and remains outside #19.

## R1: Hermetic distribution verification

`runtime-distribution.test.ts` must build the bundle synchronously before it
reads the manifest, entry, core, or build metadata. The repository already runs
test files sequentially, and other artifact suites use this same explicit
build pattern. A focused invocation from a checkout with no `dist/` must pass;
neither `npm test` nor `npm run verify` may depend on an artifact left by an
earlier command.

Final evidence must start from a separate clean worktree with ignored build
artifacts absent. It must run the exact Node.js `24.18.0` and npm `11.16.0`
toolchain, the complete verification chain, and the GitHub Actions checks.

## R2: Inert JSON data before Ajv

Version classification remains first. Only a current version proceeds to a
descriptor-based data-shape guard before structural schema validation.

The guard accepts JSON primitives, arrays, ordinary objects, and null-prototype
objects. It recursively inspects own data descriptors without reading accessor
values. It rejects:

- own or inherited accessors;
- custom object prototypes;
- sparse or accessor-backed array positions;
- cycles and unsupported JavaScript values;
- proxies before invoking reflective traps.

Rejected data returns one sanitized structural diagnostic at the root pointer,
using the caller-selected existing reason policy. It exposes no property name,
value, exception, or engine text. No getter or proxy trap may execute. Ordinary
and null-prototype data objects retain their original identity after successful
validation.

Proxy detection may use Node's stable `util.types.isProxy` inside
`infra/schema`; domain and ports remain platform-neutral and retain their
existing dependency rules.

## R3: Revalidate the existing adapter output

The composition CLI must resolve `adapter-message@1.0.0` to the closed
`host.adapter-message` registry identity and current host contract. Before
applying an effect plan or writing stdout, it calls `prepareContract` with the
`trail.output_invalido` structural policy.

On success, the canonical text returned by `prepareContract` is the adapter
payload representation. On failure, the command fails closed through the
existing sanitized internal-failure result: no command effect and no rejected
payload byte reaches output. Result-contract commands continue to use the
existing dedicated `validateResult` and result renderers.

`runCommandLine` retains deterministic injection for tests while production
defaults to the single composition-owned schema registry. This integration adds
no command and changes no declared contract.

## R4: Honest coverage and complete version evidence

The coverage allowlist must include `packages/runtime/src/infra/schema/**`.
Statements, branches, functions, and lines remain at 100% across the expanded
scope. Tests must exercise catalog-integrity failures, diagnostic normalization,
registry error sanitization, and every data-shape guard branch with real code.

The registry fixture suite must directly exercise the committed state and host
version cases. Every registered contract is checked for a missing version, a
future version, and a family-applicable unsupported or migration-only version.
The family-level corpus also covers malformed, untrimmed, numeric, previous,
future, and legacy identities without changing the compatibility classifier.

## Compatibility and scope

The remediation changes no JSON Schema, generated declaration, public reason
code, compatibility window, legacy profile, parity row, or three-file package
inventory. The registry remains offline and embedded. It does not implement
atomic writes, event persistence, locks, Git behavior, migrations, or new CLI
commands.

Canonical adapter output may reorder object keys by the already documented
Unicode-code-point rule. This is the intended representation guarantee of
`RUN-04`; semantic fields and declared contract versions remain unchanged.

## Required evidence

- RED evidence for the clean distribution test, accessor/proxy probes,
  malformed adapter output, expanded coverage threshold, and missing version
  corpus cases;
- focused GREEN evidence for each correction;
- `npm run verify` from a clean worktree with no prior `dist/`;
- 100% coverage including `infra/schema`;
- exact three-file package verification and unchanged `0 / 400 (0.00%)`
  parity;
- green PR checks and a fresh independent whole-branch review.

The PR remains draft and issue #20 does not start until these corrections are
merged and issue #19 closes.
