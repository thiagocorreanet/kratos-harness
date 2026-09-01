import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  resolveInitAnswers,
  skeletonEffects,
  profileStack,
} from "@kratos/runtime/domain/init";
import { fixedModelRouting } from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

const registry = createSchemaRegistry();

function answers(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.3.0",
    hostContract: "1.3.0",
    hosts: ["claude"],
    ...overrides,
  };
}

function answersV1_4(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.4.0",
    hostContract: "1.4.0",
    hosts: ["claude"],
    ...overrides,
  };
}

function answersV1_5(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.5.0",
    hostContract: "1.4.0",
    hosts: ["claude"],
    ...overrides,
  };
}

describe("initialization answers", () => {
  it("selects, clears, defaults, or preserves per-gate modes", async () => {
    const routing = fixedModelRouting([claudeCatalog()]);
    const selected = await resolveInitAnswers(
      answersV1_5({ gateModes: { "gaps-closed": "shadow" } }),
      registry,
      routing,
    );
    const preserved = await resolveInitAnswers(
      answersV1_5(),
      registry,
      routing,
      {
        gateModes: { "spec-approved": "enforce" },
      },
    );
    const defaulted = await resolveInitAnswers(
      answersV1_5(),
      registry,
      routing,
    );
    const cleared = await resolveInitAnswers(
      answersV1_5({ gateModes: {} }),
      registry,
      routing,
      { gateModes: { "spec-approved": "enforce" } },
    );

    expect(selected).toMatchObject({
      kind: "resolved",
      answers: { gateModes: { "gaps-closed": "shadow" } },
    });
    expect(preserved).toMatchObject({
      kind: "resolved",
      answers: { gateModes: { "spec-approved": "enforce" } },
    });
    expect(defaulted).toMatchObject({
      kind: "resolved",
      answers: { gateModes: {} },
      defaulted: expect.arrayContaining(["gateModes"]),
    });
    expect(cleared).toMatchObject({
      kind: "resolved",
      answers: { gateModes: {} },
    });
  });

  it("sets, clears, or preserves the acceptance attempt ceiling", async () => {
    const routing = fixedModelRouting([claudeCatalog()]);
    const set = await resolveInitAnswers(
      answersV1_4({ acceptanceAttemptCeiling: 5 }),
      registry,
      routing,
    );
    const clear = await resolveInitAnswers(
      answersV1_4({ acceptanceAttemptCeiling: null }),
      registry,
      routing,
    );
    const preserved = await resolveInitAnswers(
      answersV1_4(),
      registry,
      routing,
      { acceptanceAttemptCeiling: 7 },
    );

    expect(set).toMatchObject({
      kind: "resolved",
      answers: { acceptanceAttemptCeiling: 5 },
    });
    expect(clear.kind).toBe("resolved");
    if (clear.kind === "resolved") {
      expect(clear.answers).not.toHaveProperty("acceptanceAttemptCeiling");
    }
    expect(preserved).toMatchObject({
      kind: "resolved",
      answers: { acceptanceAttemptCeiling: 7 },
    });
  });

  it("rejects an acceptance attempt ceiling beyond JavaScript's safe integer range", async () => {
    expect(
      await resolveInitAnswers(
        answersV1_4({
          acceptanceAttemptCeiling: Number.MAX_SAFE_INTEGER + 1,
        }),
        registry,
        fixedModelRouting([claudeCatalog()]),
      ),
    ).toMatchObject({ kind: "invalid" });
  });

  it("produces identical configuration bytes for inverse enabled-host order", async () => {
    const forward = await resolveInitAnswers(
      answers({ hosts: ["claude", "codex"] }),
      registry,
      fixedModelRouting([claudeCatalog(), codexCatalog()]),
    );
    const reverse = await resolveInitAnswers(
      answers({ hosts: ["codex", "claude"] }),
      registry,
      fixedModelRouting([claudeCatalog(), codexCatalog()]),
    );
    if (forward.kind !== "resolved" || reverse.kind !== "resolved") {
      throw new Error("expected both answer documents to resolve");
    }
    const config = (resolved: typeof forward): string => {
      const effect = skeletonEffects(
        resolved.answers,
        profileStack({ rootEntries: ["package.json"] }),
      ).find(
        (candidate) =>
          candidate.kind === "write_file" &&
          candidate.path === ".brain/config.json",
      );
      if (effect?.kind !== "write_file") {
        throw new Error("expected generated configuration");
      }
      return effect.content;
    };

    expect(config(forward)).toBe(config(reverse));
  });

  it("defaults absent language policy to complete English defaults", async () => {
    const resolved = await resolveInitAnswers(
      answers({ hosts: ["codex"] }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.answers.language).toEqual({
      conversation: "en",
      documentation: "en",
      comments: "en",
      identifiers: "en",
      commits: "en",
      preserveConventions: true,
      enforcement: "advisory",
    });
    expect(resolved.defaulted).toContain("language");
  });

  it("rejects an incomplete language policy object with a diagnostic naming the missing field", async () => {
    const resolved = await resolveInitAnswers(
      answers({
        hosts: ["codex"],
        language: {
          conversation: "pt-BR",
          documentation: "pt-BR",
          // missing comments, identifiers, commits, preserveConventions, enforcement
        },
      }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );
    expect(resolved.kind).toBe("invalid");
  });

  it("resolves adapter defaults into canonical closed role assignments", async () => {
    const resolved = await resolveInitAnswers(
      answers({ hosts: ["codex"] }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );

    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.answers).toEqual({
      contractVersion: "1.5.0",
      hostContract: "1.4.0",
      hosts: ["codex"],
      language: {
        conversation: "en",
        documentation: "en",
        comments: "en",
        identifiers: "en",
        commits: "en",
        preserveConventions: true,
        enforcement: "advisory",
      },
      policyMode: "standard",
      gateModes: {},
      snapshots: true,
      modelRoles: { codex: codexCatalog().defaults },
      projectProfile: {
        commands: {
          test: { status: "unresolved" },
          lint: { status: "unresolved" },
          build: { status: "unresolved" },
          run: { status: "unresolved" },
        },
        paths: {
          source: { status: "unresolved" },
          tests: { status: "unresolved" },
          configuration: { status: "unresolved" },
        },
        conventions: {
          directoryLayout: { status: "unresolved" },
          naming: { status: "unresolved" },
          implementationLanguages: { status: "unresolved" },
        },
      },
    });
    // A person who supplied three fields and got six needs to see the other
    // three, or they will believe they chose them.
    expect(resolved.defaulted).toEqual([
      "language",
      "policyMode",
      "snapshots",
      "gateModes",
      "modelRoles.codex.planner",
      "modelRoles.codex.implementer",
      "modelRoles.codex.judge",
    ]);
  });

  it("makes explicit aliases override defaults and persists their canonical object forms", async () => {
    const resolved = await resolveInitAnswers(
      answers({
        hosts: ["codex"],
        language: {
          conversation: "pt-BR",
          documentation: "pt-BR",
          comments: "pt-BR",
          identifiers: "pt-BR",
          commits: "pt-BR",
          preserveConventions: true,
          enforcement: "advisory",
        },
        policyMode: "strict",
        snapshots: false,
        modelRoles: {
          codex: {
            planner: "planner-alias",
            implementer: { model: "impl-alias", effort: "medium" },
            judge: "judge-alias",
          },
        },
      }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );

    expect(resolved).toMatchObject({
      kind: "resolved",
      answers: {
        language: {
          conversation: "pt-BR",
          documentation: "pt-BR",
          comments: "pt-BR",
          identifiers: "pt-BR",
          commits: "pt-BR",
          preserveConventions: true,
          enforcement: "advisory",
        },
        modelRoles: {
          codex: {
            planner: { model: "planner-canonical", effort: "medium" },
            implementer: { model: "implementer-canonical", effort: "medium" },
            judge: { model: "judge-canonical", effort: "medium" },
          },
        },
      },
      defaulted: ["gateModes"],
    });
  });

  it("normalizes equivalent bare and object assignments to the same roles", async () => {
    const bare = await resolveInitAnswers(
      answers({
        hosts: ["codex"],
        modelRoles: {
          codex: {
            planner: "planner",
            implementer: "implementer",
            judge: "judge",
          },
        },
      }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );
    const objects = await resolveInitAnswers(
      answers({
        hosts: ["codex"],
        modelRoles: {
          codex: {
            planner: { model: "planner", effort: "medium" },
            implementer: { model: "implementer", effort: "medium" },
            judge: { model: "judge", effort: "medium" },
          },
        },
      }),
      registry,
      fixedModelRouting([codexCatalog()]),
    );

    expect(objects).toEqual(bare);
  });

  it("keeps the host order the caller chose while observing only enabled catalogs", async () => {
    const seen: string[] = [];
    const routing = {
      observe: (host: "claude" | "codex") => {
        seen.push(host);
        return Promise.resolve(
          host === "codex" ? codexCatalog() : claudeCatalog(),
        );
      },
    };
    const resolved = await resolveInitAnswers(
      answers({ hosts: ["codex", "claude"] }),
      registry,
      routing,
    );

    expect(resolved).toMatchObject({
      kind: "resolved",
      answers: { hosts: ["codex", "claude"] },
    });
    expect(seen).toEqual(["codex", "claude"]);
  });

  it.each([
    ["a missing catalog", answers({ hosts: ["codex"] }), fixedModelRouting([])],
    [
      "an unsupported explicit effort",
      answers({
        modelRoles: {
          claude: {
            planner: "planner",
            implementer: "implementer",
            judge: { model: "judge", effort: "xhigh" },
          },
        },
      }),
      fixedModelRouting([claudeCatalog()]),
    ],
    [
      "equal implementer and judge defaults",
      answers({ hosts: ["claude"] }),
      fixedModelRouting([
        {
          ...claudeCatalog(),
          defaults: {
            ...claudeCatalog().defaults,
            judge: claudeCatalog().defaults.implementer,
          },
        },
      ]),
    ],
  ])(
    "refuses %s before returning assignments",
    async (_label, document, routing) => {
      expect(
        await resolveInitAnswers(document, registry, routing),
      ).toMatchObject({
        kind: "invalid",
      });
    },
  );

  it("keeps the host and role that made a model resolution fail", async () => {
    const unavailable = await resolveInitAnswers(
      answers({ hosts: ["claude", "codex"] }),
      registry,
      fixedModelRouting([claudeCatalog()]),
    );
    const unsupportedEffort = await resolveInitAnswers(
      answers({
        hosts: ["claude", "codex"],
        modelRoles: {
          codex: {
            planner: "planner",
            implementer: "implementer",
            judge: { model: "judge", effort: "xhigh" },
          },
        },
      }),
      registry,
      fixedModelRouting([claudeCatalog(), codexCatalog()]),
    );

    expect(unavailable).toMatchObject({
      kind: "invalid",
      subject: { host: "codex" },
    });
    expect(unsupportedEffort).toMatchObject({
      kind: "invalid",
      subject: { host: "codex", role: "judge" },
    });
  });

  it.each([
    ["an unknown key", answers({ langauge: "en" })],
    ["no hosts at all", answers({ hosts: [] })],
    ["a repeated host", answers({ hosts: ["claude", "claude"] })],
    ["an unsupported host", answers({ hosts: ["cursor"] })],
    ["an unsupported language", answers({ language: "fr" })],
    [
      "a missing contract version",
      { hostContract: "1.0.0", hosts: ["claude"] },
    ],
  ])("refuses %s", async (_label, document) => {
    // A misspelled key that is quietly dropped is how somebody believes they
    // configured something they did not.
    expect(
      (await resolveInitAnswers(document, registry, fixedModelRouting([])))
        .kind,
    ).toBe("invalid");
  });

  it.each([
    ["a bare string", "init"],
    ["nothing at all", null],
  ])("refuses %s as an answers document", async (_label, document) => {
    // Standard input delivers whatever the caller piped. A value that is not
    // an object has no contract version to read, so the refusal names the
    // contract rather than a field the document never had.
    expect(
      await resolveInitAnswers(document, registry, fixedModelRouting([])),
    ).toMatchObject({
      kind: "invalid",
      reasonCode: "contract.host_version_invalid",
    });
  });

  it("names the reason a document was refused", async () => {
    const resolved = await resolveInitAnswers(
      { hosts: ["claude"] },
      registry,
      fixedModelRouting([]),
    );

    expect(resolved).toMatchObject({
      kind: "invalid",
      reasonCode: "contract.host_version_invalid",
    });
  });
});
