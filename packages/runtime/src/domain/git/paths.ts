import type { Digests } from "../../ports/index.js";
import type { GitPath } from "./model.js";

// `fatal` is what makes an invalid byte an error instead of U+FFFD. Silent
// replacement would let two distinct files normalize to one path, and a scope
// gate would then compare against a name that does not exist on disk.
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** Decode one raw path from Git, refusing to invent a name for bad bytes. */
export function decodeGitPath(bytes: Uint8Array, digests: Digests): GitPath {
  try {
    return { kind: "text", value: decoder.decode(bytes) };
  } catch {
    return {
      kind: "undecodable",
      sha256: digests.sha256Bytes(bytes),
      bytes: bytes.length,
    };
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    /* v8 ignore next -- index is always < shared <= both lengths, so the
     * indexed access is never actually out of range; the fallback exists
     * only because noUncheckedIndexedAccess types it as possibly undefined. */
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * Order by UTF-8 byte sequence.
 *
 * The rest of the runtime uses `localeCompare(…, "en-US")`, but there the data
 * are generated identifiers. These are arbitrary names read off a disk, and
 * locale ordering is not stable across ICU versions — which is exactly what
 * "platform-consistent" forbids.
 */
export function compareGitPaths(left: GitPath, right: GitPath): number {
  if (left.kind === "text" && right.kind === "text") {
    return compareBytes(
      encoder.encode(left.value),
      encoder.encode(right.value),
    );
  }
  // An undecodable path has no name to order by, so it sorts after every named
  // path and against its peers by digest. Any total order works; this one is
  // stable and needs no second source of truth.
  if (left.kind === "text") return -1;
  if (right.kind === "text") return 1;
  return left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0;
}
