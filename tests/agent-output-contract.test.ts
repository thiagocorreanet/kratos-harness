import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentOutputV1 } from "@kratos/contracts";
import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
  AGENTS,
  MAX_BLOCK_LENGTH,
  checkAgentOutput,
  describeAgentOutputFailure,
  describeAgentOutputRefusal,
  describeBlockMalformation,
  extractAgentBlock,
  type AgentOutputRefusal,
  type BlockMalformation,
} from "@kratos/runtime/domain/agent";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { RUN_PHASES } from "@kratos/runtime/domain/workflow";
import { beforeAll, describe, expect, it } from "vitest";

import { collectImports } from "./support/architecture.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures/agent-output/v1");
const registry = createSchemaRegistry();

let valid: Readonly<Record<string, unknown>>;
let invalid: Readonly<Record<string, unknown>>;
let replies: Readonly<Record<string, string>>;

async function readDirectory(
  name: string,
): Promise<Readonly<Record<string, string>>> {
  const directory = join(fixtureRoot, name);
  const entries = await readdir(directory);
  const pairs = await Promise.all(
    entries.map(async (entry): Promise<readonly [string, string]> => [
      entry.replace(/\.(?:json|md)$/u, ""),
      await readFile(join(directory, entry), "utf8"),
    ]),
  );
  return Object.fromEntries(pairs);
}

async function readJsonDirectory(
  name: string,
): Promise<Readonly<Record<string, unknown>>> {
  return Object.fromEntries(
    Object.entries(await readDirectory(name)).map(([key, text]) => [
      key,
      JSON.parse(text) as unknown,
    ]),
  );
}

function validate(value: unknown) {
  return registry.validate({
    id: "host.agent-output",
    version: "1.0.0",
    value,
    structuralReasonCode: "trail.output_invalido",
  });
}

/** The block a reply carries, or a failure naming which exit it took. */
function accepted(reply: string): AgentOutputV1 {
  const extracted = extractAgentBlock(reply);
  if (extracted.kind !== "extracted") {
    throw new Error(`extraction exited as ${extracted.kind}`);
  }
  const validated = validate(extracted.value);
  if (validated.kind !== "valid") {
    throw new Error(
      describeAgentOutputFailure({
        kind: "invalid",
        ref: "x",
        diagnostics: validated.diagnostics,
      }),
    );
  }
  return validated.value;
}

function block(body: string, before = "", after = ""): string {
  return `${before}${AGENT_BLOCK_OPEN}\n${body}\n${AGENT_BLOCK_CLOSE}${after}`;
}

beforeAll(async () => {
  [valid, invalid, replies] = await Promise.all([
    readJsonDirectory("valid"),
    readJsonDirectory("invalid"),
    readDirectory("replies"),
  ]);
});

