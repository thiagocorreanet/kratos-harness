import { createHash } from "node:crypto";

import type { Digests } from "../ports/index.js";

/** Production SHA-256 over the exact UTF-8 bytes represented by the text. */
export function sha256Digests(): Digests {
  return {
    sha256: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    sha256Bytes: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  };
}
