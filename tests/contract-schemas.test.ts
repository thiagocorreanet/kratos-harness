import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = join(repositoryRoot, "schemas");
const fixtureRoot = join(repositoryRoot, "fixtures/contracts/v1");
const currentFixtureRoot = join(repositoryRoot, "fixtures/contracts/v1.1");
const artifacts = [
  ["host/init-answers.v1.schema.json", "init-answers.json", "host"],
  ["state/project-config.v1.schema.json", "project-config.json", "state"],
  ["state/snapshot.v1.schema.json", "snapshot.json", "state"],
  ["state/event.v1.schema.json", "event.json", "state"],
  ["state/approval.v1.schema.json", "approval.json", "state"],
  [
    "state/acceptance-criteria-snapshot.v1.schema.json",
    "acceptance-criteria-snapshot.json",
    "state",
  ],
  [
    "state/acceptance-verdict.v1.schema.json",
    "acceptance-verdict.json",
    "state",
  ],
  ["state/evidence.v1.schema.json", "evidence.json", "state"],
  ["state/failure-candidate.v1.schema.json", "failure-candidate.json", "state"],
  ["state/curated-memory.v1.schema.json", "curated-memory.json", "state"],
  ["state/feature.v1.schema.json", "feature.json", "state"],
  ["state/feature-scope.v1.schema.json", "feature-scope.json", "state"],
  ["state/lock.v1.schema.json", "lock.json", "state"],
  ["state/migration.v1.schema.json", "migration.json", "state"],
  [
    "state/transaction-manifest.v1.schema.json",
    "transaction-manifest.json",
    "state",
  ],
  [
    "state/transaction-progress.v1.schema.json",
    "transaction-progress.json",
    "state",
  ],
  ["host/adapter-message.v1.schema.json", "adapter-message.json", "host"],
  ["host/agent-output.v1.schema.json", "agent-output.json", "host"],
  ["host/gap-proposal.v1.schema.json", "gap-proposal.json", "host"],
  ["host/hook-observation.v1.schema.json", "hook-observation.json", "host"],
  ["host/pre-tool-use.v1.schema.json", "pre-tool-use.json", "host"],
  ["state/gap.v1.schema.json", "gap.json", "state"],
  ["state/gates.v1.schema.json", "gates.json", "state"],
  ["state/guardrails.v1.schema.json", "guardrails.json", "state"],
  [
    "state/requirement-discovery.v1.schema.json",
    "requirement-discovery.json",
    "state",
  ],
  ["state/run-usage.v1.schema.json", "run-usage.json", "state"],
  ["state/session-telemetry.v1.schema.json", "session-telemetry.json", "state"],
] as const;

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

let resultSchema: JsonObject;
let acceptanceCriterionIdSchema: JsonObject;
let loaded: {
  readonly schema: JsonObject;
  readonly fixture: JsonObject;
  readonly family: "state" | "host";
  readonly fixtureName: string;
}[];

beforeAll(async () => {
  [resultSchema, acceptanceCriterionIdSchema] = await Promise.all([
    readJson(join(schemaRoot, "result.v1.schema.json")),
    readJson(
      join(schemaRoot, "contracts/acceptance-criterion-id.v1.schema.json"),
    ),
  ]);
  loaded = await Promise.all(
    artifacts.map(async ([schemaName, fixtureName, family]) => ({
      schema: await readJson(join(schemaRoot, schemaName)),
      fixture: await readJson(join(fixtureRoot, fixtureName)),
      family,
      fixtureName,
    })),
  );
});

function contractAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(resultSchema);
  ajv.addSchema(acceptanceCriterionIdSchema);
  return ajv;
}

