import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
  MAX_BLOCK_LENGTH,
  type BlockExtraction,
  type BlockMalformation,
} from "./model.js";

/**
 * Read one agent reply and return the machine block it carries.
 *
 * Pure by construction: it takes the reply text and returns a decision. There
 * is no model call, no clock, and no filesystem here, which is what lets the
 * same reply extract identically whichever host produced it.
 *
 * Line endings are normalized first. A host that writes CRLF and a host that
 * writes LF are describing the same reply, and a delimiter that matched only
 * one of them would make the contract host-specific.
 */
export function extractAgentBlock(reply: string): BlockExtraction {
  const lines = reply.split("\n").map(stripCarriageReturn);
  const opens = indicesOf(lines, AGENT_BLOCK_OPEN);
  const closes = indicesOf(lines, AGENT_BLOCK_CLOSE);

  const structural = classifyDelimiters(opens, closes);
  if (structural !== null) return structural;

  // `classifyDelimiters` returning null means exactly one of each was found in
  // the right order, so both lookups below are inhabited.
  const open = opens[0] ?? 0;
  const close = closes[0] ?? 0;

  if (lines.slice(close + 1).some((line) => line.trim() !== "")) {
    return malformed("trailing-content");
  }

  const text = lines.slice(open + 1, close).join("\n");
  if (text.length > MAX_BLOCK_LENGTH) return malformed("block-too-large");
  if (text.trim() === "") return malformed("empty-block");

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return malformed("invalid-json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformed("non-object");
  }
  return { kind: "extracted", value, text };
}

/**
 * Why the delimiters alone already refuse this reply, or null when they do not.
 *
 * Absence of both markers is the only case that is not a failure: a reply that
 * never claims to carry a block is a reply the runtime cannot route on, which
 * is a different thing from a reply that carries a broken one.
 */
function classifyDelimiters(
  opens: readonly number[],
  closes: readonly number[],
): Extract<BlockExtraction, { readonly kind: "absent" | "malformed" }> | null {
  if (opens.length === 0 && closes.length === 0) return { kind: "absent" };
  if (opens.length > 1) return malformed("duplicate-open");
  if (closes.length > 1) return malformed("duplicate-close");
  if (opens.length === 0) return malformed("unopened");
  if (closes.length === 0) return malformed("unterminated");
  return (closes[0] ?? 0) < (opens[0] ?? 0) ? malformed("misordered") : null;
}

function indicesOf(
  lines: readonly string[],
  marker: string,
): readonly number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (line === marker) found.push(index);
  });
  return found;
}

/**
 * A delimiter is recognized only as a whole line, so a trailing carriage
 * return has to go before the comparison rather than be tolerated inside it.
 */
function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function malformed(
  reason: BlockMalformation,
): Extract<BlockExtraction, { readonly kind: "malformed" }> {
  return { kind: "malformed", reason };
}
