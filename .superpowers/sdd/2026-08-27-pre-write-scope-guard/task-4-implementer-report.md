# Task 4 implementer report: identical host pre-tool relays

## Status

Implemented synchronous Claude Code and Codex `PreToolUse` relays for the
binding structured mutation tools. Both hosts normalize one native invocation
to one ordered `host.pre-tool-use@1.0.0` request, invoke `kratos guard write`
once, pass unrelated tools unchanged, allow only the runtime's success result,
and deny every other or invalid runtime outcome. The distribution packages,
generated integrity manifests, shared conformance cases, and package smoke
coverage are ready for a DCO-signed conventional commit.

## RED/GREEN evidence

### RED 1: absent adapter relays

Before production code, the shared case table and both host suites were added
and run with:

```text
npm test -- tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts
```

The command exited 1: three files failed because
`createRuntimeGuardExecutor` and the host relay exports did not exist. The two
conformance suites skipped their 21 cases after setup failed, while the parity
case failed at the same missing boundary. This proved the tests reached a new
adapter surface rather than existing behavior.

### RED 2: absent packaged hooks

Before distribution changes:

```text
npm test -- tests/pre-tool-relay-distribution.test.ts
```

The command exited 1 with three failed tests. Both host packages lacked
`hooks/hooks.json`, and the Codex plugin manifest lacked its hook entry.

### GREEN: conformance, semantics, and packaging

After the minimal adapter and package implementation:

```text
npm test -- tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-distribution.test.ts
# 4 passed files; 25 passed tests
```

One shared table covers allowed create and update on both hosts, allowed delete
on Codex, feature deny, a non-empty allow miss, deny-over-allow, specification
and state allow bypass, ordered mixed `apply_patch` mutations, both move
endpoints where Codex supports them, malformed recognized payloads, and
unrelated pass-through. The parity test compares the complete runtime operation
result across equivalent Claude Code and Codex denials, including evidence.

### Full-suite integration RED/GREEN

The first full run exposed the existing contract-only adapter dependency rule:
four new adapter files imported Node built-ins. It exited 1 with one failed
architecture test, 160 passed files, and 4,199 passed tests. Process I/O and
synchronous spawning were moved to the two distribution launchers; target
normalization and operation-result handling remained shared adapter code.

The previously failing integration set then passed:

```text
npm test -- tests/architecture.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-distribution.test.ts
# 5 passed files; 135 passed tests
```

A fresh full run after that correction passed:

```text
npm test
# 161 passed files; 4,200 passed tests; 223.32s
```

## Official protocol evidence and choices

Protocol evidence was checked on 2026-08-27 against the requested primary
documentation only.

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) states
  that plugin hooks live at `hooks/hooks.json`, command input is one JSON object
  on standard input, `PreToolUse` supplies `tool_name`, `tool_input`, and
  `tool_use_id`, and `Write`/`Edit` supply an absolute
  `tool_input.file_path`. The current denial form is
  `hookSpecificOutput.permissionDecision: "deny"` with
  `permissionDecisionReason`. Command hooks are synchronous unless configured
  otherwise. Current docs list `Write` and `Edit`; the adapter also accepts the
  legacy `MultiEdit` file-path shape without giving it separate semantics.
- [Codex hooks reference](https://learn.chatgpt.com/docs/hooks) states that
  enabled plugins default to `hooks/hooks.json` or may declare that path in
  `.codex-plugin/plugin.json`. Codex reports file edits as canonical
  `tool_name: "apply_patch"`, with the structured patch text in
  `tool_input.command`, and accepts the same `PreToolUse` denial object. Command
  hooks are synchronous by default. Plugin hooks receive `PLUGIN_ROOT` and the
  compatible `CLAUDE_PLUGIN_ROOT` environment variable.

Therefore Claude Code matches `Write|Edit|MultiEdit`, Codex matches only
`^apply_patch$`, both launchers use the shared compatible plugin-root command,
and neither declares `async`. Bash, PowerShell, arbitrary local functions, and
MCP payloads are not parsed.

## Files changed

- Shared adapter relay/result validation:
  `packages/adapters/src/{index,pre-tool-use}.ts`
- Native target extraction:
  `packages/adapters/src/claude-code/pre-tool-use.ts` and
  `packages/adapters/src/codex/pre-tool-use.ts`
- Distribution configuration and launchers:
  `distribution/{claude-code,codex}/hooks/{hooks.json,pre-tool-use.mjs}`
- Codex manifest hook binding:
  `distribution/codex/.codex-plugin/plugin.json`
- Build integration: `scripts/build.mjs`
- Shared conformance and package evidence:
  `tests/{claude-code-pre-tool-relay,codex-pre-tool-relay,pre-tool-relay-parity,pre-tool-relay-distribution}.test.ts`
  and `tests/support/{pre-tool-relay-cases,runtime-guard-executor}.ts`

## Packaging and integrity

The established build now compiles the contract-only adapter tree into the
embedded source runtime before copying each host's hook assets. The build script
continues to calculate `runtime.sourceTreeSha256` and the complete host-assets
digest, so there is no checked-in generated checksum to edit manually.

Fresh release-level evidence:

```text
npm run build && npm run package:verify
# Built /tmp/kratos-plugin-build/{claude-code,codex}
# Kratos package verification passed for Codex and Claude Code.
```

## Verification

All final commands exited 0:

```text
npm test -- tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-distribution.test.ts tests/host-adapter-contract.test.ts tests/runtime-distribution.test.ts tests/plugin-install.test.ts tests/package-verifier.test.ts tests/bundle-smoke.test.ts
# 9 passed files; 81 passed tests

npm run contracts:check
# 23 schemas; 14 legacy profiles; generated types current
npm run result:check
# 76 reasons; exits 0,1,2,3,4,5; 6 examples
npm run parity:check
# Discovery verified; established parity inventory unchanged
npm run typecheck
npm run lint
npm run format:check
npm run english:check
npm run spellcheck
git diff --check
# No diagnostics; formatting, English, and spelling checks passed.
```

## Self-review

Reviewed the complete implementation against the Task 4 brief and approved
spec. The adapters import contracts only; contain no glob, path, guardrail,
exception, reason-selection, shell-command, or MCP policy; preserve native
target order; represent a Codex move as ordered source/destination; and submit
one request to one synchronous runtime execution. A recognized malformed
payload produces an intentionally schema-invalid empty mutation list, so the
runtime—not the adapter—selects `guard.target_uninspectable`. The host output
allows only success/exit 0 and denies valid failure/blocked results, exit/result
mismatches, and malformed runtime output. The two launchers differ only in the
native adapter import and call, while the two hook configurations differ only
in their host matcher.

Per the explicit Task 4 instruction, no subagent was dispatched; this report
records the required self-review instead.

## Concerns

- Published policies remain immutable: existing write/scope reasons such as
  `guard.outside_allow` stay failure/exit 2, while
  `guard.target_uninspectable` stays blocked/exit 3. Both are denied by the
  host relay.
- Claude Code documents `Write` as create-or-overwrite but exposes no existence
  discriminator. It is normalized as `create`; `Edit` and legacy `MultiEdit`
  are `update`. The runtime's guard decision is target-based, so this label
  does not change policy, ordering, evidence, or atomicity.
- Node prints its established `stripTypeScriptTypes` experimental warning
  during `npm run build`; the build and package-verification commands still
  exit 0 and all generated digests verify.
