import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import {
  compareGitPaths,
  decodeGitPath,
} from "../packages/runtime/src/domain/git/paths.js";

const digests = sha256Digests();

function createGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

function generateBytes(next: () => number): Uint8Array {
  const length = next() % 24;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = next() % 256;
  }
  return bytes;
}

const SEEDS = [1, 7, 13, 42, 99, 256, 1_009, 65_537];

describe("path ordering is a total order", () => {
  it.each(SEEDS)("is antisymmetric and transitive for seed %i", (seed) => {
    const next = createGenerator(seed);
    const paths = Array.from({ length: 40 }, () =>
      decodeGitPath(generateBytes(next), digests),
    );

    for (const left of paths) {
      for (const right of paths) {
        // `|| 0` normalizes the -0 that `-Math.sign(0)` produces: `toBe` uses
        // `Object.is`, which treats -0 and 0 as distinct, but antisymmetry
        // only cares about the sign, and 0 has no sign to disagree on.
        expect(Math.sign(compareGitPaths(left, right))).toBe(
          -Math.sign(compareGitPaths(right, left)) || 0,
        );
      }
    }

    const sorted = [...paths].sort(compareGitPaths);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(
        compareGitPaths(sorted[index - 1] as never, sorted[index] as never),
      ).toBeLessThanOrEqual(0);
    }
  });

  it.each(SEEDS)(
    "sorts identically regardless of input order for seed %i",
    (seed) => {
      const next = createGenerator(seed);
      const paths = Array.from({ length: 30 }, () =>
        decodeGitPath(generateBytes(next), digests),
      );

      expect([...paths].sort(compareGitPaths)).toEqual(
        [...paths].reverse().sort(compareGitPaths),
      );
    },
  );
});

describe("decoding never fabricates a name", () => {
  it.each(SEEDS)("emits no replacement character for seed %i", (seed) => {
    const next = createGenerator(seed);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const path = decodeGitPath(generateBytes(next), digests);
      if (path.kind === "text") {
        expect(path.value).not.toContain("�");
      } else {
        expect(path.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  it.each(SEEDS)("round-trips valid UTF-8 unchanged for seed %i", (seed) => {
    const next = createGenerator(seed);
    const encoder = new TextEncoder();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const text = String.fromCodePoint(
        ...[next() % 0x10_000].filter((code) => code < 0xd800 || code > 0xdfff),
      );
      if (text.length === 0) continue;

      expect(decodeGitPath(encoder.encode(text), digests)).toEqual({
        kind: "text",
        value: text,
      });
    }
  });
});