describe("versioned state and host schemas", () => {
  it.each([
    [
      "state/project-config.v1.schema.json",
      "0471230187a6ee726fdd26c68f524c9649730765b9962b3668c0eeccd3580fbf",
    ],
    [
      "state/event.v1.schema.json",
      "83431b3a9c1615460eb6faef640671e8ae300a1c347b929c009570a177e6c80d",
    ],
    [
      "host/init-answers.v1.schema.json",
      "c816614cac9e6c5dd43f4f6f5bbab01dbcfb6e7bf58af4e30c6c311d57411806",
    ],
    [
      "host/adapter-message.v1.schema.json",
      "40e9d8e3bc053fe706ff7b92743370bf892522d267eca1f2cbc12e4c808bfecd",
    ],
  ])("keeps the published %s schema byte-identical", async (path, digest) => {
    const bytes = await readFile(join(schemaRoot, path));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
  });

  it("publishes closed current model-role schema shapes", async () => {
    const paths = [
      "state/project-config.v1.1.schema.json",
      "state/event.v1.1.schema.json",
      "state/migration.v1.1.schema.json",
      "host/init-answers.v1.1.schema.json",
      "host/adapter-message.v1.1.schema.json",
      "host/phase-handoff.v1.1.schema.json",
    ] as const;
    const fixtures = [
      "project-config.json",
      "event.json",
      "migration.json",
      "init-answers.json",
      "adapter-message.json",
      "phase-handoff.json",
    ] as const;
    const current = await Promise.all(
      paths.map(async (path, index) => {
        const fixture = fixtures[index];
        if (fixture === undefined)
          throw new Error("current fixture unavailable");
        return {
          schema: await readJson(join(schemaRoot, path)),
          fixture: await readJson(join(currentFixtureRoot, fixture)),
        };
      }),
    );
    const ajv = contractAjv();
    for (const { schema, fixture } of current) {
      expect(ajv.compile(schema)(fixture)).toBe(true);
    }

    const project = current[0];
    const event = current[1];
    const migration = current[2];
    const init = current[3];
    const adapter = current[4];
    const handoff = current[5];
    if (
      project === undefined ||
      event === undefined ||
      migration === undefined ||
      init === undefined ||
      adapter === undefined ||
      handoff === undefined
    ) {
      throw new Error("current contract fixture unavailable");
    }

    const projectValidate = ajv.compile(project.schema);
    expect(projectValidate({ ...project.fixture, modelRoles: {} })).toBe(false);
    expect(
      projectValidate({
        ...project.fixture,
        modelRoles: { unexpected: {} },
      }),
    ).toBe(false);
    const roles = (project.fixture.modelRoles as JsonObject)
      .codex as JsonObject;
    expect(
      projectValidate({
        ...project.fixture,
        modelRoles: { codex: { ...roles, planner: { model: "model-x" } } },
      }),
    ).toBe(false);
    expect(
      projectValidate({
        ...project.fixture,
        modelRoles: {
          codex: {
            ...roles,
            planner: { model: "model-x", effort: "medium", extra: true },
          },
        },
      }),
    ).toBe(false);
    expect(
      projectValidate({
        ...project.fixture,
        modelRoles: { codex: { ...roles, planner: "invalid model" } },
      }),
    ).toBe(false);
    expect(
      projectValidate({
        ...project.fixture,
        modelRoles: {
          codex: {
            ...roles,
            planner: { model: "model-x", effort: "invalid effort" },
          },
        },
      }),
    ).toBe(false);

    const eventValidate = ajv.compile(event.schema);
    const observed = event.fixture.observedIdentity as JsonObject;
    const assignment = event.fixture.resolvedAssignment as JsonObject;
    expect(
      eventValidate({
        ...event.fixture,
        observedIdentity: { ...observed, effort: "medium" },
      }),
    ).toBe(true);
    expect(
      eventValidate({
        ...event.fixture,
        resolvedAssignment: { ...assignment, extra: true },
      }),
    ).toBe(false);

    const migrationValidate = ajv.compile(migration.schema);
    expect(
      migrationValidate({
        ...migration.fixture,
        rollback: {
          kind: "copy",
          backupRef: ".brain/backups/config.json",
          destinationRef: ".brain/config.json",
        },
      }),
    ).toBe(true);
    expect(
      migrationValidate({
        ...migration.fixture,
        rollback: {
          kind: "replace",
          backupRef: ".brain/backups/config.json",
          destinationRef: ".brain/config.json",
        },
      }),
    ).toBe(false);

    const initValidate = ajv.compile(init.schema);
    expect(
      initValidate({
        ...init.fixture,
        modelRoles: { codex: { ...roles, judge: "model-z" } },
      }),
    ).toBe(true);
    expect(
      initValidate({
        ...init.fixture,
        modelRoles: { codex: { ...roles, reviewer: "model-z" } },
      }),
    ).toBe(false);

    const adapterValidate = ajv.compile(adapter.schema);
    const catalogPayload = adapter.fixture.payload as JsonObject;
    expect(
      adapterValidate({
        ...adapter.fixture,
        payload: { ...catalogPayload, unexpected: true },
      }),
    ).toBe(false);
    const phaseExecution = {
      ...adapter.fixture,
      messageType: "phase-execution",
      payloadContract: "host.phase-execution@1.1.0",
      payload: {
        assignmentDigest: "a".repeat(64),
        model: null,
        effort: null,
      },
    };
    expect(adapterValidate(phaseExecution)).toBe(true);
    expect(
      adapterValidate({
        ...phaseExecution,
        payload: { ...phaseExecution.payload, unexpected: true },
      }),
    ).toBe(false);

    expect(
      adapterValidate({
        ...adapter.fixture,
        messageType: "request",
        operation: "sdd.agent.record:correlation-01",
        payloadContract: "host.agent-output@1.0.0",
        payload: {
          ref: ".brain/agent-replies/prd.md",
          sha256: "b".repeat(64),
        },
        phaseExecution: {
          assignmentDigest: "a".repeat(64),
          model: null,
          effort: null,
        },
      }),
    ).toBe(true);

    const handoffValidate = ajv.compile(handoff.schema);
    expect(
      handoffValidate({ ...handoff.fixture, assignmentDigest: "not-a-sha256" }),
    ).toBe(false);
  });

  it("strictly compiles every closed schema and accepts its fixture", () => {
    const ajv = contractAjv();

    for (const { schema, fixture, fixtureName } of loaded) {
      expect(schema.$schema, fixtureName).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      if (fixtureName === "adapter-message.json") {
        expect(schema.oneOf, fixtureName).toHaveLength(2);
        const definitions = schema.$defs as JsonObject;
        for (const name of ["requestMessage", "responseMessage"]) {
          expect((definitions[name] as JsonObject).additionalProperties).toBe(
            false,
          );
        }
      } else if (fixtureName === "hook-observation.json") {
        expect(schema.oneOf, fixtureName).toHaveLength(4);
        const definitions = schema.$defs as JsonObject;
        for (const name of [
          "sessionSample",
          "toolBefore",
          "toolFailed",
          "sessionEnd",
        ]) {
          expect((definitions[name] as JsonObject).unevaluatedProperties).toBe(
            false,
          );
        }
      } else {
        if (fixtureName === "agent-output.json") {
          // One closed payload per phase agent, chosen by the `agent`
          // discriminator, so an unexpected field is a contract violation for
          // every agent rather than only the one the fixture exercises.
          const definitions = schema.$defs as JsonObject;
          expect(schema.allOf, fixtureName).toHaveLength(6);
          for (const name of [
            "prdPayload",
            "specPayload",
            "planPayload",
            "codePayload",
            "reviewPayload",
            "acceptancePayload",
          ]) {
            expect(
              (definitions[name] as JsonObject).additionalProperties,
              name,
            ).toBe(false);
          }
        }
        expect(schema.additionalProperties, fixtureName).toBe(false);
      }
      const validate = ajv.compile(schema);
      expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
      expect(JSON.parse(JSON.stringify(fixture)), fixtureName).toEqual(fixture);
      expect(validate({ ...fixture, unexpected: true }), fixtureName).toBe(
        false,
      );
    }
  });

  it("requires exact family versions as the leading identity fields", () => {
    const ajv = contractAjv();

    for (const { schema, fixture, family, fixtureName } of loaded) {
      const validate = ajv.compile(schema);
      const versionKey = family === "state" ? "stateContract" : "hostContract";
      expect(Object.keys(fixture).slice(0, 2), fixtureName).toEqual([
        "contractVersion",
        versionKey,
      ]);
      const missing = Object.fromEntries(
        Object.entries(fixture).filter(([key]) => key !== versionKey),
      );
      if (fixtureName !== "guardrails.json") {
        expect(validate(missing), `${fixtureName}: missing`).toBe(false);
      }
      expect(
        validate({ ...fixture, [versionKey]: "2.0.0" }),
        `${fixtureName}: future`,
      ).toBe(false);
    }
  });

  it("binds project configuration to all three independent identities", () => {
    const projectConfig = loaded.find(
      ({ fixtureName }) => fixtureName === "project-config.json",
    )?.fixture;
    expect(projectConfig).toMatchObject({
      pluginVersion: "0.0.0-development",
      stateContract: "1.0.0",
      hostContract: "1.0.0",
    });
  });

  it.each(["\\Windows\\secret", "..\\secret", "foo\\..\\secret"])(
    "rejects Windows-rooted and backslash-traversal reference %s",
    (unsafeReference) => {
      const ajv = contractAjv();
      for (const { schema, fixture, fixtureName } of loaded.filter(
        ({ fixtureName }) =>
          [
            "adapter-message.json",
            "event.json",
            "evidence.json",
            "migration.json",
          ].includes(fixtureName),
      )) {
        const candidate = structuredClone(fixture);
        if (fixtureName === "adapter-message.json") {
          candidate.payload = {
            ...(candidate.payload as JsonObject),
            ref: unsafeReference,
          };
        } else if (fixtureName === "event.json") {
          candidate.artifactRefs = [unsafeReference];
        } else if (fixtureName === "evidence.json") {
          candidate.ref = unsafeReference;
        } else {
          candidate.authorizationRef = unsafeReference;
        }
        const validate = ajv.compile(schema);
        expect(validate(candidate), fixtureName).toBe(false);
      }
    },
  );

  it("rejects a leading-zero numeric adapter prerelease", () => {
    const adapter = loaded.find(
      ({ fixtureName }) => fixtureName === "adapter-message.json",
    );
    if (adapter === undefined) throw new Error("missing adapter fixture");
    const candidate = structuredClone(adapter.fixture);
    candidate.observedIdentity = {
      ...(candidate.observedIdentity as JsonObject),
      adapterVersion: "1.0.0-01",
    };
    const ajv = contractAjv();
    const validate = ajv.compile(adapter.schema);
    expect(validate(candidate)).toBe(false);
  });

  it("rejects impossible UTC timestamp components", () => {
    for (const { schema, fixtureName } of loaded.filter(
      ({ schema }) => (schema.$defs as JsonObject | undefined)?.timestamp,
    )) {
      const ajv = contractAjv();
      ajv.addSchema(schema);
      const validate = ajv.compile({
        $ref: `${String(schema.$id)}#/$defs/timestamp`,
      });
      expect(validate("2026-99-99T99:99:99Z"), fixtureName).toBe(false);
    }
  });

  it("bounds persisted cursors and revisions to safe integers", () => {
    for (const fixtureName of ["snapshot.json", "event.json"]) {
      const artifact = loaded.find((item) => item.fixtureName === fixtureName);
      if (artifact === undefined) throw new Error("missing revision fixture");
      const candidate = structuredClone(artifact.fixture);
      if (fixtureName === "snapshot.json") {
        candidate.eventCursor = Number.MAX_SAFE_INTEGER + 1;
      } else {
        candidate.resultingRevision = Number.MAX_SAFE_INTEGER + 1;
      }
      const ajv = contractAjv();
      const validate = ajv.compile(artifact.schema);
      expect(validate(candidate), fixtureName).toBe(false);
    }
  });

  it("enforces closed transaction operation fingerprints and staging", () => {
    const artifact = loaded.find(
      ({ fixtureName }) => fixtureName === "transaction-manifest.json",
    );
    if (artifact === undefined) throw new Error("missing transaction manifest");
    const validate = contractAjv().compile(artifact.schema);
    const operation = (artifact.fixture.operations as JsonObject[])[0];
    if (operation === undefined)
      throw new Error("missing transaction operation");

    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [{ ...operation, stagedPath: null }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [
          {
            ...operation,
            kind: "delete_file",
            result: { kind: "missing" },
            stagedPath: operation.stagedPath,
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [
          {
            ...operation,
            kind: "create_directory",
            result: { kind: "directory" },
            stagedPath: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [
          {
            ...operation,
            result: {
              kind: "file",
              size: Number.MAX_SAFE_INTEGER + 1,
              sha256: "a".repeat(64),
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({ ...structuredClone(artifact.fixture), operations: [] }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [{ ...operation, unexpected: true }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [
          {
            ...operation,
            expected: {
              ...(operation.expected as JsonObject),
              unexpected: true,
            },
          },
        ],
      }),
    ).toBe(false);
    for (const unsafeReference of [
      "/absolute",
      "../traversal",
      "backslash\\path",
      "https://example.test/payload",
    ]) {
      expect(
        validate({
          ...structuredClone(artifact.fixture),
          operations: [{ ...operation, path: unsafeReference }],
        }),
        `path: ${unsafeReference}`,
      ).toBe(false);
      expect(
        validate({
          ...structuredClone(artifact.fixture),
          operations: [{ ...operation, stagedPath: unsafeReference }],
        }),
        `stagedPath: ${unsafeReference}`,
      ).toBe(false);
    }
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        planDigest: "not-a-sha256",
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [
          {
            ...operation,
            result: {
              ...(operation.result as JsonObject),
              sha256: "not-a-sha256",
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        operations: [{ ...operation, kind: "replace_file" }],
      }),
    ).toBe(false);
  });

  it("requires manifest digests after transaction preparation", () => {
    const artifact = loaded.find(
      ({ fixtureName }) => fixtureName === "transaction-progress.json",
    );
    if (artifact === undefined) throw new Error("missing transaction progress");
    const validate = contractAjv().compile(artifact.schema);

    for (const phase of ["prepared", "publishing", "committed"]) {
      expect(
        validate({
          ...structuredClone(artifact.fixture),
          phase,
          manifestDigest: null,
        }),
        phase,
      ).toBe(false);
    }
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        phase: "begun",
        manifestDigest: null,
      }),
    ).toBe(true);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        phase: "begun",
        manifestDigest: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        phase: "aborted",
        manifestDigest: null,
      }),
    ).toBe(true);
    expect(
      validate({
        ...structuredClone(artifact.fixture),
        phase: "aborted",
        manifestDigest: "a".repeat(64),
      }),
    ).toBe(true);
    for (const candidate of [
      { recoveryToken: "not-a-sha256" },
      { manifestDigest: "not-a-sha256" },
      { phase: "recovering" },
      { fileSync: "optional" },
      { directorySync: "unknown" },
      { publishedOperationIds: ["operation-0001", "operation-0001"] },
    ]) {
      expect(
        validate({ ...structuredClone(artifact.fixture), ...candidate }),
        JSON.stringify(candidate),
      ).toBe(false);
    }
  });

  it("ships one payload fixture per schema plus the version-case table", async () => {
    expect((await readdir(fixtureRoot)).sort()).toEqual(
      [
        ...artifacts.map(([, fixtureName]) => fixtureName),
        // `host/operation-message.v1` is a lifecycle union rather than one
        // payload shape, so it carries a fixture per lifecycle kind. Each one
        // is validated in `host-operation-message.test.ts`.
        "operation-approval.json",
        "operation-cancellation.json",
        "operation-error.json",
        "operation-hook.json",
        "operation-timeout.json",
        "version-cases.json",
      ].sort(),
    );
  });
});
