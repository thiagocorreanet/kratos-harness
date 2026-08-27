import criterionIdSchema from "../../../schemas/contracts/acceptance-criterion-id.v1.schema.json" with { type: "json" };

export const ACCEPTANCE_CRITERION_ID_PATTERN = criterionIdSchema.pattern;
export const ACCEPTANCE_CRITERION_ID_MAX_LENGTH = criterionIdSchema.maxLength;

const acceptanceCriterionId = new RegExp(
  ACCEPTANCE_CRITERION_ID_PATTERN,
  "u",
);

/** Validate the one identifier grammar shared by documents and verdicts. */
export function isAcceptanceCriterionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ACCEPTANCE_CRITERION_ID_MAX_LENGTH &&
    acceptanceCriterionId.test(value)
  );
}
