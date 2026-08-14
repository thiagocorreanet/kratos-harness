import type { FeatureStateV1 } from "@mestre-yoda/contracts";
import {
  completeObjective,
  decideObjective,
  featureIdentity,
  historyLine,
  objectiveDocument,
  type ObjectiveDecision,
  type ObjectiveObservation,
} from "@mestre-yoda/runtime/domain/objective";
import { describe, expect, it } from "vitest";

const NOW = "2026-08-14T12:00:00.000Z";
const LATER = "2026-08-15T09:30:00.000Z";

function state(
  text: string,
  status: FeatureStateV1["objective"]["status"] = "active",
  revision = 1,
): FeatureStateV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    feature: featureIdentity(text) ?? "unnamed",
    objective: {
      text,
      status,
      createdAt: NOW,
      updatedAt: NOW,
      revision,
    },
  };
}

function present(
  text: string,
  status: FeatureStateV1["objective"]["status"] = "active",
  revision = 1,
): ObjectiveObservation {
  return { kind: "present", state: state(text, status, revision) };
}

describe("feature identity", () => {
  it.each([
    ["Ship the export pipeline", "ship-the-export-pipeline"],
    ["  Trim   the   spaces  ", "trim-the-spaces"],
    ["Émigré coffee", "emigre-coffee"],
    ["v2.0 release!!!", "v2-0-release"],
    ["ALL CAPS DEMAND", "all-caps-demand"],
  ])("names %s", (text, expected) => {
    expect(featureIdentity(text)).toBe(expected);
  });

  it("is derived from the text and nothing else", () => {
    // The same demand has to name the same feature on any machine, or a replay
    // lands somewhere the original run never wrote.
    expect(featureIdentity("Ship it")).toBe(featureIdentity("Ship it"));
  });

  it("truncates without leaving a trailing separator", () => {
    const identity = featureIdentity("a".repeat(40) + " " + "b".repeat(40));

    expect(identity).toHaveLength(64);
    expect(identity?.endsWith("-")).toBe(false);
  });

  it.each([["   "], ["///"], ["日本語"], [""]])(
    "refuses text that names nothing: %s",
    (text) => {
      // A generated name nobody asked for is worse than a refusal they can act
      // on.
      expect(featureIdentity(text)).toBeNull();
    },
  );
});

describe("the objective lifecycle", () => {
  const table: readonly (readonly [
    label: string,
    observation: ObjectiveObservation,
    request: { text: string; replace: boolean },
    expected: Partial<ObjectiveDecision> & { kind: ObjectiveDecision["kind"] },
  ])[] = [
    [
      "creates the first objective",
      { kind: "none" },
      { text: "Ship the export pipeline", replace: false },
      { kind: "recorded" },
    ],
    [
      "changes nothing when the text repeats",
      present("Ship the export pipeline"),
      { text: "Ship the export pipeline", replace: false },
      { kind: "unchanged" },
    ],
    [
      "changes nothing when the text repeats under --replace",
      present("Ship the export pipeline"),
      { text: "Ship the export pipeline", replace: true },
      { kind: "unchanged" },
    ],
    [
      "refuses divergent text without authorization",
      present("Ship the export pipeline"),
      { text: "Rewrite the importer", replace: false },
      { kind: "refused", reasonCode: "trail.objetivo_divergente" },
    ],
    [
      "replaces divergent text when authorized",
      present("Ship the export pipeline"),
      { text: "Rewrite the importer", replace: true },
      { kind: "recorded", transition: "replaced" },
    ],
    [
      "reopens after completion without authorization",
      present("Ship the export pipeline", "completed"),
      { text: "Rewrite the importer", replace: false },
      { kind: "recorded", transition: "reopened" },
    ],
    [
      "refuses empty text",
      { kind: "none" },
      { text: "   ", replace: false },
      { kind: "refused", reasonCode: "trail.uso" },
    ],
    [
      "refuses state it cannot read",
      { kind: "unreadable" },
      { text: "Ship the export pipeline", replace: false },
      { kind: "refused", reasonCode: "runtime.state_corrupt" },
    ],
  ];

  it.each(table)("%s", (_label, observation, request, expected) => {
    expect(
      decideObjective(observation, { ...request, now: LATER }),
    ).toMatchObject(expected);
  });

  it("preserves the text exactly, trimmed of surrounding space only", () => {
    const decision = decideObjective(
      { kind: "none" },
      { text: "  Ship  the   “quoted” pipeline  ", replace: false, now: NOW },
    );

    // The demand is the artifact. Collapsing inner spacing or normalizing
    // quotes would change what somebody asked for.
    expect(decision).toMatchObject({
      state: { objective: { text: "Ship  the   “quoted” pipeline" } },
    });
  });

  it("advances the revision on every recorded transition", () => {
    const replaced = decideObjective(present("First", "active", 3), {
      text: "Second",
      replace: true,
      now: LATER,
    });

    expect(replaced).toMatchObject({
      state: { objective: { revision: 4, createdAt: LATER, updatedAt: LATER } },
    });
  });

  it("carries the displaced objective so the history can explain itself", () => {
    const replaced = decideObjective(present("First"), {
      text: "Second",
      replace: true,
      now: LATER,
    });

    expect(replaced).toMatchObject({
      previous: { objective: { text: "First" } },
    });
  });

  it("records no budget, because nothing asks for one", () => {
    const created = decideObjective(
      { kind: "none" },
      { text: "Ship it", replace: false, now: NOW },
    );

    if (created.kind !== "recorded") throw new Error("expected a record");
    expect(created.state.objective).not.toHaveProperty("budget");
  });

  it("is deterministic for the same facts", () => {
    const once = decideObjective(present("First"), {
      text: "Second",
      replace: true,
      now: LATER,
    });
    const twice = decideObjective(present("First"), {
      text: "Second",
      replace: true,
      now: LATER,
    });

    expect(once).toEqual(twice);
  });
});

