import type { EffectPlan } from "../effects.js";
import type {
  ManagedFileObservation,
  ResolvedInitAnswers,
} from "../init/index.js";
import type { ObjectiveObservation } from "../objective/index.js";
import type {
  AgentOutputV1,
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  ApprovalV1,
  EventV1,
  EvidenceV1,
  FeatureScopeV1,
  GapRecordV1,
  HostOperationMessageV1,
  MigrationV1,
  SnapshotV1,
} from "@kratos/contracts";
import type { ProjectResolution } from "../project/index.js";
import type { Result } from "../result/index.js";
import type {
  RunLineage,
  WorkflowReducerConfiguration,
  WorkflowState,
  WorkflowObservation,
} from "../workflow/index.js";
import type { EventReducerRegistry } from "../events/index.js";
import type {
  EvidenceBundle,
  IntegrityAudit,
  RepairPlan,
} from "../observability/index.js";
import type { AgentOutputObservation } from "../agent/index.js";
import type { GapProposalObservation } from "../gaps/index.js";
import type { GateDecision, GateMode } from "../gates/index.js";
import type { MigrationPlan } from "../migration/index.js";
import type { TaskDocumentObservation } from "../acceptance-criteria/index.js";

export type GuardWriteOutcome =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "refused";
      readonly reasonCode: string;
      readonly evidenceKind: "artifact" | "observation";
      readonly evidenceRef: string;
    };

export type ScopeRecordOutcome =
  | {
      readonly kind: "record";
      readonly path: string;
      readonly scope: FeatureScopeV1;
    }
  | { readonly kind: "unchanged"; readonly path: string }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        "guard.active_feature_corrupt" | "guard.scope_corrupt";
      readonly evidenceRef: string;
    };

export interface FlagSpec {
  readonly name: string;
  readonly kind: "boolean" | "value";
  readonly valueLabel?: string;
  readonly summary: string;
}

export type JsonContractId = "result@1.0.0" | "adapter-message@1.0.0";

export interface Decision {
  readonly result: Result;
  readonly plan: EffectPlan;
  readonly humanStdout: string | null;
  readonly payload: unknown;
  /**
   * Whether this plan may bootstrap the managed state root.
   *
   * Absent means `existing`, which every command that reads or updates state
   * needs. Only a command whose whole purpose is to create that state says
   * otherwise, and saying it is what keeps every other command from creating
   * `.brain` by accident.
   */
  readonly rootMode?: "existing" | "initialize";
  /** Reducers required when the plan appends a workflow event. */
  readonly eventReducers?: EventReducerRegistry<WorkflowState>;
  /** Re-observe this authorized repair plan immediately before committing it. */
  readonly revalidateRepairDigest?: string;
}

export interface Globals {
  readonly json: boolean;
  readonly expect: string | null;
  readonly orientation: "help" | "version" | null;
}

/**
 * What a command declared it needs observed before it can decide.
 *
 * A closed union rather than `unknown`: a handler reads its facts without a
 * cast, and adding a second kind of observing command is a change the compiler
 * walks you through instead of a cast that keeps compiling.
 */
