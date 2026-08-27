import type { FeatureScopeV1, GuardrailsV1 } from "@kratos/contracts";
import {
  decideWriteTarget,
  matchesOrderedGlobs,
  parseSummaryScope,
  renderSummaryScope,
  scopesAgree,
} from "@kratos/runtime/domain/write-guard";
import { describe, expect, it } from "vitest";

const scope = (
  allow: readonly string[],
  deny: readonly string[] = [],
): FeatureScopeV1 => ({
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  allow: [...allow],
  deny: [...deny],
});

const guardrails = (writeBlocks: readonly string[] = []): GuardrailsV1 => ({
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  policyMode: "standard",
  snapshots: true,
  managedPaths: [".brain"],
  writeBlocks: [...writeBlocks],
});

describe("ordered project-relative globs", () => {
  it.each([
    ["matches a single segment star", ["src/*.ts"], "src/index.ts", true],
    [
      "does not let a star cross a slash",
      ["src/*.ts"],
      "src/lib/index.ts",
      false,
    ],
    [
      "matches a single segment question mark",
      ["docs/?.md"],
      "docs/a.md",
      true,
    ],
    ["matches a nested globstar", ["src/**/*.ts"], "src/lib/ui/index.ts", true],
    ["matches a character class", ["docs/[a-z]?.md"], "docs/ab.md", true],
    [
      "honors a later negation",
      ["src/**", "!src/generated/**"],
      "src/generated/api.ts",
      false,
    ],
    [
      "re-enables a later matching rule",
      ["src/**", "!src/generated/**", "src/generated/keep.ts"],
      "src/generated/keep.ts",
      true,
    ],
  ])("%s", (_description, patterns, target, expected) => {
    expect(matchesOrderedGlobs(patterns, target)).toBe(expected);
  });
});

describe("summary scope translation", () => {
  it("round-trips code-formatted allow and deny bullets through one grammar", () => {
    const original = scope(
      ["src/**", "!src/generated/**"],
      [".env", "!fixtures/.env.example"],
    );
    const parsed = parseSummaryScope(renderSummaryScope(original));

    expect(parsed).toEqual({ kind: "valid", scope: original });
  });

  it("rejects a summary list bullet that is not a code-formatted glob", () => {
    const parsed = parseSummaryScope(
      `## File allowlist\n\n- src/**\n\n## File denylist\n`,
    );

    expect(parsed).toEqual({ kind: "malformed", line: 3 });
  });

  it("refuses a scope that the summary grammar cannot render and parse", () => {
    expect(() => renderSummaryScope(scope(["!!src/**"]))).toThrow(
      "Summary scope contains an unrenderable glob",
    );
  });

  it("detects reviewer scope drift without a second parser", () => {
    const recorded = scope(["src/**"], ["src/generated/**"]);
    const review = parseSummaryScope(renderSummaryScope(scope(["src/**"], [])));

    expect(review).toMatchObject({ kind: "valid" });
    if (review.kind !== "valid")
      throw new Error("expected a valid review scope");
    expect(scopesAgree(recorded, review.scope)).toBe(false);
    expect(
      decideWriteTarget({
        target: "src/index.ts",
        scope: recorded,
        reviewerScope: review.scope,
        guardrails: guardrails(),
      }),
    ).toEqual({
      kind: "refused",
      reasonCode: "guard.scope_corrupt",
      target: "src/index.ts",
    });
  });
});

describe("write scope decisions", () => {
  it.each([
    [
      "allows any target for an empty allowlist",
      scope([]),
      guardrails(),
      "outside/file.ts",
      "allowed",
    ],
    [
      "refuses an explicit feature deny before allow",
      scope(["src/**"], ["src/private/**"]),
      guardrails(),
      "src/private/key.ts",
      "guard.scope_deny",
    ],
    [
      "lets .brain bypass non-empty allow membership",
      scope(["src/**"]),
      guardrails(),
      ".brain/02-features/feature/scope.json",
      "allowed",
    ],
    [
      "does not let .brain bypass an explicit deny",
      scope(["src/**"], [".brain/**"]),
      guardrails(),
      ".brain/guardrails.json",
      "guard.scope_deny",
    ],
    [
      "applies project blocks before feature scope",
      scope(["src/**"]),
      guardrails(["private/**"]),
      "private/secret.txt",
      "guard.write_block",
    ],
    [
      "blocks a real environment file",
      scope([]),
      guardrails(),
      ".env.local",
      "guard.write_block",
    ],
    [
      "allows an environment example",
      scope([]),
      guardrails(),
      ".env.local.example",
      "allowed",
    ],
    [
      "blocks every migrations descendant",
      scope([]),
      guardrails(),
      "src/migrations/001.sql",
      "guard.write_block",
    ],
    [
      "blocks host instruction files by basename",
      scope([]),
      guardrails(),
      "packages/tool/AGENTS.md",
      "guard.write_block",
    ],
    [
      "keeps host configuration directories editable by default",
      scope([]),
      guardrails(),
      ".codex/config.toml",
      "allowed",
    ],
    [
      "refuses a target outside a non-empty allowlist",
      scope(["src/**"]),
      guardrails(),
      "docs/readme.md",
      "guard.outside_allow",
    ],
  ] as const)(
    "%s",
    (_description, featureScope, projectGuardrails, target, expected) => {
      const decision = decideWriteTarget({
        target,
        scope: featureScope,
        guardrails: projectGuardrails,
      });

      expect(
        decision.kind === "allowed" ? "allowed" : decision.reasonCode,
      ).toBe(expected);
      expect(decision.target).toBe(target);
    },
  );
});
