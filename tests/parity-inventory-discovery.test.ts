import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const discoveryPath = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5/discovery.json",
);
const inventoryLibrary = join(
  repositoryRoot,
  "scripts/lib/parity-inventory.mjs",
);

interface Entry {
  readonly key: string;
  readonly legacy_refs: readonly string[];
  readonly name: string;
  readonly provenance_id: string;
}

interface Discovery {
  readonly namespaces: Record<string, readonly Entry[]>;
}

let discovery: Discovery;
let rawDiscovery: string;

beforeAll(async () => {
  rawDiscovery = await readFile(discoveryPath, "utf8");
  discovery = JSON.parse(rawDiscovery) as Discovery;
});

const packages = [
  ".",
  "agents",
  "cmd/coveragegate",
  "cmd/yoda",
  "docs/bench/runs",
  "internal/acstate",
  "internal/benchassets",
  "internal/brain",
  "internal/budget",
  "internal/changelog",
  "internal/codexgen",
  "internal/complete",
  "internal/config",
  "internal/coordlock",
  "internal/coveragegate",
  "internal/decide",
  "internal/detect",
  "internal/doctor",
  "internal/gapbench",
  "internal/gapdetect",
  "internal/gaps",
  "internal/guard",
  "internal/guardrails",
  "internal/hook",
  "internal/hostio",
  "internal/initgen",
  "internal/judge",
  "internal/message",
  "internal/migrate",
  "internal/observe",
  "internal/partition",
  "internal/runlog",
  "internal/runop",
  "internal/schema",
  "internal/state",
  "internal/store",
  "internal/telemetry",
  "internal/trail",
  "internal/version",
  "internal/view",
  "internal/views",
  "providers",
  "references",
  "schemas",
  "scripts",
  "scripts/diststage",
  "scripts/releasecheck",
  "templates",
  "tests/fixtures/gap-bench",
];

const schemas = [
  "code-output.schema.json",
  "config.schema.json",
  "dashboard.schema.json",
  "eval-output.schema.json",
  "feature-state.schema.json",
  "guardrails.schema.json",
  "partition-proposal.schema.json",
  "prd-output.schema.json",
  "review-output.schema.json",
  "run-gaps.schema.json",
  "run-plan.schema.json",
  "run-state.schema.json",
  "scope.schema.json",
  "spec-output.schema.json",
];

const pluginFiles = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "CHANGELOG.md",
  "README.md",
  "THIRD_PARTY_NOTICES",
  "agents/README.md",
  "agents/code-implementer.md",
  "agents/implementation-evaluator.md",
  "agents/prd-researcher.md",
  "agents/spec-planner.md",
  "agents/spec-reviewer.md",
  "hooks.json",
  "hooks/hooks.json",
  "install.ps1",
  "install.sh",
  "providers/README.md",
  "providers/claude/context.tmpl",
  "providers/claude/models.json",
  "providers/claude/settings.tmpl",
  "providers/codex/agents-gen.json",
  "providers/codex/context.tmpl",
  "providers/codex/models.json",
  "providers/codex/settings.tmpl",
  "references/README.md",
  "references/agent-output-contract.md",
  "references/gap-detection.md",
  "references/problem-discovery.md",
  "schemas/README.md",
  ...schemas.map((name) => `schemas/${name}`),
  "skills/README.md",
  "skills/sdd-init/SKILL.md",
  "skills/sdd/SKILL.md",
  "templates/brain/00-business/README.md",
  "templates/brain/01-architecture/README.md",
  "templates/brain/01-architecture/adr/.gitkeep",
  "templates/brain/02-features/README.md",
  "templates/brain/02-features/_template/00-prd.md",
  "templates/brain/02-features/_template/01-design.md",
  "templates/brain/02-features/_template/02-tasks.md",
  "templates/brain/02-features/_template/03-summa.md",
  "templates/brain/02-features/_template/state.json",
  "templates/brain/03-memory/decisions.log",
  "templates/brain/03-memory/gotchas.md",
  "templates/brain/03-memory/task_metrics.md",
];