export type CommandObservation =
  | { readonly kind: "none" }
  | { readonly kind: "write-guard"; readonly outcome: GuardWriteOutcome }
  | { readonly kind: "scope-record"; readonly outcome: ScopeRecordOutcome }
  | {
      readonly kind: "initialization";
      /** How discovery classified the target, or null when there is none. */
      readonly resolution: ProjectResolution | null;
      /**
       * The answers document, already validated.
       *
       * Validation needs the schema registry, which is infrastructure, so it
       * happens where the observation is collected rather than in a handler
       * that must stay pure.
       */
      readonly answers: ResolvedInitAnswers;
      /** Entry names at the project root, for stack profiling. */
      readonly rootEntries: readonly string[];
      /**
       * Every destination the answers imply, as it was found.
       *
       * All of them rather than only the two a user may own, because that is
       * what lets one mechanism report each destination as created, updated,
       * or preserved instead of two that can disagree.
       */
      readonly destinations: readonly (readonly [
        string,
        ManagedFileObservation,
      ])[];
    }
  | {
      readonly kind: "objective";
      /** The recorded objective, or its absence. */
      readonly objective: ObjectiveObservation;
      /** Everything the history already holds, so appending stays pure. */
      readonly history: string;
      /** The instant this run observed, supplied rather than read. */
      readonly now: string;
    }
  | {
      readonly kind: "host-operation";
      readonly message: HostOperationMessageV1;
    }
  | {
      readonly kind: "workflow";
      readonly workflow: WorkflowObservation;
      /**
       * The reducer seed, whose lineage is the fact the run recorded when it
       * started. Replay reproduces the committed snapshot from it, so it must
       * never move while the run is open.
       */
      readonly configuration: WorkflowReducerConfiguration;
      /**
       * The PRD and design digests on disk right now. Gates, approvals, and
       * artifact lineage bind to these, because the point of the `prd` and
       * `spec` phases is to change them.
       */
      readonly observedLineage: RunLineage;
      readonly correlationId: string;
      readonly eventId: string;
      readonly occurredAt: string;
      readonly objectiveActive: boolean;
      readonly objectiveDigest: string;
      readonly worktreeClean: boolean;
      readonly gitCommit: string | null;
      readonly observedIdentity: {
        readonly host: string;
        readonly model: string | null;
      };
      readonly identityProvenance:
        "host-reported" | "user-declared" | "unknown";
      readonly approvals: readonly ApprovalV1[];
      readonly approvalChallenge: string | null;
      readonly approvalsReadable: boolean;
      readonly evidence: readonly EvidenceV1[];
      readonly invalidEvidenceIds: readonly string[];
      readonly evidenceReadable: boolean;
      /** Every gap the run recorded, in identifier order. */
      readonly gaps: readonly GapRecordV1[];
      readonly gapsReadable: boolean;
      /** The proposal a gap-recording command was pointed at, if any. */
      readonly gapProposal: GapProposalObservation;
      /** The agent reply an output-recording command was pointed at, if any. */
      readonly agentOutput: AgentOutputObservation;
      /** Every agent output the run recorded, in agent order. */
      readonly agentOutputs: readonly AgentOutputV1[];
      readonly agentOutputsReadable: boolean;
      /** Parsed task declarations and immutable acceptance history. */
      readonly acceptanceCriteria: {
        readonly readable: boolean;
        readonly documentRef: string;
        readonly documentContent: string | null;
        readonly documentDigest: string | null;
        readonly document: TaskDocumentObservation;
        readonly currentDeclarations: readonly {
          readonly criterionId: string;
          readonly workUnit: string;
          readonly task: string;
          readonly kind: "main" | "edge";
          readonly ordinal: number;
          readonly declarationDigest: string;
          readonly checked: boolean;
        }[];
        readonly snapshot: AcceptanceCriteriaSnapshotV1 | null;
        readonly snapshotRef: string | null;
        readonly snapshotDigest: string | null;
        readonly verdicts: readonly AcceptanceVerdictV1[];
        readonly appendSnapshot: AcceptanceCriteriaSnapshotV1 | null;
        readonly appendSnapshotRef: string | null;
        readonly appendSnapshotDigest: string | null;
        readonly bootstrapSnapshot: AcceptanceCriteriaSnapshotV1 | null;
        readonly bootstrapSnapshotRef: string | null;
        readonly bootstrapSnapshotDigest: string | null;
        readonly baselineRequired: boolean;
        readonly initialSnapshot: AcceptanceCriteriaSnapshotV1 | null;
        readonly initialSnapshotRef: string | null;
        readonly initialSnapshotDigest: string | null;
        readonly preparedVerdicts: readonly {
          readonly value: AcceptanceVerdictV1;
          readonly ref: string;
          readonly digest: string;
        }[];
      };
      /** The gate facts exactly as recorded, before the approval boundary. */
      readonly gateFacts: {
        readonly readable: boolean;
        readonly stopLoss: {
          readonly tripped: boolean;
          readonly exhausted: boolean;
        };
        readonly openGaps: number;
        readonly partitionRequired: boolean;
        readonly partitionApproved: boolean;
      };
      /** The open-gap count the gates act on, after the approval boundary. */
      readonly openGaps: number;
      /** Whether the specification bound to this lineage is approved. */
      readonly specApproved: boolean;
      readonly referencedFiles: readonly {
        readonly ref: string;
        readonly content: string;
        readonly sha256: string;
      }[];
      readonly gateDecision: GateDecision;
      readonly policyMode: GateMode;
      readonly tokenBudget: number | null;
      readonly events: readonly EventV1[];
      readonly persistedSnapshot: SnapshotV1 | null;
      readonly replayedSnapshot: SnapshotV1 | null;
      readonly integrityAudit: IntegrityAudit | null;
      readonly repairPlan: RepairPlan | null;
      readonly evidenceBundle: EvidenceBundle | null;
      readonly dashboardHtml: string | null;
    }
  | {
      readonly kind: "migration";
      readonly operation:
        | {
            readonly kind: "brain";
            readonly migrationId: string;
            readonly now: string;
            readonly plan: MigrationPlan;
            readonly backupDigest: string;
            readonly sourceFiles: readonly {
              readonly path: string;
              readonly content: string;
              readonly sha256: string;
            }[];
          }
        | {
            readonly kind: "rollback";
            readonly migrationId: string;
            readonly receipt: MigrationV1 | null;
            readonly targets: readonly string[];
            readonly now: string;
          };
    };

export type CommandPrerequisite = CommandObservation["kind"];

export interface Invocation {
  readonly command: CommandSpec;
  readonly globals: Globals;
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
  readonly registry: CommandRegistry;
  readonly observation: CommandObservation;
}

export type CommandHandler = (invocation: Invocation) => Decision;

export interface CommandSpec {
  readonly path: readonly string[];
  readonly summary: string;
  readonly flags: readonly FlagSpec[];
  readonly positionals: { readonly min: number; readonly max: number };
  readonly jsonContract: JsonContractId;
  /** What the composition root must observe before dispatch. */
  readonly prerequisite: CommandPrerequisite;
  /**
   * Whether this name exists only to refuse.
   *
   * A retired phase command stays recognizable so a caller learns where the
   * capability went, and help publishes it apart from the workflow it is no
   * longer part of. Listing it beside the working commands would advertise
   * exactly the manual phase control it refuses.
   */
  readonly retired?: true;
  readonly handler: CommandHandler;
}

export type CommandRegistry = readonly CommandSpec[];

/** Flags consumed before command resolution and shared by every command. */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  {
    name: "--expect",
    kind: "value",
    valueLabel: "<version>",
    summary: "Act only when the plugin version matches exactly.",
  },
  {
    name: "--json",
    kind: "boolean",
    summary: "Emit one machine-readable object instead of human text.",
  },
];
