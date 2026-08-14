import type { InitAnswersV1 } from "@mestre-yoda/contracts";

import type { SchemaRegistry } from "../schema/index.js";

/**
 * Every answer the caller may leave out, with the value used instead.
 *
 * Defaults live here rather than scattered through generation so there is one
 * place to read to learn what an unanswered project becomes.
 */
const DEFAULTS = {
  language: "en",
  policyMode: "standard",
  snapshots: true,
} as const;

type Defaultable = keyof typeof DEFAULTS;

const DEFAULTABLE: readonly Defaultable[] = [
  "language",
  "policyMode",
  "snapshots",
];

export type ResolvedInitAnswers =
  | {
      readonly kind: "resolved";
      readonly answers: Required<InitAnswersV1>;
      /** Which answers the caller did not supply, in documented order. */
      readonly defaulted: readonly Defaultable[];
    }
  | { readonly kind: "invalid"; readonly reasonCode: string };

/**
 * Validate an answers document and fill in what it left unanswered.
 *
 * The applied defaults are reported rather than silently merged. Somebody who
 * supplied three fields and initialized a project configured by six needs to
 * see the other three, or they will believe they chose them.
 */
export function resolveInitAnswers(
  document: unknown,
  registry: SchemaRegistry,
): ResolvedInitAnswers {
  const validated = registry.validate({
    id: "host.init-answers",
    version: version(document),
    value: document,
    structuralReasonCode: "trail.output_invalido",
  });
  if (validated.kind === "invalid") {
    const first = validated.diagnostics[0];
    return {
      kind: "invalid",
      /* v8 ignore next -- an invalid result always carries a diagnostic */
      reasonCode: first?.reasonCode ?? "trail.output_invalido",
    };
  }
  const supplied = validated.value;
  const defaulted = DEFAULTABLE.filter((key) => supplied[key] === undefined);
  return {
    kind: "resolved",
    answers: {
      contractVersion: supplied.contractVersion,
      hostContract: supplied.hostContract,
      hosts: supplied.hosts,
      language: supplied.language ?? DEFAULTS.language,
      policyMode: supplied.policyMode ?? DEFAULTS.policyMode,
      snapshots: supplied.snapshots ?? DEFAULTS.snapshots,
    },
    defaulted,
  };
}

/**
 * The host contract version the registry checks before the payload.
 *
 * Reading it structurally keeps a malformed document on the version path,
 * where the failure names the contract, instead of the payload path, where it
 * would name a field.
 */
function version(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return undefined;
  return (document as Record<string, unknown>).hostContract;
}