describe("the published agent output contract", () => {
  it("accepts a valid payload for every phase agent", () => {
    expect(Object.keys(valid).sort()).toEqual([...AGENTS].sort());
    for (const agent of AGENTS) {
      const result = validate(valid[agent]);
      expect(result.kind, agent).toBe("valid");
    }
  });

  it("refuses an invalid payload for every phase agent", () => {
    expect(Object.keys(invalid).sort()).toEqual([...AGENTS].sort());
    for (const agent of AGENTS) {
      const result = validate(invalid[agent]);
      expect(result.kind, agent).toBe("invalid");
      if (result.kind !== "invalid") throw new Error("unreachable");
      // A refusal that cannot name where it happened is not actionable.
      expect(result.diagnostics.length, agent).toBeGreaterThan(0);
      expect(
        describeAgentOutputFailure({
          kind: "invalid",
          ref: "reply.md",
          diagnostics: result.diagnostics,
        }),
        agent,
      ).toContain("host.agent-output@1.0.0");
    }
  });

  it("addresses exactly the phases a run walks", () => {
    expect([...AGENTS]).toEqual([...RUN_PHASES]);
  });

  it("refuses an unexpected field rather than warning about it", () => {
    const candidate = { ...(valid.prd as object), surprise: true };
    expect(validate(candidate).kind).toBe("invalid");
  });

  it("keeps artifacts and changed files as separate fields", () => {
    const code = valid.code as AgentOutputV1;
    expect(code.artifacts).toEqual([]);
    expect(code.changedFiles.map(({ ref }) => ref)).toEqual([
      "src/refunds/window.ts",
      "tests/refund-window.test.ts",
    ]);
  });

  it("shapes a blocking question as an object a host can render", () => {
    const spec = valid.spec as AgentOutputV1;
    expect(spec.outcome.questions).toEqual([
      {
        questionId: "q-refund-window",
        prompt: "Which refund window should the design implement?",
        kind: "single-choice",
        options: [
          { optionId: "days-14", label: "Fourteen days from delivery" },
          { optionId: "days-30", label: "Thirty days from delivery" },
        ],
      },
      {
        questionId: "q-refund-owner",
        prompt: "Who owns the refund ledger after this change?",
        kind: "free-text",
        options: [],
      },
    ]);
  });

  it.each([
    ["completed", "wait"],
    ["completed", "retry"],
    ["awaiting-input", "proceed"],
    ["blocked", "finish"],
  ])("refuses status %s routed as %s", (status, next) => {
    const candidate = structuredClone(valid.prd) as AgentOutputV1;
    const mutated = {
      ...candidate,
      outcome: { ...candidate.outcome, status, next },
    };
    expect(validate(mutated).kind).toBe("invalid");
  });

  it("requires a question when the agent awaits input", () => {
    const candidate = structuredClone(valid.spec) as AgentOutputV1;
    expect(
      validate({
        ...candidate,
        outcome: { ...candidate.outcome, questions: [] },
      }).kind,
    ).toBe("invalid");
  });

  it("requires a blocker when the agent reports itself blocked", () => {
    const candidate = structuredClone(valid.code) as AgentOutputV1;
    expect(
      validate({
        ...candidate,
        outcome: { ...candidate.outcome, blockers: [] },
      }).kind,
    ).toBe("invalid");
  });

  it("requires options on a choice question and forbids them otherwise", () => {
    const spec = structuredClone(valid.spec) as AgentOutputV1;
    const [choice, free] = spec.outcome.questions;
    if (choice === undefined || free === undefined) {
      throw new Error("the specification fixture lost its questions");
    }
    expect(
      validate({
        ...spec,
        outcome: {
          ...spec.outcome,
          questions: [{ ...choice, options: [] }, free],
        },
      }).kind,
    ).toBe("invalid");
    expect(
      validate({
        ...spec,
        outcome: {
          ...spec.outcome,
          questions: [choice, { ...free, options: choice.options }],
        },
      }).kind,
    ).toBe("invalid");
  });

  it("refuses an escaping reference in either path field", () => {
    const prd = structuredClone(valid.prd) as AgentOutputV1;
    expect(validate({ ...prd, artifacts: ["../secret"] }).kind).toBe("invalid");
    expect(
      validate({
        ...prd,
        changedFiles: [{ ref: "/etc/passwd", change: "modified" }],
      }).kind,
    ).toBe("invalid");
  });
});

