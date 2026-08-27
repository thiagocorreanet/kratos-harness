import type { FeatureScopeV1 } from "@kratos/contracts";

import { isPathGlob } from "./glob-policy.js";

export type SummaryScopeParse =
  | { readonly kind: "valid"; readonly scope: FeatureScopeV1 }
  | { readonly kind: "malformed"; readonly line: number };

const allowHeading = "File allowlist";
const denyHeading = "File denylist";

/**
 * Parse reviewer-owned scope sections without reading a document from disk.
 * Only exact code-formatted bullets are executable scope declarations.
 */
export function parseSummaryScope(content: string): SummaryScopeParse {
  const allow: string[] = [];
  const deny: string[] = [];
  let section: "allow" | "deny" | null = null;
  let seenAllow = false;
  let seenDeny = false;
  let comment = false;
  let fence: "`" | "~" | null = null;

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const fenceMarker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fenceMarker !== undefined) {
      const kind = fenceMarker[0] as "`" | "~";
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence !== null) continue;

    if (comment || line.trimStart().startsWith("<!--")) {
      comment = !line.includes("-->");
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading !== null) {
      section = null;
      if (heading[1]?.length !== 2) continue;
      const title = heading[2];
      if (title === allowHeading) {
        if (seenAllow) return malformed(lineNumber);
        seenAllow = true;
        section = "allow";
      } else if (title === denyHeading) {
        if (seenDeny) return malformed(lineNumber);
        seenDeny = true;
        section = "deny";
      }
      continue;
    }

    if (section === null || line.trim().length === 0) continue;
    const declaration = /^- `([^`]+)`\s*$/u.exec(line);
    if (declaration === null || !isPathGlob(declaration[1] ?? ""))
      return malformed(lineNumber);
    (section === "allow" ? allow : deny).push(declaration[1] ?? "");
  }

  if (!seenAllow || !seenDeny || comment || fence !== null) return malformed(0);
  return {
    kind: "valid",
    scope: {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      allow,
      deny,
    },
  };
}

/** Render the exact reviewer grammar consumed by parseSummaryScope. */
export function renderSummaryScope(
  scope: Pick<FeatureScopeV1, "allow" | "deny">,
): string {
  if (![...scope.allow, ...scope.deny].every(isPathGlob)) {
    throw new Error("Summary scope contains an unrenderable glob");
  }
  const lines = ["## File allowlist", ""];
  lines.push(...scope.allow.map((pattern) => `- \`${pattern}\``));
  lines.push("", "## File denylist", "");
  lines.push(...scope.deny.map((pattern) => `- \`${pattern}\``));
  return `${lines.join("\n")}\n`;
}

/** Compare the ordered declarations that give scope policy its meaning. */
export function scopesAgree(
  recorded: Pick<FeatureScopeV1, "allow" | "deny">,
  reviewed: Pick<FeatureScopeV1, "allow" | "deny">,
): boolean {
  return (
    sameList(recorded.allow, reviewed.allow) &&
    sameList(recorded.deny, reviewed.deny)
  );
}

function malformed(line: number): SummaryScopeParse {
  return { kind: "malformed", line };
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
