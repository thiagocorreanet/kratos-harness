import type { EffectPlan } from "../effects.js";
import type {
  ManagedFileObservation,
  ResolvedInitAnswers,
} from "../init/index.js";
import type { ObjectiveObservation } from "../objective/index.js";
import type { ProjectResolution } from "../project/index.js";
import type { Result } from "../result/index.js";

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
