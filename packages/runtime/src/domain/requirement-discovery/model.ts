export const DEMAND_CLASSIFICATIONS = Object.freeze([
  "stated-problem",
  "proposed-solution",
  "defect",
  "improvement",
  "refactor",
  "external-obligation",
] as const);

export const SYSTEMIC_CAUSE_CATEGORIES = Object.freeze([
  "process",
  "system",
  "rule",
  "flow",
  "communication",
  "architecture",
  "operating-context",
] as const);

export const REQUIREMENT_DISCOVERY_BLOCK = Object.freeze({
  open: "<!-- KRATOS-REQUIREMENT-DISCOVERY-V1",
  close: "KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->",
});

export type RequirementDiscoveryExtraction =
  | { readonly kind: "absent" }
  | {
      readonly kind: "malformed";
      readonly cause: "duplicate-block" | "unterminated-block" | "invalid-json";
    }
  | { readonly kind: "found"; readonly value: unknown };

/** Extract the single embedded record without interpreting or validating it. */
export function extractRequirementDiscovery(
  content: string,
): RequirementDiscoveryExtraction {
  const firstOpen = content.indexOf(REQUIREMENT_DISCOVERY_BLOCK.open);
  if (firstOpen === -1) return { kind: "absent" };

  const payloadStart = firstOpen + REQUIREMENT_DISCOVERY_BLOCK.open.length;
  const close = content.indexOf(
    REQUIREMENT_DISCOVERY_BLOCK.close,
    payloadStart,
  );
  if (close === -1) return { kind: "malformed", cause: "unterminated-block" };

  if (
    content.includes(REQUIREMENT_DISCOVERY_BLOCK.open, payloadStart) ||
    content.includes(
      REQUIREMENT_DISCOVERY_BLOCK.close,
      close + REQUIREMENT_DISCOVERY_BLOCK.close.length,
    )
  ) {
    return { kind: "malformed", cause: "duplicate-block" };
  }

  try {
    return {
      kind: "found",
      value: JSON.parse(content.slice(payloadStart, close).trim()) as unknown,
    };
  } catch {
    return { kind: "malformed", cause: "invalid-json" };
  }
}
