import type { AgentOutputV1 } from "@kratos/contracts";
import { checkAgentOutput } from "../agent/coherence.js";
import { extractAgentBlock } from "../agent/extract.js";
import { ajvSchemaRegistry } from "../../infra/schema/index.js";
import type { MechanicalRule } from "./model.js";

const registry = ajvSchemaRegistry();

export function evaluateMechanicalRule(
  rawReply: string,
  rule: MechanicalRule,
): { readonly passed: boolean; readonly reason?: string } {
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

  const validation = registry.validate({
    id: "host.agent-output",
    version: "1.0.0",
    value: extracted.value,
    structuralReasonCode: "trail.output_invalido",
  });

  if (rule.type === "schema_valid") {
    return validation.kind === "valid"
      ? { passed: true }
      : { passed: false, reason: "Machine block does not satisfy agent-output schema" };
  }

  if (validation.kind !== "valid") {
    return { passed: false, reason: "Machine block is invalid against schema" };
  }

  const output = validation.value as AgentOutputV1;

  if (rule.type === "coherence_valid") {
    const refusal = checkAgentOutput(output);
    return refusal === null
      ? { passed: true }
      : { passed: false, reason: `Coherence violation: ${refusal}` };
  }

  switch (rule.type) {
    case "agent_equals":
      return output.agent === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected agent '${rule.expected}', got '${output.agent}'` };
    case "status_equals":
      return output.outcome.status === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected status '${rule.expected}', got '${output.outcome.status}'` };
    case "routing_hint_equals":
      return output.outcome.next === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected routing hint '${rule.expected}', got '${output.outcome.next}'` };
    case "scope_bounded": {
      const outOfScope = output.changedFiles.filter(
        (file) => !rule.allowedPrefixes.some((prefix) => file.ref.startsWith(prefix)),
      );
      return outOfScope.length === 0
        ? { passed: true }
        : { passed: false, reason: `Files out of scope: ${outOfScope.map((f) => f.ref).join(", ")}` };
    }
    case "artifacts_contains":
      return output.artifacts.includes(rule.path)
        ? { passed: true }
        : { passed: false, reason: `Artifacts does not contain '${rule.path}'` };
    case "artifacts_empty":
      return output.artifacts.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty artifacts, found ${output.artifacts.length}` };
    case "changed_files_empty":
      return output.changedFiles.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty changedFiles, found ${output.changedFiles.length}` };
    case "has_blocking_question":
      return output.outcome.questions.length > 0
        ? { passed: true }
        : { passed: false, reason: "Expected at least one blocking question" };
    case "no_blockers":
      return output.outcome.blockers.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected no blockers, found ${output.outcome.blockers.length}` };
    case "verdict_equals": {
      if (output.agent === "review" && "verdict" in output.payload) {
        return output.payload.verdict === rule.expected
          ? { passed: true }
          : { passed: false, reason: `Expected review verdict '${rule.expected}', got '${output.payload.verdict}'` };
      }
      if (output.agent === "acceptance" && "verdict" in output.payload) {
        return output.payload.verdict === rule.expected
          ? { passed: true }
          : { passed: false, reason: `Expected acceptance verdict '${rule.expected}', got '${output.payload.verdict}'` };
      }
      return { passed: false, reason: `Agent '${output.agent}' payload does not carry verdict` };
    }
  }
}
