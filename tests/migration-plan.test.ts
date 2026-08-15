import { describe, expect, it } from "vitest";

import {
  planBrainMigration,
  type MigrationEntry,
  type MigrationObservation,
  type MigrationPlan,
} from "@mestre-yoda/runtime/domain/migration";
import { sha256Digests } from "@mestre-yoda/runtime/infra/node";

const digests = sha256Digests();
const digest = (value: string): string => digests.sha256(value);

function file(path: string, content: string): MigrationEntry {
  return {
    path,
    kind: "file",
    sha256: digest(content),
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function observation(
  overrides: Partial<MigrationObservation> = {},
): MigrationObservation {
  return {
    candidates: ["project-brain"],
    legacy: [file("config.json", "{}\n")],
    destination: [],
    ...overrides,
  };
}

function ready(plan: MigrationPlan): Extract<MigrationPlan, { kind: "ready" }> {
  if (plan.kind !== "ready")
    throw new Error(`Expected a ready plan: ${plan.kind}`);
  return plan;
}

describe("the legacy Brain migration plan", () => {
  it("plans a copy for state the project does not hold", () => {
    const plan = ready(planBrainMigration(observation(), digest));
    expect(plan.actions).toEqual([
      {
        kind: "copy",
        source: "config.json",
        target: ".brain/config.json",
        sha256: digest("{}\n"),
        bytes: 3,
        reason: "absent_in_project",
      },
    ]);
    expect(plan.requiredBytes).toBe(3);
    expect(plan.reversible).toBe(true);
  });

  it("skips state the project already holds byte for byte", () => {
    const plan = ready(
      planBrainMigration(
        observation({ destination: [file("config.json", "{}\n")] }),
        digest,
      ),
    );
    expect(plan.actions[0]?.kind).toBe("skip");
    // Nothing to write means nothing to reserve space for.
    expect(plan.requiredBytes).toBe(0);
  });

  it("blocks on state the project holds differently", () => {
    const plan = planBrainMigration(
      observation({ destination: [file("config.json", "{ }\n")] }),
      digest,
    );
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") throw new Error("Expected a blocked plan");
    // The project's own state wins by default: overwriting it silently is how
    // a migration destroys the work it was meant to preserve.
    expect(plan.blocking).toHaveLength(1);
    expect(plan.blocking[0]).toMatchObject({
      kind: "conflict",
      reason: "differs_in_project",
      source: "config.json",
      target: ".brain/config.json",
    });
  });

  it("blocks when the project holds something that is not a file there", () => {
    const plan = planBrainMigration(
      observation({
        destination: [
          { path: "config.json", kind: "directory", sha256: null, bytes: 0 },
        ],
      }),
      digest,
    );
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") throw new Error("Expected a blocked plan");
    // There is no digest to compare against, and the plan says so rather than
    // inventing an empty one.
    expect(plan.blocking[0]).toMatchObject({
      kind: "conflict",
      targetSha256: null,
    });
  });

  it("blocks on an entry no transformation is declared for", () => {
    const plan = planBrainMigration(
      observation({
        legacy: [{ path: "socket", kind: "other", sha256: null, bytes: 0 }],
      }),
      digest,
    );
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") throw new Error("Expected a blocked plan");
    expect(plan.blocking[0]).toMatchObject({
      kind: "unsupported",
      reason: "not_a_regular_file",
    });
  });

  it("carries a directory across through the files it holds", () => {
    const plan = ready(
      planBrainMigration(
        observation({
          legacy: [
            { path: "02-features", kind: "directory", sha256: null, bytes: 0 },
            file("02-features/active", "login\n"),
          ],
        }),
        digest,
      ),
    );
    expect(plan.actions.map((action) => action.source)).toEqual([
      "02-features/active",
    ]);
  });

  it("refuses two candidate layouts instead of choosing one", () => {
    const plan = planBrainMigration(
      observation({ candidates: ["b-brain", "a-brain"] }),
      digest,
    );
    expect(plan).toEqual({
      kind: "ambiguous",
      candidates: ["a-brain", "b-brain"],
    });
  });

  it.each([
    ["no legacy layout", null],
    ["an empty legacy layout", [] as readonly MigrationEntry[]],
  ])("reports %s as nothing to migrate", (_label, legacy) => {
    expect(planBrainMigration(observation({ legacy }), digest)).toEqual({
      kind: "nothing_to_migrate",
    });
  });

  it("gives every planned byte a source, a target, and a reason", () => {
    const plan = ready(
      planBrainMigration(
        observation({
          legacy: [
            file("b.json", "b"),
            file("a.json", "a"),
            file("c.json", "c"),
          ],
          destination: [file("c.json", "c")],
        }),
        digest,
      ),
    );
    for (const action of plan.actions) {
      expect(action.source).not.toBe("");
      expect(action.target.startsWith(".brain/")).toBe(true);
      expect(action.reason).toBeTruthy();
    }
    expect(plan.requiredBytes).toBe(2);
  });

  it("orders actions by source so two runs render identically", () => {
    const forward = planBrainMigration(
      observation({
        legacy: [file("a.json", "a"), file("b.json", "b")],
      }),
      digest,
    );
    const reversed = planBrainMigration(
      observation({
        legacy: [file("b.json", "b"), file("a.json", "a")],
      }),
      digest,
    );
    expect(forward).toEqual(reversed);
    expect(ready(forward).planDigest).toBe(ready(reversed).planDigest);
  });

  it("changes its digest when the plan changes", () => {
    const first = ready(planBrainMigration(observation(), digest));
    const second = ready(
      planBrainMigration(
        observation({ legacy: [file("config.json", "{ }\n")] }),
        digest,
      ),
    );
    expect(first.planDigest).not.toBe(second.planDigest);
  });

  it("returns a plan a caller cannot edit", () => {
    const plan = ready(planBrainMigration(observation(), digest));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.actions)).toBe(true);
  });
});
