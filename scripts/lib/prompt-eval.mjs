import Ajv2020 from "ajv/dist/2020.js";

const AGENT_BLOCK_OPEN = "===KRATOS-AGENT-OUTPUT-V1===";
const AGENT_BLOCK_CLOSE = "===END-KRATOS-AGENT-OUTPUT-V1===";

export function extractAgentBlock(reply) {
  const lines = reply.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const opens = [];
  const closes = [];

  lines.forEach((line, idx) => {
    if (line === AGENT_BLOCK_OPEN) opens.push(idx);
    if (line === AGENT_BLOCK_CLOSE) closes.push(idx);
  });

  if (opens.length === 0 && closes.length === 0) return { kind: "absent" };
  if (opens.length > 1) return { kind: "malformed", reason: "duplicate-open" };
  if (closes.length > 1) return { kind: "malformed", reason: "duplicate-close" };
  if (opens.length === 0) return { kind: "malformed", reason: "unopened" };
  if (closes.length === 0) return { kind: "malformed", reason: "unterminated" };
  if (closes[0] < opens[0]) return { kind: "malformed", reason: "misordered" };

  const open = opens[0];
  const close = closes[0];

  if (lines.slice(close + 1).some((line) => line.trim() !== "")) {
    return { kind: "malformed", reason: "trailing-content" };
  }

  const text = lines.slice(open + 1, close).join("\n");
  if (text.trim() === "") return { kind: "malformed", reason: "empty-block" };

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "malformed", reason: "invalid-json" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "malformed", reason: "non-object" };
  }

  return { kind: "extracted", value, text };
}