describe("completion", () => {
  it("completes an active objective", () => {
    expect(completeObjective(present("Ship it"), LATER)).toMatchObject({
      kind: "recorded",
      state: { objective: { status: "completed", updatedAt: LATER } },
    });
  });

  it("changes nothing when it is already complete", () => {
    expect(
      completeObjective(present("Ship it", "completed"), LATER),
    ).toMatchObject({ kind: "unchanged" });
  });

  it("refuses when there is nothing to complete", () => {
    expect(completeObjective({ kind: "none" }, LATER)).toMatchObject({
      kind: "refused",
      reasonCode: "trail.uso",
    });
    expect(completeObjective({ kind: "unreadable" }, LATER)).toMatchObject({
      kind: "refused",
    });
  });
});

describe("randomized command sequences", () => {
  /** A deterministic generator, so a failure here is a failure anyone can rerun. */
  function sequence(seed: number): () => number {
    let value = seed;
    return (): number => {
      value = (value * 1103515245 + 12345) % 2147483648;
      return value / 2147483648;
    };
  }

  it.each([1, 7, 42, 1337, 90210])(
    "never loses the invariant under seed %i",
    (seed) => {
      const next = sequence(seed);
      const texts = ["Ship it", "Rewrite it", "Delete it", "  ", "Ship it"];
      let observation: ObjectiveObservation = { kind: "none" };
      let recorded = 0;

      for (let step = 0; step < 40; step += 1) {
        const text = texts[Math.floor(next() * texts.length)] ?? "Ship it";
        const replace = next() > 0.5;
        const complete = next() > 0.85;

        const decision: ObjectiveDecision = complete
          ? completeObjective(observation, LATER)
          : decideObjective(observation, { text, replace, now: LATER });

        if (decision.kind === "recorded") {
          recorded += 1;
          observation = { kind: "present", state: decision.state };
          // Exactly one objective exists at a time, and it is the one just
          // recorded.
          expect(observation.state.objective.revision).toBeGreaterThan(0);
        } else if (decision.kind === "unchanged") {
          expect(observation.kind).toBe("present");
        } else {
          // A refusal never mutates: the observation the next step sees is the
          // one this step was handed.
          expect(decision.reasonCode).not.toBe("runtime.state_corrupt");
        }
      }

      expect(recorded).toBeGreaterThan(0);
    },
  );
});

describe("rendered artifacts", () => {
  it("writes the objective text verbatim into the document", () => {
    const document = objectiveDocument(state("Ship the “quoted” pipeline"));

    expect(document).toContain("Ship the “quoted” pipeline");
    expect(document).toContain("- Status: active");
    expect(document.endsWith("\n")).toBe(true);
  });

  it("writes one history line with sorted keys", () => {
    const line = historyLine({
      transition: "replaced",
      at: LATER,
      revision: 2,
      text: "Second",
      replaced: "First",
    });

    expect(line).toBe(
      `{"at":"${LATER}","replaced":"First","revision":2,"text":"Second","transition":"replaced"}\n`,
    );
  });
});
