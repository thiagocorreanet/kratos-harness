import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = join(repositoryRoot, "schemas");
const fixtureRoot = join(repositoryRoot, "fixtures/contracts/v1");
const artifacts = [
  ["host/init-answers.v1.schema.json", "init-answers.json", "host"],
  ["state/project-config.v1.schema.json", "project-config.json", "state"],
  ["state/snapshot.v1.schema.json", "snapshot.json", "state"],
  ["state/event.v1.schema.json", "event.json", "state"],
  ["state/approval.v1.schema.json", "approval.json", "state"],
  ["state/evidence.v1.schema.json", "evidence.json", "state"],
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
] as const;

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

let resultSchema: JsonObject;
let loaded: {
  readonly schema: JsonObject;
  readonly fixture: JsonObject;
  readonly family: "state" | "host";
  readonly fixtureName: string;
}[];

beforeAll(async () => {
  resultSchema = await readJson(join(schemaRoot, "result.v1.schema.json"));
  loaded = await Promise.all(
    artifacts.map(async ([schemaName, fixtureName, family]) => ({
      schema: await readJson(join(schemaRoot, schemaName)),
      fixture: await readJson(join(fixtureRoot, fixtureName)),
      family,
      fixtureName,
    })),
  );
});

describe("versioned state and host schemas", () => {
  it("strictly compiles every closed schema and accepts its fixture", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(resultSchema);

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
      } else {
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
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(resultSchema);

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
      expect(validate(missing), `${fixtureName}: missing`).toBe(false);
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
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addSchema(resultSchema);
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
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(resultSchema);
    const validate = ajv.compile(adapter.schema);
    expect(validate(candidate)).toBe(false);
  });

  it("rejects impossible UTC timestamp components", () => {
    for (const { schema, fixtureName } of loaded.filter(
      ({ schema }) => (schema.$defs as JsonObject | undefined)?.timestamp,
    )) {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
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
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addSchema(resultSchema);
      const validate = ajv.compile(artifact.schema);
      expect(validate(candidate), fixtureName).toBe(false);
    }
  });

  it("enforces closed transaction operation fingerprints and staging", () => {
    const artifact = loaded.find(
      ({ fixtureName }) => fixtureName === "transaction-manifest.json",
    );
    if (artifact === undefined) throw new Error("missing transaction manifest");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      artifact.schema,
    );
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
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      artifact.schema,
    );

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

  it("ships eleven payload fixtures plus the version-case table", async () => {
    expect((await readdir(fixtureRoot)).sort()).toEqual(
      [
        ...artifacts.map(([, fixtureName]) => fixtureName),
        "version-cases.json",
      ].sort(),
    );
  });
});
