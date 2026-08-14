/**
 * The feature identity a piece of objective text allocates.
 *
 * Derived from the text and nothing else, so the same demand names the same
 * feature on any machine and a replay lands where the original run did. A
 * counter or a timestamp would make the identity depend on when it was asked
 * for rather than on what was asked.
 */
const MAX_LENGTH = 64;

export function featureIdentity(text: string): string | null {
  // NFKD splits an accented letter into a letter and a combining mark;
  // dropping the marks keeps `Émigré` as `emigre` instead of `e-migre`.
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, MAX_LENGTH)
    .replace(/-$/u, "");
  // Text made entirely of punctuation, or of scripts that carry no ASCII
  // equivalent, leaves nothing to name a directory with. That is a refusal
  // rather than a generated name nobody asked for.
  return slug === "" ? null : slug;
}