const reasonCodes = [
  "blocked.context_unreadable",
  "blocked.current_step_mismatch",
  "blocked.current_step_orphan",
  "blocked.dup_step_id",
  "blocked.empty_plan",
  "blocked.feature_mismatch",
  "blocked.feature_state_ilegivel",
  "blocked.gaps_ilegivel",
  "blocked.guardrails_ausente",
  "blocked.guardrails_ilegivel",
  "blocked.legacy_failed",
  "blocked.multi_in_progress",
  "blocked.no_runnable_step",
  "blocked.partition_ilegivel",
  "blocked.runid_mismatch",
  "blocked.state_unreadable",
  "blocked.stop_loss_budget",
  "blocked.stop_loss_flag",
  "blocked.unknown_dep",
  "brain_migration_pending",
  "complete.git_baseline_invalid",
  "complete.ignored_removed",
  "complete.observation_changed",
  "complete.state_missing",
  "complete.step_state_mismatch",
  "complete.undeclared_change",
  "complete.worktree_changed",
  "done.all_steps",
  "gate.aceitacao_final",
  "gate.aprovacao_spec",
  "gate.gaps_abertos",
  "gate.particionamento",
  "gate.prd_ausente",
  "guard.active_feature_corrupt",
  "guard.config_corrupt",
  "guard.config_missing",
  "guard.external_path",
  "guard.guardrails_corrupt",
  "guard.guardrails_missing",
  "guard.outside_allow",
  "guard.project_marker_corrupt",
  "guard.scope_corrupt",
  "guard.scope_deny",
  "guard.spec_artifact",
  "guard.spec_not_approved",
  "guard.uninspectable",
  "guard.write_block",
  "judge.auto_julgamento",
  "judge.modelo_divergente",
  "loop.blocked",
  "loop.halted",
  "loop.next_ready",
  "loop.stop_loss",
  "run.next_step",
  "run.resuming",
];

const commandForms = [
  "ac.check",
  "ac.flip",
  "bench.gaps",
  "gen.codex-agents",
  "guard.check",
  "guardrails.init",
  "migrate.brain",
  "partition.check",
  "unlock.stop-loss",
  "views.sync",
];

const flags = [
  "ac.check.--root",
  "ac.flip.--from-eval",
  "ac.flip.--root",
  "bench.gaps.--date",
  "bench.gaps.--detect",
  "bench.gaps.--fixtures",
  "bench.gaps.--force",
  "bench.gaps.--model",
  "bench.gaps.--out",
  "bench.gaps.--runs",
  "bench.gaps.--timeout",
  "bench.gaps.--yes",
  "budgets.--root",
  "complete.--root",
  "continue.--approve",
  "continue.--gate",
  "continue.--refuse",
  "continue.--revise",
  "continue.--root",
  "dashboard.--json",
  "dashboard.--root",
  "doctor.--init",
  "doctor.--root",
  "doctor.--worktree-local",
  "done.--root",
  "evidence.--root",
  "gaps-sync.--root",
  "gen.codex-agents.--root",
  "guard.check.--root",
  "guardrails.init.--root",
  "handoff.--root",
  "hook.--host",
  "hook.--root",
  "init.--answers",
  "init.--detect-root",
  "init.--force",
  "init.--host",
  "init.--merge",
  "init.--root",
  "init.--worktree-local",
  "judge.--executor-agent",
  "judge.--judge-agent",
  "judge.--root",
  "migrate.--root",
  "migrate.brain.--root",
  "migrate.brain.--yes",
  "objective.--replace",
  "objective.--root",
  "partition.check.--root",
  "start.--root",
  "stats.--root",
  "stats.--write",
  "status.--root",
  "step.--maintenance",
  "step.--rebaseline",
  "step.--root",
  "unlock.stop-loss.--root",
  "unlock.stop-loss.--run",
  "views.sync.--root",
];

