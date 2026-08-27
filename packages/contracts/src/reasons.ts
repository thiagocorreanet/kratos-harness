import reasonCatalog from "../catalogs/reason-codes.v1.5.json" with { type: "json" };

/** One catalog entry: the policy a result carrying this code must satisfy. */
export interface ReasonPolicy {
  readonly code: string;
  readonly description: string;
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly evidence: "required" | "optional" | "forbidden";
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

// JSON imports widen literals to `string`. The catalog contract tests prove
// that the checked artifact satisfies this shape before consumers use it.
export const REASON_CATALOG = reasonCatalog.reasons as readonly ReasonPolicy[];

const byCode = new Map(REASON_CATALOG.map((reason) => [reason.code, reason]));

export function reasonPolicy(code: string): ReasonPolicy | null {
  return byCode.get(code) ?? null;
}
