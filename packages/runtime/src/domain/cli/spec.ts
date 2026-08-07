import type { EffectPlan } from "../effects.js";
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
}

export interface Globals {
  readonly json: boolean;
  readonly expect: string | null;
  readonly orientation: "help" | "version" | null;
}

export interface Invocation {
  readonly command: CommandSpec;
  readonly globals: Globals;
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
  readonly registry: CommandRegistry;
}

export type CommandHandler = (invocation: Invocation) => Decision;

export interface CommandSpec {
  readonly path: readonly string[];
  readonly summary: string;
  readonly flags: readonly FlagSpec[];
  readonly positionals: { readonly min: number; readonly max: number };
  readonly jsonContract: JsonContractId;
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
