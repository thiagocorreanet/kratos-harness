import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  normalizeManagedMutationPlan,
  type PathFingerprint,
} from "@mestre-yoda/runtime/domain/transactions";
import { describe, expect, it } from "vitest";

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function parentObservations(
  path: string,
): ReadonlyMap<string, PathFingerprint> {
  const segments = path.split("/");
  const entries: [string, PathFingerprint][] = [[path, { kind: "missing" }]];
  for (let length = 2; length < segments.length; length += 1) {
    entries.push([segments.slice(0, length).join("/"), { kind: "directory" }]);
  }
  return new Map(entries);
}

describe("managed mutation plan generated properties", () => {
  it("normalizes 200 generated safe paths deterministically without escaping", () => {
    const seed = 0x20_02_2026;
    const next = generator(seed);
    const segments = ["ordinary", "space name", "café", "中", "😀", "a.b"];

    for (let index = 0; index < 200; index += 1) {
      const depth = (next() % 4) + 1;
      const suffix = Array.from(
        { length: depth },
        () => segments[next() % segments.length] ?? "ordinary",
      ).join("/");
      const path = `.brain/${suffix}-${String(index)}`;
      const plan = planOf({
        kind: "write_file",
        path,
        content: `value-${String(index)}`,
      });
      const observed = parentObservations(path);
      const digest = (text: string): string => `digest:${text}`;
      const first = normalizeManagedMutationPlan(plan, observed, digest);
      const second = normalizeManagedMutationPlan(plan, observed, digest);

      expect(first, `seed=${String(seed)} path=${path}`).toEqual(second);
      expect(first.kind, `seed=${String(seed)} path=${path}`).toBe("ready");
      if (first.kind !== "ready") continue;
      for (const operation of first.plan.operations) {
        expect(operation.path.startsWith(".brain/")).toBe(true);
        expect(operation.path.startsWith(".brain/transactions/")).toBe(false);
        expect(operation.path).not.toContain("\\");
        expect(operation.path.split("/")).not.toContain("..");
      }
    }
  });

  it("rejects 200 generated unsafe paths", () => {
    const seed = 0x20_bad_2026;
    const next = generator(seed);
    const unsafe = [
      "outside/file",
      "/.brain/file",
      "C:/.brain/file",
      ".brain\\file",
      ".brain/../file",
      ".brain/./file",
      ".brain//file",
      ".brain/transactions/file",
      ".brain/Transactions/file",
      ".brain/file\u0000",
      ".brain/file\u007f",
    ];

    for (let index = 0; index < 200; index += 1) {
      const path = unsafe[next() % unsafe.length] ?? "";
      expect(
        () =>
          normalizeManagedMutationPlan(
            planOf({ kind: "write_file", path, content: String(index) }),
            new Map(),
            (text) => text,
          ),
        `seed=${String(seed)} path=${JSON.stringify(path)}`,
      ).toThrow(expect.objectContaining({ reasonCode: "guard.outside_allow" }));
    }
  });
});
