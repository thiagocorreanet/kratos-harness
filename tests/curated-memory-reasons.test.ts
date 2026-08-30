import {
  renderResultJson,
  resultFor,
  validateResult,
} from "@kratos/runtime/domain/result";
import { describe, expect, it } from "vitest";

const matrix = [
  ["memory.candidate_missing", "failure", 2, true, true],
  ["memory.confirmation_stale", "blocked", 3, true, true],
  ["memory.curation_required", "blocked", 3, true, true],
  ["memory.lesson_incomplete", "failure", 2, false, false],
  ["memory.projection_drift", "blocked", 4, true, true],
] as const;

describe("curated memory public reason contracts", () => {
  it.each(matrix)(
    "%s preserves its public reason policy through result validation and JSON rendering",
    (reasonCode, status, exitCode, retryable, requiresEvidence) => {
      const result = resultFor(reasonCode, {
        why: [
          "The curated-memory operation has a stable public refusal cause.",
        ],
        evidence: requiresEvidence
          ? [{ kind: "artifact", ref: ".brain/03-memory/curated-memory.json" }]
          : [],
      });
      expect(() => validateResult(result)).not.toThrow();
      expect(result).toMatchObject({ reasonCode, status, exitCode, retryable });
      expect(result.reasonCode).not.toBe("runtime.internal_failure");
      expect(result.why).not.toEqual([]);
      expect(result.evidence.length === 0).toBe(!requiresEvidence);
      expect(JSON.parse(renderResultJson(result).stdout)).toMatchObject({
        reasonCode,
        status,
        exitCode,
        retryable,
      });
    },
  );
});