describe("Go v3 discovery snapshot", () => {
  it("captures exact source and distribution sets", () => {
    expect(discovery.namespaces.command_forms?.map(({ name }) => name)).toEqual(
      commandForms,
    );
    expect(discovery.namespaces.flags?.map(({ name }) => name)).toEqual(flags);
    expect(discovery.namespaces.io_contracts?.map(({ name }) => name)).toEqual([
      "stderr.errors-and-reasons",
      "stdin.bench-gaps-detect",
      "stdin.hook-payload",
      "stdin.init-answers",
      "stdin.migrate-brain-confirmation",
      "stdin.step-maintenance",
      "stdin.unlock-confirmation",
      "stdin.validate-dash",
      "stdout.success-and-echo",
    ]);
    expect(discovery.namespaces.exit_codes?.map(({ name }) => name)).toEqual([
      "0.success-or-hook-continue",
      "1-domain-or-validation-failure",
      "2-usage-or-contract-failure",
      "3-gate-or-judge-refusal",
    ]);
    expect(discovery.namespaces.packages?.map(({ name }) => name)).toEqual(
      packages,
    );
    expect(discovery.namespaces.schemas?.map(({ name }) => name)).toEqual(
      schemas,
    );
    expect(discovery.namespaces.plugin_files?.map(({ name }) => name)).toEqual(
      pluginFiles,
    );
    expect(discovery.namespaces.workflows?.map(({ name }) => name)).toEqual([
      "ci.yml",
      "deep-verify.yml",
      "dist-sync.yml",
      "release.yml",
      "runner-smoke.yml",
    ]);
    expect(discovery.namespaces.reason_codes?.map(({ name }) => name)).toEqual(
      reasonCodes,
    );
  });

  it("uses sorted unique keys and metadata-only provenance", () => {
    const allEntries = Object.values(discovery.namespaces).flat();
    const keys = allEntries.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entries of Object.values(discovery.namespaces)) {
      expect(entries.map(({ key }) => key)).toEqual(
        entries.map(({ key }) => key).toSorted(),
      );
    }
    for (const entry of allEntries) {
      expect(Object.keys(entry).sort(), entry.key).toEqual(
        ["key", "legacy_refs", "name", "provenance_id"].sort(),
      );
      expect(entry.key).toMatch(/^[a-z][a-z0-9_-]+\.[^\s]+$/u);
      expect(entry.name).not.toBe("");
      expect(entry.legacy_refs.length, entry.key).toBeGreaterThan(0);
      expect(entry.provenance_id, entry.key).toBe("private-go-v3-hash-only");
      for (const reference of entry.legacy_refs) {
        expect(reference).not.toMatch(/^\/|^[a-z]:[\\/]|^\\\\|\.\./iu);
      }
    }
  });

  it("contains no private payload, URL, credential, or local path", () => {
    expect(rawDiscovery).not.toMatch(
      /[a-z][a-z0-9+.-]*:\/\/|git@|(?:^|[\s"'=])\/(?:home|Users|private|tmp|var|etc|opt|srv|mnt)\/|[a-z]:[\\/]|\\\\[a-z0-9._-]+[\\/]|BEGIN [A-Z ]*PRIVATE KEY|github_pat_|gh[pousr]_|AKIA[0-9A-Z]{16}/imu,
    );
    expect(rawDiscovery).not.toMatch(
      /"(?:content|payload|stdout|stderr|text|body|prompt)"\s*:/u,
    );
  });

  it.each([
    ["unknown field", "discovery.notes = 'customer data';"],
    [
      "private URL",
      "discovery.source.clone_url = 'ssh://private.invalid/oracle';",
    ],
    [
      "absolute path",
      "discovery.namespaces.commands[0].legacy_refs = ['C:\\\\private\\\\source.go'];",
    ],
  ])(
    "rejects a changed %s through the reusable validator",
    (_name, mutation) => {
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { validateDiscovery } from ${JSON.stringify(inventoryLibrary)};`,
        `const discovery = JSON.parse(readFileSync(${JSON.stringify(discoveryPath)}, "utf8"));`,
        mutation,
        `try { validateDiscovery(discovery); } catch (error) { console.error(error.message); process.exitCode = 1; }`,
      ].join("\n");
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        { cwd: repositoryRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/^Parity inventory validation failed:/u);
    },
  );

  it("rejects a private checkout that is not clean, detached, and pinned", () => {
    const script = [
      `import { validatePrivateCheckoutIdentity } from ${JSON.stringify(inventoryLibrary)};`,
      `try { validatePrivateCheckoutIdentity({ sourceTagObject: "720f0a35074451208a0673324d223803add249e0", sourceTagCommit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784", distributionTagCommit: "e6e6803c9329a53d362217a8f829a2801c83609d", sourceHead: "wrong", distributionHead: "e6e6803c9329a53d362217a8f829a2801c83609d", sourceBranch: "main", distributionBranch: "HEAD", sourceStatus: " M cmd/yoda/help.go", distributionStatus: "" }); }`,
      `catch (error) { console.error(error.message); process.exitCode = 1; }`,
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Parity inventory validation failed: private discovery identity does not match\n",
    );
    expect(result.stderr).not.toContain("cmd/yoda/help.go");
  });
});
import { spawnSync } from "node:child_process";
