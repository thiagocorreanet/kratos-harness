import type { Digests } from "../../ports/index.js";
import { compareGitPaths, decodeGitPath } from "./paths.js";
import type {
  GitChange,
  GitChangeKind,
  GitHead,
  GitPath,
  GitUpstream,
} from "./model.js";

export interface ParsedStatus {
  readonly head: GitHead;
  readonly changes: readonly GitChange[];
}

const KINDS = new Map<string, GitChangeKind>([
  [".", "none"],
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["R", "renamed"],
  ["C", "copied"],
  ["T", "type_changed"],
]);

/** Split the NUL-delimited payload into raw byte records. */
function splitRecords(stdout: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] !== 0) continue;
    records.push(stdout.subarray(start, index));
    start = index + 1;
  }
  // Trailing bytes with no terminator mean the stream was cut mid-record.
  if (start !== stdout.length) records.push(stdout.subarray(start));
  return records;
}

function entryKindFromMode(mode: string): GitChange["entry"] {
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "submodule";
  if (mode === "040000") return "directory";
  return "file";
}

interface HeaderFields {
  oid?: string;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

function readHeader(text: string, fields: HeaderFields): boolean {
  const [, key, ...rest] = text.split(" ");
  const value = rest.join(" ");
  if (key === "branch.oid") fields.oid = value;
  else if (key === "branch.head") fields.head = value;
  else if (key === "branch.upstream") fields.upstream = value;
  else if (key === "branch.ab") {
    const [ahead, behind] = value.split(" ");
    if (ahead === undefined || behind === undefined) return false;
    if (!ahead.startsWith("+") || !behind.startsWith("-")) return false;
    fields.ahead = Number.parseInt(ahead.slice(1), 10);
    fields.behind = Number.parseInt(behind.slice(1), 10);
    if (!Number.isInteger(fields.ahead) || !Number.isInteger(fields.behind)) {
      return false;
    }
  }
  // An unknown header is tolerated: Git may add fields, and a new header
  // carries no change-set meaning. An unknown *record* is not tolerated.
  return true;
}

function buildHead(fields: HeaderFields): GitHead | null {
  const { oid, head } = fields;
  if (oid === undefined || head === undefined) return null;
  if (oid === "(initial)") {
    return head === "(detached)" ? null : { kind: "unborn", branch: head };
  }
  if (head === "(detached)") return { kind: "detached", commit: oid };
  const upstream: GitUpstream | null =
    fields.upstream === undefined
      ? null
      : {
          ref: fields.upstream,
          ahead: fields.ahead ?? 0,
          behind: fields.behind ?? 0,
        };
  return { kind: "branch", branch: head, commit: oid, upstream };
}

function untrackedChange(
  path: GitPath,
  tracking: "untracked" | "ignored",
  raw: string,
): GitChange {
  return {
    path,
    tracking,
    // An untracked or ignored path has no index state and no worktree delta.
    // Encoding it as `worktree: "added"` would make it indistinguishable from
    // a staged addition, which the completion gate must tell apart.
    index: "none",
    worktree: "none",
    conflict: null,
    renamedFrom: null,
    entry: raw.endsWith("/") ? "directory" : "file",
  };
}

/**
 * Parse `status --porcelain=v2 -z` output.
 *
 * Returns `null` for any record that does not match its expected shape. Partial
 * parsing would report a change set quietly missing entries, and a gate reading
 * that set would approve a change it never saw.
 */
export function parseStatusPorcelainV2(
  stdout: Uint8Array,
  digests: Digests,
): ParsedStatus | null {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const records = splitRecords(stdout);
  const fields: HeaderFields = {};
  const changes: GitChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    /* v8 ignore next -- `index < records.length` is the loop bound, so the
     * indexed access is never actually out of range; the fallback exists
     * only because noUncheckedIndexedAccess types it as possibly undefined. */
    const bytes = records[index] ?? new Uint8Array(0);
    if (bytes.length === 0) continue;
    const text = decoder.decode(bytes);

    if (text.startsWith("# ")) {
      if (!readHeader(text, fields)) return null;
      continue;
    }

    const type = text.slice(0, 2);
    if (type === "? " || type === "! ") {
      const raw = text.slice(2);
      changes.push(
        untrackedChange(
          decodeGitPath(bytes.subarray(2), digests),
          type === "? " ? "untracked" : "ignored",
          raw,
        ),
      );
      continue;
    }

    if (type === "1 " || type === "2 ") {
      // `1 XY sub mH mI mW hH hI path` — 8 fields before the path.
      // `2 XY sub mH mI mW hH hI Xscore path` — 9 fields before the path.
      const leading = type === "1 " ? 8 : 9;
      const parts = text.split(" ");
      if (parts.length < leading + 1) return null;
      /* v8 ignore next -- `parts.length >= leading + 1 >= 9` is checked
       * above, so index 1 always exists; the fallback exists only because
       * noUncheckedIndexedAccess types the read as possibly undefined. */
      const status = parts[1] ?? "";
      const indexKind = KINDS.get(status[0] ?? "");
      const worktreeKind = KINDS.get(status[1] ?? "");
      if (indexKind === undefined || worktreeKind === undefined) return null;
      /* v8 ignore next -- see the parts[1] fallback above; index 5 is
       * covered by the same length check. */
      const worktreeMode = parts[5] ?? "";

      // Every field before the path is ASCII — status letters, octal modes,
      // hex object ids — so a character offset into `text` is also a byte
      // offset into `bytes`. That is what lets the path be sliced as raw
      // bytes while the fields are read as text.
      const offset = parts.slice(0, leading).join(" ").length + 1;
      const path = decodeGitPath(bytes.subarray(offset), digests);
      let renamedFrom: GitPath | null = null;

      if (type === "2 ") {
        // A rename consumes the following NUL-separated record as its origin.
        const origin = records[index + 1];
        if (origin === undefined || origin.length === 0) return null;
        renamedFrom = decodeGitPath(origin, digests);
        index += 1;
      }

      changes.push({
        path,
        tracking: "tracked",
        index: indexKind,
        worktree: worktreeKind,
        conflict: null,
        renamedFrom,
        entry: entryKindFromMode(worktreeMode),
      });
      continue;
    }

    if (type === "u ") {
      // `u XY sub m1 m2 m3 mW h1 h2 h3 path` — 10 fields before the path.
      const parts = text.split(" ");
      if (parts.length < 11) return null;
      /* v8 ignore next -- `parts.length >= 11` is checked above, so index 1
       * always exists; the fallback exists only because
       * noUncheckedIndexedAccess types the read as possibly undefined. */
      const status = parts[1] ?? "";
      const offset = parts.slice(0, 10).join(" ").length + 1;
      changes.push({
        path: decodeGitPath(bytes.subarray(offset), digests),
        tracking: "tracked",
        index: "modified",
        worktree: "modified",
        conflict: {
          ours: !status.startsWith("."),
          theirs: status[1] !== ".",
          // Stage-1 is the merge base; Git emits its object id as `h1`. An
          // all-zero id means the base is absent, as in add/add conflicts.
          /* v8 ignore next -- parts.length >= 11 is already checked above,
           * so parts[7] always exists; the fallback exists only because
           * noUncheckedIndexedAccess types the read as possibly undefined. */
          base: (parts[7] ?? "").replace(/0/gu, "") !== "",
        },
        renamedFrom: null,
        /* v8 ignore next -- see the parts[1] fallback above; index 6 is
         * covered by the same length check. */
        entry: entryKindFromMode(parts[6] ?? ""),
      });
      continue;
    }

    return null;
  }

  const head = buildHead(fields);
  if (head === null) return null;
  return {
    head,
    changes: [...changes].sort((left, right) =>
      compareGitPaths(left.path, right.path),
    ),
  };
}
