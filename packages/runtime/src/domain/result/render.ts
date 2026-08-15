import type { Result } from "./result.js";
import { validateResult } from "./validate.js";

export interface Rendered {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Emit one compact object per invocation, terminated by one newline. */
export function renderResultJson(result: Result): Rendered {
  const validated = validateResult(result);
  return {
    stdout: `${JSON.stringify(validated)}\n`,
    stderr: "",
    exitCode: validated.exitCode,
  };
}

/** Render successes on stdout and labeled failures on stderr. */
export function renderResultHuman(result: Result): Rendered {
  const validated = validateResult(result);
  if (validated.exitCode === 0) {
    return {
      stdout: `${validated.summary}\n`,
      stderr: "",
      exitCode: validated.exitCode,
    };
  }
  const lines = [
    `Summary: ${validated.summary}`,
    ...validated.why.map((why) => `Why: ${why}`),
    `Reason: ${validated.reasonCode}`,
    ...validated.evidence.map(
      (evidence) =>
        `Evidence: ${evidence.kind} ${evidence.ref}${
          evidence.sha256 === undefined ? "" : ` sha256=${evidence.sha256}`
        }`,
    ),
    `State changed: ${String(validated.stateChanged)}`,
    `Retryable: ${String(validated.retryable)}`,
    `Recovery: ${String(validated.recovery)}`,
  ];
  return {
    stdout: "",
    stderr: `${lines.join("\n")}\n`,
    exitCode: validated.exitCode,
  };
}
