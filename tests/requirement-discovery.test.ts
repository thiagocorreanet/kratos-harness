import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMAND_CLASSIFICATIONS,
  SYSTEMIC_CAUSE_CATEGORIES,
  extractRequirementDiscovery,
} from "@kratos/runtime/domain/requirement-discovery";
import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures/requirement-discovery");
const registry = ajvSchemaRegistry();

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtureRoot, `${name}.md`), "utf8");
}

async function record(name: string): Promise<Record<string, unknown>> {
  const extraction = extractRequirementDiscovery(await fixture(name));
  expect(extraction.kind).toBe("found");
  if (extraction.kind !== "found") throw new Error("fixture block is missing");
  return extraction.value as Record<string, unknown>;
}

function validate(value: unknown): boolean {
  return (
    registry.validate({
      id: "state.requirement-discovery",
      version: "1.0.0",
      value,
      structuralReasonCode: "runtime.state_corrupt",
    }).kind === "valid"
  );
}

describe("requirement discovery contract", () => {
  it("publishes closed demand and systemic-cause classifications", () => {
    expect(DEMAND_CLASSIFICATIONS).toEqual([
      "stated-problem",
      "proposed-solution",
      "defect",
      "improvement",
      "refactor",
      "external-obligation",
    ]);
    expect(SYSTEMIC_CAUSE_CATEGORIES).toEqual([
      "process",
      "system",
      "rule",
      "flow",
      "communication",
      "architecture",
      "operating-context",
    ]);
    expect(SYSTEMIC_CAUSE_CATEGORIES).not.toContain("person");
  });

  it.each(["vague-solution", "simple-skip", "both-applied"])(
    "extracts and validates the %s PRD fixture",
    async (name) => {
      const content = await fixture(name);
      expect(content.indexOf("## Problem discovery (5 Whys)")).toBeLessThan(
        content.indexOf("## Action framing (5W2H)"),
      );
      expect(validate(await record(name))).toBe(true);
    },
  );

  it("investigates a solution-shaped request before framing an action", async () => {
    const value = await record("vague-solution");
    expect(value.classification).toBe("proposed-solution");
    expect(value.problemDiscovery).toMatchObject({ applied: true });
    expect(value.actionFraming).toMatchObject({ applied: true });
    expect(value.validatedProblem).not.toBe(value.originalRequest);
  });

  it("records non-empty reasons when simple work skips both techniques", async () => {
    const value = await record("simple-skip");
    expect(value.problemDiscovery).toMatchObject({
      applied: false,
      investigation: [],
    });
    expect(value.actionFraming).toMatchObject({ applied: false });
    expect(
      (value.problemDiscovery as Record<string, unknown>).skipReason,
    ).toEqual(expect.stringMatching(/\S/u));
    expect((value.actionFraming as Record<string, unknown>).skipReason).toEqual(
      expect.stringMatching(/\S/u),
    );
  });

  it("keeps discovery, hypothesis, and action plan as separate statements", async () => {
    const value = await record("both-applied");
    expect(value.validatedProblem).toEqual(expect.stringMatching(/\S/u));
    expect(value.solutionHypothesis).toEqual(expect.stringMatching(/\S/u));
    expect(value.actionPlan).toEqual(expect.stringMatching(/\S/u));
    expect(
      new Set([
        value.validatedProblem,
        value.solutionHypothesis,
        value.actionPlan,
      ]),
    ).toHaveProperty("size", 3);
    expect(value.problemDiscovery).toMatchObject({ applied: true });
    expect(value.actionFraming).toMatchObject({ applied: true });
    expect((value.actionFraming as Record<string, unknown>).howMuch).toEqual(
      expect.stringMatching(/\S/u),
    );
  });

  it("allows adaptive investigation depth instead of exactly five whys", async () => {
    const value = await record("both-applied");
    const discovery = value.problemDiscovery as Record<string, unknown>;
    const step = (discovery.investigation as unknown[])[0];
    expect(step).toBeDefined();
    for (const length of [1, 3, 6]) {
      expect(
        validate({
          ...value,
          problemDiscovery: {
            ...discovery,
            investigation: Array.from({ length }, () => step),
          },
        }),
      ).toBe(true);
    }
  });

  it("refuses a skipped technique without a reason", async () => {
    const value = await record("simple-skip");
    const discovery = value.problemDiscovery as Record<string, unknown>;
    expect(
      validate({
        ...value,
        problemDiscovery: { ...discovery, skipReason: null },
      }),
    ).toBe(false);
  });

  it("refuses a skip reason when a technique was applied", async () => {
    const value = await record("both-applied");
    const framing = value.actionFraming as Record<string, unknown>;
    expect(
      validate({
        ...value,
        actionFraming: { ...framing, skipReason: "Not actually skipped." },
      }),
    ).toBe(false);
  });

  it("refuses a person category as the root cause", async () => {
    const value = await record("both-applied");
    const discovery = value.problemDiscovery as Record<string, unknown>;
    expect(
      validate({
        ...value,
        problemDiscovery: { ...discovery, causeCategory: "person" },
      }),
    ).toBe(false);
  });

  it("fails closed for absent, duplicate, and malformed machine blocks", async () => {
    expect(extractRequirementDiscovery("# Requirements\n")).toEqual({
      kind: "absent",
    });
    const content = await fixture("both-applied");
    expect(extractRequirementDiscovery(`${content}\n${content}`)).toEqual({
      kind: "malformed",
      cause: "duplicate-block",
    });
    expect(
      extractRequirementDiscovery(
        "<!-- KRATOS-REQUIREMENT-DISCOVERY-V1\n{nope}\nKRATOS-END-REQUIREMENT-DISCOVERY-V1 -->",
      ),
    ).toEqual({ kind: "malformed", cause: "invalid-json" });
  });
});
