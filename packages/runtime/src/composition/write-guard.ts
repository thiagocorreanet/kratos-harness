import type { GuardrailsV1 } from "@kratos/contracts";

import {
  evaluateWriteRequest,
  extractMutationTargets,
  inspectMutationTarget,
  type GuardWriteOutcome,
  type PolicyState,
  type ScopeRecordOutcome,
} from "../application/write-guard/index.js";
import { ACTIVE_FEATURE_PATH } from "../domain/objective/index.js";
import {
  isPathGlob,
  parseSummaryScope,
  scopesAgree,
} from "../domain/write-guard/index.js";
import {
  prepareContract,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { Result } from "../domain/result/index.js";
import type { TargetInspectionSession } from "../ports/filesystem.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";

type Observed =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      readonly ports: RuntimePorts;
    };

const guardrailsPath = ".brain/guardrails.json";
const utf8 = new TextEncoder();

function guardObservation(ordinal: number): string {
  return `guard-target-${String(ordinal).padStart(4, "0")}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function activeFeature(
  ports: RuntimePorts,
): Promise<
  | { readonly kind: "valid"; readonly feature: string | null }
  | { readonly kind: "invalid" }
> {
  const entry = await ports.durableFileSystem.inspect(ACTIVE_FEATURE_PATH);
  if (entry.kind === "missing") return { kind: "valid", feature: null };
  if (entry.kind !== "file") return { kind: "invalid" };
  let text: string;
  try {
    text = await ports.durableFileSystem.readText(ACTIVE_FEATURE_PATH);
  } catch {
    return { kind: "invalid" };
  }
  if (text.trim().length === 0) return { kind: "valid", feature: null };
  const lines = text.split("\n");
  const feature = lines.shift()?.trim() ?? "";
  if (
    feature === "" ||
    feature.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(feature) ||
    lines.some((line) => line.trim().length !== 0)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", feature };
}

async function policyState(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PolicyState> {
  const guardrailsEntry = await ports.durableFileSystem.inspect(guardrailsPath);
  if (guardrailsEntry.kind === "missing") {
    return {
      kind: "invalid",
      guardrails: null,
      reasonCode: "guard.guardrails_missing",
      evidenceRef: guardrailsPath,
    };
  }
  if (guardrailsEntry.kind !== "file") {
    return {
      kind: "invalid",
      guardrails: null,
      reasonCode: "guard.guardrails_corrupt",
      evidenceRef: guardrailsPath,
    };
  }
  let guardrailsText: string;
  try {
    guardrailsText = await ports.durableFileSystem.readText(guardrailsPath);
  } catch {
    return {
      kind: "invalid",
      guardrails: null,
      reasonCode: "guard.guardrails_corrupt",
      evidenceRef: guardrailsPath,
    };
  }
  const guardrails = prepareContract(registry, {
    id: "state.guardrails",
    version: "1.0.0",
    value: parseJson(guardrailsText),
    structuralReasonCode: "guard.guardrails_corrupt",
  });
  if (guardrails.kind === "invalid") {
    return {
      kind: "invalid",
      guardrails: null,
      reasonCode: "guard.guardrails_corrupt",
      evidenceRef: guardrailsPath,
    };
  }
  if (!(guardrails.value.writeBlocks ?? []).every(isPathGlob)) {
    return {
      kind: "invalid",
      guardrails: null,
      reasonCode: "guard.guardrails_corrupt",
      evidenceRef: guardrailsPath,
    };
  }

  const active = await activeFeature(ports);
  if (active.kind === "invalid") {
    return {
      kind: "invalid",
      guardrails: guardrails.value,
      reasonCode: "guard.active_feature_corrupt",
      evidenceRef: ACTIVE_FEATURE_PATH,
    };
  }
  if (active.feature === null) {
    return {
      kind: "valid",
      guardrails: guardrails.value,
      scope: null,
      reviewerScope: null,
    };
  }

  const featureRoot = `.brain/02-features/${active.feature}`;
  const scopePath = `${featureRoot}/scope.json`;
  const scopeEntry = await ports.durableFileSystem.inspect(scopePath);
  if (scopeEntry.kind === "missing") {
    return {
      kind: "valid",
      guardrails: guardrails.value,
      scope: null,
      reviewerScope: null,
    };
  }
  if (scopeEntry.kind !== "file") {
    return invalidScope(scopePath, guardrails.value);
  }

  let scopeText: string;
  try {
    scopeText = await ports.durableFileSystem.readText(scopePath);
  } catch {
    return invalidScope(scopePath, guardrails.value);
  }
  const scope = prepareContract(registry, {
    id: "state.feature-scope",
    version: "1.0.0",
    value: parseJson(scopeText),
    structuralReasonCode: "guard.scope_corrupt",
  });
  if (scope.kind === "invalid") {
    return invalidScope(scopePath, guardrails.value);
  }

  const summaryPath = `${featureRoot}/03-summa.md`;
  const summaryEntry = await ports.durableFileSystem.inspect(summaryPath);
  if (summaryEntry.kind !== "file") {
    return invalidScope(summaryPath, guardrails.value);
  }
  let summaryText: string;
  try {
    summaryText = await ports.durableFileSystem.readText(summaryPath);
  } catch {
    return invalidScope(summaryPath, guardrails.value);
  }
  const reviewer = parseSummaryScope(summaryText);
  if (reviewer.kind !== "valid" || !scopesAgree(scope.value, reviewer.scope)) {
    return invalidScope(summaryPath, guardrails.value);
  }
  return {
    kind: "valid",
    guardrails: guardrails.value,
    scope: scope.value,
    reviewerScope: reviewer.scope,
  };
}

function invalidScope(path: string, guardrails: GuardrailsV1): PolicyState {
  return {
    kind: "invalid",
    guardrails,
    reasonCode: "guard.scope_corrupt",
    evidenceRef: path,
  };
}

async function guardOutcome(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<GuardWriteOutcome> {
  const input = await ports.standardInput.read();
  if (input === null || input.trim().length === 0) {
    return targetRefusal("guard.target_uninspectable", 1);
  }
  const request = prepareContract(registry, {
    id: "host.pre-tool-use",
    version: "1.0.0",
    value: parseJson(input),
    structuralReasonCode: "guard.target_uninspectable",
  });
  if (request.kind === "invalid") {
    return targetRefusal("guard.target_uninspectable", 1);
  }

  const inspector = ports.targetInspector;
  let session: TargetInspectionSession;
  try {
    session = await inspector.capture();
  } catch {
    return targetRefusal("guard.target_uninspectable", 1);
  }
  let state: PolicyState | undefined;
  for (const [index, target] of extractMutationTargets(
    request.value,
  ).entries()) {
    const inspected = await inspectMutationTarget(target, index + 1, session);
    if (inspected.kind === "refused") {
      return targetRefusal(inspected.reasonCode, inspected.ordinal);
    }
    state ??= await policyState(ports, registry);
    const policy = evaluateWriteRequest([inspected.target], state);
    if (policy.kind === "refused") {
      return {
        kind: "refused",
        reasonCode: policy.reasonCode,
        evidenceKind: "artifact",
        evidenceRef: policy.evidenceRef,
      };
    }
  }
  return { kind: "allowed" };
}

function targetRefusal(
  reasonCode: "guard.path_escape" | "guard.target_uninspectable",
  ordinal: number,
): GuardWriteOutcome {
  return {
    kind: "refused",
    reasonCode,
    evidenceKind: "observation",
    evidenceRef: guardObservation(ordinal),
  };
}

export async function observeGuardWrite(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  return {
    kind: "observed",
    observation: {
      kind: "write-guard",
      outcome: await guardOutcome(anchored, registry),
    },
    ports: anchored,
  };
}

async function scopeRecordOutcome(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ScopeRecordOutcome> {
  const active = await activeFeature(ports);
  if (active.kind === "invalid" || active.feature === null) {
    return {
      kind: "refused",
      reasonCode: "guard.active_feature_corrupt",
      evidenceRef: ACTIVE_FEATURE_PATH,
    };
  }
  const featureRoot = `.brain/02-features/${active.feature}`;
  const summaryPath = `${featureRoot}/03-summa.md`;
  const summaryEntry = await ports.durableFileSystem.inspect(summaryPath);
  if (summaryEntry.kind !== "file") return scopeRefusal(summaryPath);
  let summaryText: string;
  try {
    summaryText = await ports.durableFileSystem.readText(summaryPath);
  } catch {
    return scopeRefusal(summaryPath);
  }
  const parsed = parseSummaryScope(summaryText);
  if (parsed.kind !== "valid") return scopeRefusal(summaryPath);
  const translated = prepareContract(registry, {
    id: "state.feature-scope",
    version: "1.0.0",
    value: parsed.scope,
    structuralReasonCode: "guard.scope_corrupt",
  });
  if (translated.kind === "invalid") return scopeRefusal(summaryPath);

  const scopePath = `${featureRoot}/scope.json`;
  const scopeEntry = await ports.durableFileSystem.inspect(scopePath);
  if (scopeEntry.kind === "missing") {
    return {
      kind: "record",
      path: scopePath,
      scope: translated.value,
      expected: { kind: "missing" },
    };
  }
  if (scopeEntry.kind !== "file") return scopeRefusal(scopePath);
  let scopeText: string;
  try {
    scopeText = await ports.durableFileSystem.readText(scopePath);
  } catch {
    return scopeRefusal(scopePath);
  }
  const recorded = prepareContract(registry, {
    id: "state.feature-scope",
    version: "1.0.0",
    value: parseJson(scopeText),
    structuralReasonCode: "guard.scope_corrupt",
  });
  if (
    recorded.kind === "invalid" ||
    !scopesAgree(recorded.value, translated.value)
  ) {
    return scopeRefusal(scopePath);
  }
  return {
    kind: "unchanged",
    path: scopePath,
    content: scopeText,
    expected: {
      kind: "file",
      size: utf8.encode(scopeText).byteLength,
      sha256: ports.digests.sha256(scopeText),
    },
  };
}

function scopeRefusal(path: string): ScopeRecordOutcome {
  return {
    kind: "refused",
    reasonCode: "guard.scope_corrupt",
    evidenceRef: path,
  };
}

export async function observeScopeRecord(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  return {
    kind: "observed",
    observation: {
      kind: "scope-record",
      outcome: await scopeRecordOutcome(anchored, registry),
    },
    ports: anchored,
  };
}
