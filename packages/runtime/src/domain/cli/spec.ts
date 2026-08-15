import type { EffectPlan } from "../effects.js";
import type {
  ManagedFileObservation,
  ResolvedInitAnswers,
} from "../init/index.js";
import type { ObjectiveObservation } from "../objective/index.js";
import type {
  ApprovalV1,
  EventV1,
  EvidenceV1,
  HostOperationMessageV1,
  MigrationV1,
  SnapshotV1,
} from "@kratos/contracts";
import type { ProjectResolution } from "../project/index.js";
import type { Result } from "../result/index.js";
import type {
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
import type { GateDecision, GateMode } from "../gates/index.js";
import type { MigrationPlan } from "../migration/index.js";

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
      readonly configuration: WorkflowReducerConfiguration;
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
        | "host-reported"
        | "user-declared"
        | "unknown";
      readonly approvals: readonly ApprovalV1[];
      readonly approvalChallenge: string | null;
      readonly approvalsReadable: boolean;
      readonly evidence: readonly EvidenceV1[];
      readonly invalidEvidenceIds: readonly string[];
      readonly evidenceReadable: boolean;
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
