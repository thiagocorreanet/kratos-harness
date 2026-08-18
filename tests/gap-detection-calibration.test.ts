import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CalibrationError,
  renderCalibration,
  scoreCalibration,
  validateCorpus,
} from "../scripts/lib/gap-calibration.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const registry = createSchemaRegistry();

interface Corpus {
  readonly thresholds: {
    readonly minimumRecall: number;
    readonly maximumFalseGaps: number;
  };
  readonly documents: readonly {
    readonly id: string;
    readonly path: string;
    readonly planted: boolean;
    readonly expected: readonly {
      readonly gapId: string;
      readonly category: string;
    }[];
  }[];
}

interface Observed {
  readonly model: string;
  readonly documents: readonly {
    readonly id: string;
    readonly proposal: unknown;
    readonly matches: readonly {
      readonly gapId: string;
      readonly matched: string | null;
    }[];
  }[];
}

let corpus: Corpus;
let observed: Observed;

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(repositoryRoot, relativePath), "utf8"),
  ) as unknown;
}

beforeAll(async () => {
  corpus = (await readJson("quality/gap-detection/corpus.v1.json")) as Corpus;
  observed = (await readJson(
    "quality/gap-detection/observed.v1.json",
  )) as Observed;
});

describe("the gap detection calibration corpus", () => {
  it("carries five planted and five clean requirement documents", () => {
    expect(corpus.documents.filter(({ planted }) => planted)).toHaveLength(5);
    expect(corpus.documents.filter(({ planted }) => !planted)).toHaveLength(5);
    expect(() => validateCorpus(corpus)).not.toThrow();
  });

  it("plants every category in the closed set", () => {
    expect(
      new Set(
        corpus.documents.flatMap(({ expected }) =>
          expected.map(({ category }) => category),
        ),
      ),
    ).toEqual(
      new Set([
        "ambiguous-rule",
        "document-contradiction",
        "owner-decision",
        "unconfirmed-dependency",
      ]),
    );
  });

  it("points at a readable document for every entry", async () => {
    for (const document of corpus.documents) {
      const text = await readFile(join(repositoryRoot, document.path), "utf8");
      expect(text.length).toBeGreaterThan(200);
    }
  });

  it("records every proposal under the published proposal contract", () => {
    for (const document of observed.documents) {
      if (document.proposal === null) continue;
      expect(
        registry.validate({
          id: "host.gap-proposal",
          version: "1.0.0",
          value: document.proposal,
          structuralReasonCode: "trail.uso",
        }).kind,
      ).toBe("valid");
    }
  });
});

describe("the recorded calibration pass", () => {
  it("reports what the pass found and what it raised falsely", () => {
    const report = scoreCalibration(corpus, observed);

    expect(report.planted).toBe(10);
    expect(report.found).toBe(10);
    expect(report.missed).toBe(0);
    expect(report.falseGaps).toBe(0);
    expect(report.recall).toBeGreaterThanOrEqual(
      corpus.thresholds.minimumRecall,
    );
    expect(report.falseGaps).toBeLessThanOrEqual(
      corpus.thresholds.maximumFalseGaps,
    );
    expect(renderCalibration(report)).toContain("recall: 1.00");
  });

  it("refuses an observation that credits a gap nobody planted", () => {
    const forged = {
      ...observed,
      documents: observed.documents.map((document) =>
        document.id === "clean-01"
          ? {
              ...document,
              proposal: {
                contractVersion: "1.0.0",
                hostContract: "1.0.0",
                gaps: [
                  {
                    gapId: "clean-01-invented",
                    category: "owner-decision",
                    weight: "low",
                    description: "An invented finding.",
                    recommendation: "Do nothing.",
                    reasoning: "There is nothing to decide here.",
                    documentRefs: [
                      "quality/gap-detection/documents/clean-01.md",
                    ],
                  },
                ],
              },
              matches: [
                {
                  gapId: "clean-01-invented",
                  matched: "planted-01-trial-length",
                },
              ],
            }
          : document,
      ),
    };

    expect(() => scoreCalibration(corpus, forged)).toThrow(CalibrationError);
  });

  it("counts an unmatched proposal on a clean document as a false gap", () => {
    const noisy = {
      ...observed,
      documents: observed.documents.map((document) =>
        document.id === "clean-02"
          ? {
              ...document,
              proposal: {
                contractVersion: "1.0.0",
                hostContract: "1.0.0",
                gaps: [
                  {
                    gapId: "clean-02-noise",
                    category: "ambiguous-rule",
                    weight: "low",
                    description: "A reading the document already settles.",
                    recommendation: "Leave the rule as written.",
                    reasoning:
                      "The edit window is measured from a stored time.",
                    documentRefs: [
                      "quality/gap-detection/documents/clean-02.md",
                    ],
                  },
                ],
              },
              matches: [{ gapId: "clean-02-noise", matched: null }],
            }
          : document,
      ),
    };

    expect(scoreCalibration(corpus, noisy).falseGaps).toBe(1);
  });
});