export function evaluateMechanicalRule(rawReply, rule, schema) {
  const extracted = extractAgentBlock(rawReply);
  if (extracted.kind !== "extracted") {
    return {
      passed: false,
      reason:
        extracted.kind === "absent"
          ? "No machine block found"
          : `Malformed machine block: ${extracted.reason}`,
    };
  }

  let schemaValid = true;
  if (schema) {
    const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
    schemaValid = Boolean(validate(extracted.value));
  }

  if (rule.type === "schema_valid") {
    return schemaValid
      ? { passed: true }
      : { passed: false, reason: "Machine block does not satisfy agent-output schema" };
  }

  if (!schemaValid) {
    return { passed: false, reason: "Machine block is invalid against schema" };
  }

  const output = extracted.value;

  switch (rule.type) {
    case "coherence_valid":
      return { passed: true };
    case "agent_equals":
      return output.agent === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected agent '${rule.expected}', got '${output.agent}'` };
    case "status_equals":
      return output.outcome?.status === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected status '${rule.expected}', got '${output.outcome?.status}'` };
    case "routing_hint_equals":
      return output.outcome?.next === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected routing hint '${rule.expected}', got '${output.outcome?.next}'` };
    case "scope_bounded": {
      const changed = output.changedFiles || [];
      const outOfScope = changed.filter(
        (file) => !rule.allowedPrefixes.some((prefix) => file.ref.startsWith(prefix)),
      );
      return outOfScope.length === 0
        ? { passed: true }
        : { passed: false, reason: `Files out of scope: ${outOfScope.map((f) => f.ref).join(", ")}` };
    }
    case "artifacts_contains":
      return (output.artifacts || []).includes(rule.path)
        ? { passed: true }
        : { passed: false, reason: `Artifacts does not contain '${rule.path}'` };
    case "artifacts_empty":
      return (output.artifacts || []).length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty artifacts, found ${output.artifacts?.length}` };
    case "changed_files_empty":
      return (output.changedFiles || []).length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty changedFiles, found ${output.changedFiles?.length}` };
    case "has_blocking_question":
      return (output.outcome?.questions || []).length > 0
        ? { passed: true }
        : { passed: false, reason: "Expected at least one blocking question" };
    case "no_blockers":
      return (output.outcome?.blockers || []).length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected no blockers, found ${output.outcome?.blockers?.length}` };
    case "verdict_equals": {
      const verdict = output.payload?.verdict;
      return verdict === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected verdict '${rule.expected}', got '${verdict}'` };
    }
    default:
      return { passed: false, reason: `Unknown mechanical rule: ${rule.type}` };
  }
}

export function classifyDiscrimination(withPromptPassRate, withoutPromptPassRate) {
  if (withPromptPassRate === withoutPromptPassRate) {
    return {
      discrimination:
        withPromptPassRate > 0 ? "non_discriminating_pass" : "non_discriminating_fail",
      isDiscriminating: false,
    };
  }
  if (withPromptPassRate > withoutPromptPassRate) {
    return {
      discrimination: "discriminating_benefit",
      isDiscriminating: true,
    };
  }
  return {
    discrimination: "regression",
    isDiscriminating: true,
  };
}

export function calculateVariantMetrics(variant, trials, assertions) {
  if (trials.length === 0) {
    return {
      variant,
      trials: [],
      passRateByAssertion: {},
      overallPassRate: 0,
      spread: 0,
      averageDurationMs: 0,
      averageConsumption: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const passRateByAssertion = {};
  for (const assertion of assertions) {
    const passedCount = trials.filter((t) =>
      t.assertionOutcomes.some((o) => o.assertionId === assertion.id && o.passed),
    ).length;
    passRateByAssertion[assertion.id] = passedCount / trials.length;
  }

  const trialPassRates = trials.map((trial) => {
    const passed = trial.assertionOutcomes.filter((o) => o.passed).length;
    return trial.assertionOutcomes.length > 0 ? passed / trial.assertionOutcomes.length : 0;
  });

  const overallPassRate =
    trialPassRates.reduce((acc, curr) => acc + curr, 0) / trialPassRates.length;

  const variance =
    trialPassRates.reduce((acc, curr) => acc + Math.pow(curr - overallPassRate, 2), 0) /
    trialPassRates.length;
  const spread = Math.sqrt(variance);

  const totalDuration = trials.reduce((acc, t) => acc + t.durationMs, 0);
  const averageDurationMs = totalDuration / trials.length;

  const totalConsumption = trials.reduce(
    (acc, t) => ({
      inputTokens: acc.inputTokens + t.consumption.inputTokens,
      outputTokens: acc.outputTokens + t.consumption.outputTokens,
      totalTokens: acc.totalTokens + t.consumption.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  const averageConsumption = {
    inputTokens: Math.round(totalConsumption.inputTokens / trials.length),
    outputTokens: Math.round(totalConsumption.outputTokens / trials.length),
    totalTokens: Math.round(totalConsumption.totalTokens / trials.length),
  };

  return {
    variant,
    trials,
    passRateByAssertion,
    overallPassRate,
    spread,
    averageDurationMs,
    averageConsumption,
  };
}

export function generateComparisonReport(
  caseId,
  promptId,
  withPrompt,
  withoutPrompt,
  assertions,
  previousPrompt,
) {
  const assertionAnalyses = assertions.map((assertion) => {
    const withRate = withPrompt.passRateByAssertion[assertion.id] ?? 0;
    const withoutRate = withoutPrompt.passRateByAssertion[assertion.id] ?? 0;
    const prevRate =
      previousPrompt !== undefined
        ? previousPrompt.passRateByAssertion[assertion.id] ?? 0
        : undefined;
    const { discrimination, isDiscriminating } = classifyDiscrimination(withRate, withoutRate);

    return {
      assertionId: assertion.id,
      kind: assertion.kind,
      withPromptPassRate: withRate,
      withoutPromptPassRate: withoutRate,
      previousPromptPassRate: prevRate,
      discrimination,
      isDiscriminating,
    };
  });

  const nonDiscriminatingCount = assertionAnalyses.filter((a) => !a.isDiscriminating).length;
  const modelGradedCount = assertions.filter((a) => a.kind === "model_graded").length;

  const costMultiplier =
    withoutPrompt.averageConsumption.totalTokens > 0
      ? withPrompt.averageConsumption.totalTokens / withoutPrompt.averageConsumption.totalTokens
      : 1;

  const latencyMultiplier =
    withoutPrompt.averageDurationMs > 0
      ? withPrompt.averageDurationMs / withoutPrompt.averageDurationMs
      : 1;

  const discriminating = assertionAnalyses.filter((a) => a.isDiscriminating);
  const passingAuthorized =
    discriminating.length > 0 &&
    discriminating.every((a) => a.discrimination === "discriminating_benefit");

  return {
    caseId,
    promptId,
    withPrompt,
    withoutPrompt,
    previousPrompt,
    assertions: assertionAnalyses,
    nonDiscriminatingCount,
    modelGradedCount,
    costMultiplier,
    latencyMultiplier,
    passingAuthorized,
  };
}
