# Verification Evidence: Prompt Size Ceiling Enforcement (QAL-10)

**Issue**: [#qal-10](https://github.com/thiagocorreanet/kratos-harness/issues/qal-10)  
**Date**: 2026-08-31  
**Status**: Verified Pass  

---

## 1. Executive Summary

This document records verification evidence for the prompt size ceiling enforcement mechanism implemented under requirement QAL-10. The system introduces a deterministic ceiling catalog across five prompt categories, automated discovery of static and runtime-generated prompt surfaces across all supported host distributions (Claude Code, Codex, and Antigravity), rendered-form measurement, and continuous integration enforcement in `npm run verify`.

All 20 shipped prompt surfaces pass their respective ceilings with comfortable margins.

---

## 2. Acceptance Criteria Verification Ledger

| Criterion | Description | Status | Evidence / Verification |
| :--- | :--- | :--- | :--- |
| **AC1** | A prompt over its ceiling fails CI, and the failure names the file, the measured size, and the limit. | **PASS** | Verified via `tests/prompt-ceilings.test.ts` (`fails when a fixture prompt exceeds its category ceiling...`) and `scripts/check-prompt-ceilings.mjs`. |
| **AC2** | Every prompt the distribution ships falls under a declared category, and a new prompt file with no category fails rather than passing unchecked. | **PASS** | Verified via `tests/prompt-ceilings.test.ts` (`ensures every shipped markdown/prompt file in distribution/ is cataloged...`) and `scripts/check-prompt-ceilings.mjs`. |
| **AC3** | The check runs on the rendered form when the rendered form differs from the source. | **PASS** | Verified via `tests/prompt-ceilings-discovery.test.ts`, checking rendered outputs of phase agent definitions, feature document templates, and managed instruction blocks. |
| **AC4** | Both distributions (and Antigravity) are measured by the same rule. | **PASS** | Verified via `tests/prompt-ceilings.test.ts` (`applies identical rules and ceilings across host distributions...`) confirming host parity across Claude Code, Codex, and Antigravity. |
| **AC5** | The current prompt surface passes without any ceiling being chosen to accommodate it. | **PASS** | Verified via `scripts/check-prompt-ceilings.mjs` and `tests/prompt-ceilings.test.ts`; all 20 prompt surfaces pass with zero breaches against conservative pre-established ceilings. |

---

## 3. Shipped Prompt Surfaces Baseline Inventory

Measurements taken on 2026-08-31 using `node scripts/check-prompt-ceilings.mjs` (UTF-8 character counts):

| Category | Target Surface | Measured (chars) | Ceiling (chars) | Utilization | Margin | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `host-skill` | `distribution/claude-code/skills/kratos/SKILL.md` | 4,162 | 6,000 | 69.4% | +1,838 | **PASS** |
| `host-skill` | `distribution/codex/skills/kratos/SKILL.md` | 3,806 | 6,000 | 63.4% | +2,194 | **PASS** |
| `host-skill` | `distribution/antigravity/skills/kratos/SKILL.md` | 3,854 | 6,000 | 64.2% | +2,146 | **PASS** |
| `orchestrator-prompt` | `distribution/claude-code/agents/kratos-orchestrator.md` | 373 | 1,000 | 37.3% | +627 | **PASS** |
| `phase-agent-prompt` | `.codex/agents/code-implementer.toml` (rendered) | 3,953 | 8,000 | 49.4% | +4,047 | **PASS** |
| `phase-agent-prompt` | `.claude/agents/code-implementer.md` (rendered) | 3,953 | 8,000 | 49.4% | +4,047 | **PASS** |
| `phase-agent-prompt` | `.codex/agents/implementation-evaluator.toml` (rendered) | 5,023 | 8,000 | 62.8% | +2,977 | **PASS** |
| `phase-agent-prompt` | `.claude/agents/implementation-evaluator.md` (rendered) | 5,023 | 8,000 | 62.8% | +2,977 | **PASS** |
| `phase-agent-prompt` | `.codex/agents/prd-researcher.toml` (rendered) | 3,576 | 8,000 | 44.7% | +4,424 | **PASS** |
| `phase-agent-prompt` | `.claude/agents/prd-researcher.md` (rendered) | 3,576 | 8,000 | 44.7% | +4,424 | **PASS** |
| `phase-agent-prompt` | `.codex/agents/spec-planner.toml` (rendered) | 3,625 | 8,000 | 45.3% | +4,375 | **PASS** |
| `phase-agent-prompt` | `.claude/agents/spec-planner.md` (rendered) | 3,625 | 8,000 | 45.3% | +4,375 | **PASS** |
| `phase-agent-prompt` | `.codex/agents/spec-reviewer.toml` (rendered) | 4,178 | 8,000 | 52.2% | +3,822 | **PASS** |
| `phase-agent-prompt` | `.claude/agents/spec-reviewer.md` (rendered) | 4,178 | 8,000 | 52.2% | +3,822 | **PASS** |
| `feature-document-template` | `.brain/02-features/<feature>/00-prd.md` (template) | 2,960 | 3,500 | 84.6% | +540 | **PASS** |
| `feature-document-template` | `.brain/02-features/<feature>/01-design.md` (template) | 666 | 3,500 | 19.0% | +2,834 | **PASS** |
| `feature-document-template` | `.brain/02-features/<feature>/02-tasks.md` (template) | 779 | 3,500 | 22.3% | +2,721 | **PASS** |
| `feature-document-template` | `.brain/02-features/<feature>/03-summa.md` (template) | 744 | 3,500 | 21.3% | +2,756 | **PASS** |
| `managed-instruction-block` | `CLAUDE.md` (managed section) | 954 | 6,000 | 15.9% | +5,046 | **PASS** |
| `managed-instruction-block` | `AGENTS.md` (managed section) | 992 | 6,000 | 16.5% | +5,008 | **PASS** |

---

## 4. Verification Command Outputs

### 4.1 Prompt Ceilings Check Script (`npm run prompts:ceilings:check`)

```text
> kratos-harness@0.0.0-development prompts:ceilings:check
> node scripts/check-prompt-ceilings.mjs

=== Checking Prompt Size Ceilings ===

Discovered 20 shipped prompt surfaces across all categories.

Category                     | Measured / Limit    | Status   | Target
-------------------------------------------------------------------------------------
host-skill                   |     4162 / 6000     | PASS     | distribution/claude-code/skills/kratos/SKILL.md
host-skill                   |     3806 / 6000     | PASS     | distribution/codex/skills/kratos/SKILL.md
host-skill                   |     3854 / 6000     | PASS     | distribution/antigravity/skills/kratos/SKILL.md
orchestrator-prompt          |      373 / 1000     | PASS     | distribution/claude-code/agents/kratos-orchestrator.md
phase-agent-prompt           |     3953 / 8000     | PASS     | .codex/agents/code-implementer.toml (rendered)
phase-agent-prompt           |     3953 / 8000     | PASS     | .claude/agents/code-implementer.md (rendered)
phase-agent-prompt           |     5023 / 8000     | PASS     | .codex/agents/implementation-evaluator.toml (rendered)
phase-agent-prompt           |     5023 / 8000     | PASS     | .claude/agents/implementation-evaluator.md (rendered)
phase-agent-prompt           |     3576 / 8000     | PASS     | .codex/agents/prd-researcher.toml (rendered)
phase-agent-prompt           |     3576 / 8000     | PASS     | .claude/agents/prd-researcher.md (rendered)
phase-agent-prompt           |     3625 / 8000     | PASS     | .codex/agents/spec-planner.toml (rendered)
phase-agent-prompt           |     3625 / 8000     | PASS     | .claude/agents/spec-planner.md (rendered)
phase-agent-prompt           |     4178 / 8000     | PASS     | .codex/agents/spec-reviewer.toml (rendered)
phase-agent-prompt           |     4178 / 8000     | PASS     | .claude/agents/spec-reviewer.md (rendered)
feature-document-template    |     2960 / 3500     | PASS     | .brain/02-features/<feature>/00-prd.md (template)
feature-document-template    |      666 / 3500     | PASS     | .brain/02-features/<feature>/01-design.md (template)
feature-document-template    |      779 / 3500     | PASS     | .brain/02-features/<feature>/02-tasks.md (template)
feature-document-template    |      744 / 3500     | PASS     | .brain/02-features/<feature>/03-summa.md (template)
managed-instruction-block    |      954 / 6000     | PASS     | CLAUDE.md (managed section)
managed-instruction-block    |      992 / 6000     | PASS     | AGENTS.md (managed section)
-------------------------------------------------------------------------------------

SUCCESS: All prompt size ceilings passed.
```

### 4.2 Vitest Prompt Ceilings Test Suite Execution (`npx vitest run tests/prompt-ceilings*.test.ts`)

```text
 ✓ tests/prompt-ceilings-discovery.test.ts (3 tests)
 ✓ tests/prompt-ceilings-domain.test.ts (5 tests)
 ✓ tests/prompt-ceilings.test.ts (4 tests)

 Test Files  3 passed (3)
      Tests  12 passed (12)
```

---

## 5. Negative and Boundary Failure Modes

1. **Ceiling Breach Diagnostic**: When a prompt exceeds its ceiling limit, evaluation fails deterministically with an actionable error specifying the file path, measured character count, category limit, and category name:
   ```text
   Prompt size ceiling exceeded in fixtures/oversized-skill.md: measured 6001 chars, limit is 6000 chars (category: host-skill).
   ```
2. **Uncategorized Prompt Detection**: When an unmapped prompt file is introduced into `distribution/` without a declared category, the discovery check fast-fails immediately:
   ```text
   Uncategorized prompt file detected: distribution/unknown/skills/foo/SKILL.md. All shipped prompts must be declared under a valid category.
   ```