describe("machine block extraction", () => {
  it("reports a reply that carries no block", () => {
    expect(extractAgentBlock(replies.absent ?? "")).toEqual({ kind: "absent" });
  });

  it("ignores an ordinary fenced example and extracts the machine block", () => {
    const output = accepted(replies.decoy ?? "");
    expect(output.agent).toBe("spec");
    // The decoy fence claims the run is blocked; the machine block does not.
    expect(output.outcome.status).toBe("completed");
  });

  it("names the parse failure of a malformed block", () => {
    const extracted = extractAgentBlock(replies.malformed ?? "");
    expect(extracted).toEqual({ kind: "malformed", reason: "invalid-json" });
  });

  it("refuses a block that is not the last thing in the reply", () => {
    const extracted = extractAgentBlock(replies.trailing ?? "");
    expect(extracted).toEqual({
      kind: "malformed",
      reason: "trailing-content",
    });
  });

  it("names the offending path of a schema-invalid block", () => {
    const extracted = extractAgentBlock(replies.invalid ?? "");
    if (extracted.kind !== "extracted") throw new Error("block not extracted");
    const result = validate(extracted.value);
    if (result.kind !== "invalid") throw new Error("block was accepted");
    expect(
      describeAgentOutputFailure({
        kind: "invalid",
        ref: "reply.md",
        diagnostics: result.diagnostics,
      }),
    ).toContain("outcome.status");
  });

  it("tolerates the line endings of either host", () => {
    const reply = replies.decoy ?? "";
    expect(extractAgentBlock(reply.split("\n").join("\r\n"))).toEqual(
      extractAgentBlock(reply),
    );
  });

  it("allows trailing whitespace after the closing delimiter", () => {
    expect(extractAgentBlock(block("{}", "", "\n\n  \n")).kind).toBe(
      "extracted",
    );
  });

  it.each<[string, BlockMalformation]>([
    [block("{}", `${AGENT_BLOCK_OPEN}\n`), "duplicate-open"],
    [`${block("{}")}\n${AGENT_BLOCK_CLOSE}`, "duplicate-close"],
    [`${AGENT_BLOCK_OPEN}\n{}`, "unterminated"],
    [`prose\n${AGENT_BLOCK_CLOSE}`, "unopened"],
    [block("", "", ""), "empty-block"],
    [block("not json"), "invalid-json"],
    [block("[1, 2]"), "non-object"],
    [block(`"${"x".repeat(MAX_BLOCK_LENGTH)}"`), "block-too-large"],
  ])("refuses a reply whose block is %#", (reply, reason) => {
    expect(extractAgentBlock(reply)).toEqual({ kind: "malformed", reason });
  });

  it("refuses a block that closes before it opens", () => {
    expect(
      extractAgentBlock(`${AGENT_BLOCK_CLOSE}\n{}\n${AGENT_BLOCK_OPEN}`),
    ).toEqual({ kind: "malformed", reason: "misordered" });
  });

  it("recognizes a delimiter only as a whole unindented line", () => {
    expect(extractAgentBlock(`  ${AGENT_BLOCK_OPEN}\n{}`)).toEqual({
      kind: "absent",
    });
  });

  it("describes every malformation in one sentence", () => {
    const reasons: readonly BlockMalformation[] = [
      "block-too-large",
      "duplicate-close",
      "duplicate-open",
      "empty-block",
      "invalid-json",
      "misordered",
      "non-object",
      "trailing-content",
      "unopened",
      "unterminated",
    ];
    for (const reason of reasons) {
      expect(describeBlockMalformation(reason)).toMatch(/^[A-Z].*\.$/u);
    }
  });
});

