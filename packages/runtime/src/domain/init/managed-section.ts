/**
 * The delimiters around everything initialization owns inside a file a person
 * may already have written.
 *
 * They are content, not formatting: an update replaces what sits between them
 * and nothing else, so a file without them cannot be updated safely.
 */
export const MANAGED_SECTION_BEGIN =
  "<!-- BEGIN MESTRE YODA MANAGED SECTION -->";
export const MANAGED_SECTION_END = "<!-- END MESTRE YODA MANAGED SECTION -->";

/** What was observed at a managed destination, without interpreting it. */
export type ManagedFileObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "other" }
  | { readonly kind: "file"; readonly text: string };

/**
 * What the caller stated they accept, one flag per statement.
 *
 * Neither is inferred from the absence of the other. A tool that decides for
 * itself that appending is fine has decided something about a document it does
 * not understand.
 */
export interface ManagedFileAuthorization {
  readonly merge: boolean;
  readonly force: boolean;
}

export type ManagedFilePlan =
  | { readonly kind: "write"; readonly content: string }
  | {
      readonly kind: "refused";
      readonly reasonCode: "guard.outside_allow" | "runtime.state_corrupt";
    };

type Section =
  | { readonly kind: "absent" }
  | { readonly kind: "found"; readonly start: number; readonly end: number }
  | { readonly kind: "malformed" };

/**
 * Decide what to write at a destination the project may already own.
 *
 * Pure: it is handed what was observed and returns content or a typed refusal,
 * so every case can be proven without a filesystem underneath it.
 */
export function planManagedFile(
  existing: ManagedFileObservation,
  generated: string,
  authorization: ManagedFileAuthorization,
): ManagedFilePlan {
  const generatedSection = locateSection(generated);
  if (generatedSection.kind !== "found") {
    // A generated document without markers could never be updated in place on
    // the next run. Refusing now beats discovering that then.
    return refused("runtime.state_corrupt");
  }
  const block = generated.slice(generatedSection.start, generatedSection.end);

  if (existing.kind === "other") {
    // A directory where `CLAUDE.md` belongs is not a file to replace, and
    // removing it is not initialization's decision to make.
    return refused("guard.outside_allow");
  }
  if (existing.kind === "absent") return { kind: "write", content: generated };

  const current = locateSection(existing.text);
  switch (current.kind) {
    case "malformed":
      // Repairing this means guessing which marker was meant. `--force`
      // authorizes replacing a file, not interpreting state no protocol can
      // read; that repair is `OBS-02`.
      return refused("runtime.state_corrupt");
    case "found":
      // There is a safe place for the section, so nothing outside it is
      // touched -- whatever the run was authorized to do.
      return {
        kind: "write",
        content:
          existing.text.slice(0, current.start) +
          block +
          existing.text.slice(current.end),
      };
    case "absent":
      if (authorization.force) return { kind: "write", content: generated };
      if (authorization.merge) {
        return { kind: "write", content: appended(existing.text, generated) };
      }
      return refused("guard.outside_allow");
  }
}

/**
 * Where the managed section sits, or why it cannot be located.
 *
 * A second section, a lone marker, or an end before its beginning is malformed
 * rather than repairable: each of them has more than one plausible reading, and
 * picking one is a guess about somebody's file.
 */
function locateSection(text: string): Section {
  const begin = text.indexOf(MANAGED_SECTION_BEGIN);
  const end = text.indexOf(MANAGED_SECTION_END);
  if (begin < 0 && end < 0) return { kind: "absent" };
  if (
    begin < 0 ||
    end < begin ||
    text.includes(MANAGED_SECTION_BEGIN, begin + 1) ||
    text.includes(MANAGED_SECTION_END, end + 1)
  ) {
    return { kind: "malformed" };
  }
  return { kind: "found", start: begin, end: end + MANAGED_SECTION_END.length };
}

/**
 * Append without editing a byte of what was already there.
 *
 * The blank line is a separator, not a rewrite: a file that ended mid-line
 * keeps its last line intact and gains the newline the section needs to start
 * on its own.
 */
function appended(existing: string, generated: string): string {
  return `${existing}${existing.endsWith("\n") ? "\n" : "\n\n"}${generated}`;
}

function refused(
  reasonCode: "guard.outside_allow" | "runtime.state_corrupt",
): ManagedFilePlan {
  return { kind: "refused", reasonCode };
}
