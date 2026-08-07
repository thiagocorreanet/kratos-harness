export type WorkspaceEntry =
  | { type: "directory"; path: string }
  | {
      type: "file";
      path: string;
      content: string;
      executable: boolean;
    }
  | { type: "symlink"; path: string; target: string };

export type NormalizationRule =
  | { operation: "line_endings"; pointer: string }
  | { operation: "workspace_path"; pointer: string }
  | {
      operation: "replace_json_value";
      pointer: string;
      token: "<TIMESTAMP>" | "<DURATION>";
    }
  | {
      operation: "sort_json_array";
      pointer: string;
      identityKey: string;
    }
  | {
      operation: "remove_field";
      pointer: string;
      justification: string;
    };

export interface CapturedStream {
  bytes: number;
  sha256: string;
  content?: string;
}

export interface ProcessObservation {
  outcome: "exit" | "signal" | "timeout" | "output_limit" | "spawn_error";
  exitCode: number | null;
  signal: string | null;
  stdout: CapturedStream;
  stderr: CapturedStream;
}

export interface ManifestEntry {
  path: string;
  type: "directory" | "file" | "symlink";
  mode: "directory" | "file" | "executable" | "symlink";
  size: number;
  sha256?: string;
  target?: string;
}

export interface Mutation {
  path: string;
  kind: "added" | "modified" | "deleted";
}

export interface StructuredObservation {
  id: string;
  path: string;
  value: unknown;
}

export interface GitObservation {
  head: string | null;
  status: CapturedStream;
  worktreeDiff: CapturedStream;
  indexDiff: CapturedStream;
  refs: readonly { name: string; object: string }[];
}

export interface DifferentialObservation {
  process: ProcessObservation;
  filesystem: {
    before: readonly ManifestEntry[];
    after: readonly ManifestEntry[];
    mutations: readonly Mutation[];
  };
  structured: readonly StructuredObservation[];
  git: GitObservation | null;
}

export type GoldenAssertions = DifferentialObservation;

export interface DifferentialScenario {
  schemaVersion: 1;
  id: string;
  parityContractIds: string[];
  workspace: { entries: WorkspaceEntry[] };
  invocation: {
    args: string[];
    stdin: string;
    environment: Record<string, string>;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
  };
  capture: {
    structured: { id: string; path: string }[];
    git: boolean;
  };
  normalization: NormalizationRule[];
  disclosure: {
    stdout: "digest" | "content";
    stderr: "digest" | "content";
    artifacts: "digest" | "content";
  };
  expected: GoldenAssertions;
}

export interface Mismatch {
  pointer: string;
  kind:
    | "missing"
    | "unexpected"
    | "type"
    | "value"
    | "timeout"
    | "crash"
    | "partial_mutation";
  scenarioId: string;
  parityContractIds: readonly string[];
  oracle?: unknown;
  candidate?: unknown;
}

export interface DifferentialReport {
  scenarioId: string;
  parityContractIds: readonly string[];
  equal: boolean;
  mismatches: readonly Mismatch[];
  normalization: readonly NormalizationRule[];
}