describe("agreements the schema cannot state", () => {
  it("accepts every valid fixture", () => {
    for (const agent of AGENTS) {
      expect(checkAgentOutput(valid[agent] as AgentOutputV1), agent).toBeNull();
    }
  });

  it("refuses a path claimed as both an artifact and a changed file", () => {
    const prd = structuredClone(valid.prd) as AgentOutputV1;
    expect(
      checkAgentOutput({
        ...prd,
        changedFiles: [{ ref: prd.artifacts[0] ?? "", change: "modified" }],
      }),
    ).toBe("artifact-also-changed");
  });

  it("refuses a changed file listed twice", () => {
    const code = structuredClone(valid.code) as AgentOutputV1;
    const first = code.changedFiles[0];
    if (first === undefined) throw new Error("the code fixture lost its files");
    expect(
      checkAgentOutput({
        ...code,
        changedFiles: [first, { ...first, change: "deleted" }],
      }),
    ).toBe("duplicate-changed-file");
  });

  it("refuses a repeated question or option identifier", () => {
    const spec = structuredClone(valid.spec) as AgentOutputV1;
    const [choice] = spec.outcome.questions;
    if (choice === undefined) throw new Error("the fixture lost its question");
    expect(
      checkAgentOutput({
        ...spec,
        outcome: { ...spec.outcome, questions: [choice, choice] },
      }),
    ).toBe("duplicate-question-id");
    const option = choice.options[0];
    if (option === undefined) throw new Error("the fixture lost its option");
    expect(
      checkAgentOutput({
        ...spec,
        outcome: {
          ...spec.outcome,
          questions: [
            { ...choice, options: [option, { ...option, label: "Other" }] },
          ],
        },
      }),
    ).toBe("duplicate-option-id");
  });

  it("refuses a plan whose steps repeat or depend on nothing known", () => {
    const plan = structuredClone(valid.plan) as AgentOutputV1;
    if (plan.agent !== "plan")
      throw new Error("the plan fixture changed agent");
    const [first, second] = plan.payload.steps;
    if (second === undefined) {
      throw new Error("the plan fixture lost its second step");
    }
    expect(
      checkAgentOutput({ ...plan, payload: { steps: [first, first] } }),
    ).toBe("duplicate-step-id");
    expect(
      checkAgentOutput({
        ...plan,
        payload: { steps: [first, { ...second, dependsOn: ["step-unknown"] }] },
      }),
    ).toBe("unknown-step-dependency");
  });

  it("refuses a verdict that contradicts what it reports", () => {
    const review = structuredClone(valid.review) as AgentOutputV1;
    if (review.agent !== "review")
      throw new Error("the review fixture changed");
    expect(
      checkAgentOutput({
        ...review,
        payload: { ...review.payload, verdict: "pass" },
      }),
    ).toBe("verdict-contradicts-findings");

    const acceptance = structuredClone(valid.acceptance) as AgentOutputV1;
    if (acceptance.agent !== "acceptance") {
      throw new Error("the acceptance fixture changed");
    }
    const [criterion] = acceptance.payload.criteria;
    expect(
      checkAgentOutput({
        ...acceptance,
        payload: {
          ...acceptance.payload,
          criteria: [{ ...criterion, outcome: "failed" }],
        },
      }),
    ).toBe("verdict-contradicts-criteria");
  });

  it("describes every refusal in one sentence", () => {
    const reasons: readonly AgentOutputRefusal[] = [
      "artifact-also-changed",
      "duplicate-changed-file",
      "duplicate-option-id",
      "duplicate-question-id",
      "duplicate-step-id",
      "unknown-step-dependency",
      "verdict-contradicts-criteria",
      "verdict-contradicts-findings",
    ];
    for (const reason of reasons) {
      expect(describeAgentOutputRefusal(reason)).toMatch(/^[A-Z].*\.$/u);
    }
  });
});

describe("what extraction and validation are allowed to reach", () => {
  it("performs no model call and no network access", async () => {
    const directory = join(repositoryRoot, "packages/runtime/src/domain/agent");
    const modules = await readdir(directory);
    const imports = (
      await Promise.all(
        modules.map((name) => collectImports(join(directory, name))),
      )
    ).flat();
    // The extractor and its model reach the published contracts, the schema
    // types, and each other. A platform module here would be the first step
    // towards a boundary that can call out; there is none to call.
    expect([...new Set(imports)].sort()).toEqual([
      "../schema/index.js",
      "./coherence.js",
      "./extract.js",
      "./model.js",
      "@kratos/contracts",
    ]);
  });

  it("returns the same answer for the same reply every time", () => {
    const reply = replies.decoy ?? "";
    expect(extractAgentBlock(reply)).toEqual(extractAgentBlock(reply));
  });
});
