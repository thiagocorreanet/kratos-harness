import { describe, expect, it } from "vitest";

import { canonicalizeProjectPath } from "@kratos/runtime/domain/paths";
import { matchesOrderedGlobs } from "@kratos/runtime/domain/write-guard";

describe("canonical path properties", () => {
  const samplePaths = [
    "src/index.ts",
    "src/domain/paths/canonicalize.ts",
    "package.json",
    ".brain/02-features/feat/scope.json",
    "docs/architecture/system-architecture.md",
    "tests/write-guard-path-safety.test.ts",
  ];

  it("is idempotent: normalizing twice gives the same result as normalizing once", () => {
    for (const sample of samplePaths) {
      const first = canonicalizeProjectPath(sample);
      expect(first.kind).toBe("canonical");
      if (first.kind === "canonical") {
        const second = canonicalizeProjectPath(first.path);
        expect(second).toEqual(first);
      }
    }
  });

  it("produces identical rule decisions for a path and its equivalent spellings", () => {
    const rules = ["src/**", "!src/internal/**", "package.json", ".brain/**"];

    const equivalentVariations: { original: string; variations: string[] }[] = [
      {
        original: "src/index.ts",
        variations: [
          "./src/index.ts",
          "src/./index.ts",
          "src//index.ts",
          "src/sub/../index.ts",
          "./src/sub/deep/../../index.ts",
        ],
      },
      {
        original: "package.json",
        variations: [
          "./package.json",
          "src/../package.json",
          ".//package.json",
          "././package.json",
        ],
      },
    ];

    for (const { original, variations } of equivalentVariations) {
      const canonical = canonicalizeProjectPath(original);
      expect(canonical.kind).toBe("canonical");
      if (canonical.kind !== "canonical") continue;

      const baseDecision = matchesOrderedGlobs(rules, canonical.path);

      for (const variation of variations) {
        const normalized = canonicalizeProjectPath(variation);
        expect(normalized.kind).toBe("canonical");
        if (normalized.kind !== "canonical") continue;

        expect(normalized.path).toBe(canonical.path);
        const variationDecision = matchesOrderedGlobs(rules, normalized.path);
        expect(variationDecision).toBe(baseDecision);
      }
    }
  });
});
