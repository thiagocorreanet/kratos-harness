export type AcceptanceCriterionKind = "main" | "edge";
export type AcceptanceCriterionOutcome = "passed" | "failed" | "not-run";

export interface AcceptanceCriterionDeclaration {
  readonly criterionId: string;
  readonly workUnit: string;
  readonly task: string;
  readonly criterionKind: AcceptanceCriterionKind;
  readonly checked: boolean;
  readonly ordinal: number;
  readonly line: number;
  readonly text: string;
  readonly normalizedDeclaration: string;
}

export type TaskDocumentObservation =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed"; readonly line: number }
  | { readonly kind: "duplicate"; readonly criterionId: string }
  | {
      readonly kind: "valid";
      readonly declarations: readonly AcceptanceCriterionDeclaration[];
    };
