import type {
  TransactionManifestV1,
  TransactionProgressV1,
} from "@mestre-yoda/contracts";
import {
  decideRecovery,
  type PathFingerprint,
  type RecoveryDecision,
  type TransactionObservation,
} from "@mestre-yoda/runtime/domain/transactions";
import { describe, expect, it } from "vitest";

const manifestDigest = "d".repeat(64);
const identityToken = "i".repeat(64);
const firstDigest = "a".repeat(64);
const secondDigest = "b".repeat(64);
const missing = { kind: "missing" } as const;
const createdAt = "2026-08-09T00:00:00.000Z";

const manifest = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  transactionId: "transaction-01",
  planDigest: "c".repeat(64),
  createdAt,
  operations: [
    {
      operationId: "operation-0001",
      kind: "write_file",
      path: ".brain/first.json",
      expected: missing,
      result: { kind: "file", size: 1, sha256: firstDigest },
      stagedPath:
        ".brain/transactions/transaction-01/staging/operation-0001.payload",
    },
    {
      operationId: "operation-0002",
      kind: "write_file",
      path: ".brain/second.json",
      expected: missing,
      result: { kind: "file", size: 1, sha256: secondDigest },
      stagedPath:
        ".brain/transactions/transaction-01/staging/operation-0002.payload",
    },
  ],
} as const satisfies TransactionManifestV1;

function progress(
  phase: TransactionProgressV1["phase"],
  publishedOperationIds: readonly string[] = [],
): TransactionProgressV1 {
  const digest = phase === "begun" ? null : manifestDigest;
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    transactionId: manifest.transactionId,
    manifestDigest: digest,
    recoveryToken: digest ?? identityToken,
    phase,
    publishedOperationIds: [...publishedOperationIds],
    fileSync: "required",
    directorySync: "supported",
    createdAt,
    updatedAt: createdAt,
  } as TransactionProgressV1;
}

function observation(
  destinations: readonly (readonly [string, PathFingerprint])[],
  stagedPayloads: readonly (readonly [string, PathFingerprint])[] = [],
): TransactionObservation & {
  readonly destinations: Map<string, PathFingerprint>;
  readonly stagedPayloads: Map<string, PathFingerprint>;
} {
  return {
    destinations: new Map(destinations),
    stagedPayloads: new Map(stagedPayloads),
  };
}

function allPreconditions(
  currentManifest: TransactionManifestV1 = manifest,
): TransactionObservation & {
  readonly destinations: Map<string, PathFingerprint>;
  readonly stagedPayloads: Map<string, PathFingerprint>;
} {
  return observation(
    currentManifest.operations.map((operation) => [
      operation.path,
      operation.expected,
    ]),
    currentManifest.operations.flatMap((operation) =>
      operation.stagedPath === null
        ? []
        : ([[operation.stagedPath, operation.result]] as const),
    ),
  );
}

function allResults(
  currentManifest: TransactionManifestV1 = manifest,
  keepPayloads = false,
): TransactionObservation & {
  readonly destinations: Map<string, PathFingerprint>;
  readonly stagedPayloads: Map<string, PathFingerprint>;
} {
  return observation(
    currentManifest.operations.map((operation) => [
      operation.path,
      operation.result,
    ]),
    keepPayloads
      ? currentManifest.operations.flatMap((operation) =>
          operation.stagedPath === null
            ? []
            : ([[operation.stagedPath, operation.result]] as const),
        )
      : [],
  );
}

describe("pure transaction recovery decisions", () => {
  it("aborts begun and prepared transactions only while all targets remain at preconditions", () => {
    expect(
      decideRecovery(manifest, progress("begun"), allPreconditions()),
    ).toEqual({ kind: "abort" });
    expect(
      decideRecovery(manifest, progress("prepared"), allPreconditions()),
    ).toEqual({ kind: "abort" });

    const changedBeforePublication = allPreconditions();
    changedBeforePublication.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );
    expect(
      decideRecovery(manifest, progress("prepared"), changedBeforePublication),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });
  });

  it("blocks the same corrupt known payload before and after persisting aborted", () => {
    const corruptPayload = allPreconditions();
    corruptPayload.stagedPayloads.set(manifest.operations[0].stagedPath, {
      kind: "file",
      size: 1,
      sha256: "e".repeat(64),
    });
    const expected = {
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    } as const;

    expect(decideRecovery(manifest, progress("begun"), corruptPayload)).toEqual(
      expected,
    );
    expect(
      decideRecovery(manifest, progress("aborted"), corruptPayload),
    ).toEqual(expected);
  });

  it("aborts begun when known staged payloads are missing or correct", () => {
    const missingPayload = allPreconditions();
    missingPayload.stagedPayloads.set(
      manifest.operations[0].stagedPath,
      missing,
    );

    expect(decideRecovery(manifest, progress("begun"), missingPayload)).toEqual(
      { kind: "abort" },
    );
    expect(
      decideRecovery(manifest, progress("begun"), allPreconditions()),
    ).toEqual({ kind: "abort" });
  });

  it("records an observed publication before trusting progress", () => {
    const firstAlreadyPublished = allPreconditions();
    firstAlreadyPublished.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );
    firstAlreadyPublished.stagedPayloads.set(
      manifest.operations[0].stagedPath,
      missing,
    );

    expect(
      decideRecovery(manifest, progress("publishing"), firstAlreadyPublished),
    ).toEqual({
      kind: "record_published",
      operationId: "operation-0001",
    });
  });

  it("publishes the next operation in manifest order when its target and payload are valid", () => {
    const nextAtPrecondition = allPreconditions();
    nextAtPrecondition.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );
    nextAtPrecondition.stagedPayloads.set(
      manifest.operations[0].stagedPath,
      missing,
    );

    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        nextAtPrecondition,
      ),
    ).toEqual({ kind: "publish", operationId: "operation-0002" });
  });

  it("blocks unexpected targets, missing payloads, and wrong payload digests", () => {
    const unexpectedTarget = allPreconditions();
    unexpectedTarget.destinations.set(manifest.operations[1].path, {
      kind: "file",
      size: 7,
      sha256: "e".repeat(64),
    });
    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        unexpectedTarget,
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0002",
    });

    const missingPayload = allPreconditions();
    missingPayload.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );
    missingPayload.stagedPayloads.set(
      manifest.operations[0].stagedPath,
      missing,
    );
    missingPayload.stagedPayloads.set(
      manifest.operations[1].stagedPath,
      missing,
    );
    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        missingPayload,
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0002",
    });

    const wrongPayload = allPreconditions();
    wrongPayload.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );
    wrongPayload.stagedPayloads.set(manifest.operations[0].stagedPath, missing);
    wrongPayload.stagedPayloads.set(manifest.operations[1].stagedPath, {
      kind: "file",
      size: 1,
      sha256: "f".repeat(64),
    });
    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        wrongPayload,
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0002",
    });
  });

  it("blocks an out-of-order result instead of rolling past an unpublished prefix", () => {
    const outOfOrder = allPreconditions();
    outOfOrder.destinations.set(
      manifest.operations[1].path,
      manifest.operations[1].result,
    );

    expect(
      decideRecovery(manifest, progress("publishing"), outOfOrder),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0002",
    });
  });

  it("commits only after all results are observed and recorded", () => {
    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        allResults(),
      ),
    ).toEqual({
      kind: "record_published",
      operationId: "operation-0002",
    });
    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001", "operation-0002"]),
        allResults(),
      ),
    ).toEqual({ kind: "commit" });
  });

  it("validates transaction identity, manifest digest token, and published prefix", () => {
    expect(
      decideRecovery(
        manifest,
        { ...progress("prepared"), transactionId: "replacement" },
        allPreconditions(),
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: null,
    });

    expect(
      decideRecovery(
        manifest,
        { ...progress("publishing"), recoveryToken: "e".repeat(64) },
        allPreconditions(),
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: null,
    });

    for (const publishedOperationIds of [
      ["operation-0002"],
      ["operation-0001", "operation-0001"],
      ["unknown-operation"],
    ]) {
      expect(
        decideRecovery(
          manifest,
          progress("publishing", publishedOperationIds),
          allPreconditions(),
        ),
      ).toEqual({
        kind: "blocked",
        reasonCode: "runtime.state_corrupt",
        operationId: null,
      });
    }
  });

  it("blocks ambiguous manifest fingerprints and unexpected staged content", () => {
    const ambiguousManifest = {
      ...manifest,
      operations: [
        {
          ...manifest.operations[0],
          result: manifest.operations[0].expected,
        },
        manifest.operations[1],
      ],
    } as const satisfies TransactionManifestV1;
    expect(
      decideRecovery(
        ambiguousManifest,
        progress("publishing"),
        allPreconditions(ambiguousManifest),
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });

    const unexpectedStaging = allPreconditions();
    unexpectedStaging.stagedPayloads.set(
      ".brain/transactions/transaction-01/staging/unexpected.payload",
      { kind: "file", size: 1, sha256: "e".repeat(64) },
    );
    expect(
      decideRecovery(manifest, progress("publishing"), unexpectedStaging),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: null,
    });
  });

  it("blocks duplicate manifest identities and incomplete publication facts", () => {
    const corruptedManifests = [
      {
        ...manifest,
        operations: [
          manifest.operations[0],
          {
            ...manifest.operations[1],
            operationId: manifest.operations[0].operationId,
          },
        ],
      },
      {
        ...manifest,
        operations: [
          manifest.operations[0],
          { ...manifest.operations[1], path: manifest.operations[0].path },
        ],
      },
      {
        ...manifest,
        operations: [
          manifest.operations[0],
          {
            ...manifest.operations[1],
            stagedPath: manifest.operations[0].stagedPath,
          },
        ],
      },
    ] as const satisfies readonly TransactionManifestV1[];

    for (const corruptedManifest of corruptedManifests) {
      expect(
        decideRecovery(
          corruptedManifest,
          progress("publishing"),
          allPreconditions(corruptedManifest),
        ),
      ).toEqual({
        kind: "blocked",
        reasonCode: "runtime.state_corrupt",
        operationId: null,
      });
    }

    const missingDestination = allPreconditions();
    missingDestination.destinations.delete(manifest.operations[0].path);
    expect(
      decideRecovery(manifest, progress("publishing"), missingDestination),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });

    expect(
      decideRecovery(
        manifest,
        progress("publishing", ["operation-0001"]),
        allPreconditions(),
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });
  });

  it("blocks invalid prepared and terminal payload or destination facts", () => {
    const unpreparedPayload = allPreconditions();
    unpreparedPayload.stagedPayloads.delete(manifest.operations[1].stagedPath);
    expect(
      decideRecovery(manifest, progress("prepared"), unpreparedPayload),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0002",
    });

    const incompleteCommit = allResults();
    incompleteCommit.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].expected,
    );
    expect(
      decideRecovery(
        manifest,
        progress("committed", ["operation-0001", "operation-0002"]),
        incompleteCommit,
      ),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });

    for (const phase of ["committed", "aborted"] as const) {
      const terminalObservation =
        phase === "committed" ? allResults() : allPreconditions();
      terminalObservation.stagedPayloads.set(
        manifest.operations[0].stagedPath,
        {
          kind: "file",
          size: 1,
          sha256: "e".repeat(64),
        },
      );
      expect(
        decideRecovery(
          manifest,
          progress(
            phase,
            phase === "committed" ? ["operation-0001", "operation-0002"] : [],
          ),
          terminalObservation,
        ),
      ).toEqual({
        kind: "blocked",
        reasonCode: "runtime.state_corrupt",
        operationId: "operation-0001",
      });
    }
  });

  it("handles non-write operations without inventing staged payloads", () => {
    const directoryManifest = {
      ...manifest,
      operations: [
        {
          operationId: "operation-0001",
          kind: "create_directory",
          path: ".brain/runs",
          expected: missing,
          result: { kind: "directory" },
          stagedPath: null,
        },
        manifest.operations[1],
      ],
    } as const satisfies TransactionManifestV1;
    const preparedObservation = allPreconditions(directoryManifest);

    expect(
      decideRecovery(
        directoryManifest,
        progress("prepared"),
        preparedObservation,
      ),
    ).toEqual({ kind: "abort" });
    expect(
      decideRecovery(
        directoryManifest,
        progress("publishing"),
        preparedObservation,
      ),
    ).toEqual({ kind: "publish", operationId: "operation-0001" });
    expect(
      decideRecovery(
        directoryManifest,
        progress("committed", ["operation-0001", "operation-0002"]),
        allResults(directoryManifest),
      ),
    ).toEqual({ kind: "complete", terminal: "committed" });
  });

  it("blocks a published write whose staged payload still exists", () => {
    const publishedWithPayload = allPreconditions();
    publishedWithPayload.destinations.set(
      manifest.operations[0].path,
      manifest.operations[0].result,
    );

    expect(
      decideRecovery(manifest, progress("publishing"), publishedWithPayload),
    ).toEqual({
      kind: "blocked",
      reasonCode: "runtime.state_corrupt",
      operationId: "operation-0001",
    });
  });

  it("keeps terminal recovery idempotent and requests cleanup only for valid leftover payloads", () => {
    expect(
      decideRecovery(
        manifest,
        progress("committed", ["operation-0001", "operation-0002"]),
        allResults(manifest, true),
      ),
    ).toEqual({ kind: "cleanup", terminal: "committed" });

    const committed = decideRecovery(
      manifest,
      progress("committed", ["operation-0001", "operation-0002"]),
      allResults(),
    );
    expect(committed).toEqual({ kind: "complete", terminal: "committed" });
    expect(
      decideRecovery(
        manifest,
        progress("committed", ["operation-0001", "operation-0002"]),
        allResults(),
      ),
    ).toEqual(committed);

    const abortedWithPayloads = allPreconditions();
    expect(
      decideRecovery(manifest, progress("aborted"), abortedWithPayloads),
    ).toEqual({ kind: "cleanup", terminal: "aborted" });

    const changedAfterAbort = observation([
      [manifest.operations[0].path, manifest.operations[0].result],
      [manifest.operations[1].path, manifest.operations[1].expected],
    ]);
    const aborted = decideRecovery(
      manifest,
      progress("aborted"),
      changedAfterAbort,
    );
    expect(aborted).toEqual({ kind: "complete", terminal: "aborted" });
    expect(
      decideRecovery(manifest, progress("aborted"), changedAfterAbort),
    ).toEqual(aborted);
  });
});

describe("generated transaction crash states", () => {
  it("aborts before publication and rolls forward monotonically after publication", () => {
    for (let operationCount = 1; operationCount <= 20; operationCount += 1) {
      const generatedManifest = createManifest(operationCount);
      const beforePublication = allPreconditions(generatedManifest);

      for (const phase of ["begun", "prepared"] as const) {
        expect(
          decideRecovery(
            generatedManifest,
            generatedProgress(generatedManifest, phase, []),
            beforePublication,
          ),
        ).toEqual({ kind: "abort" });
      }

      for (let crashIndex = 0; crashIndex <= operationCount; crashIndex += 1) {
        const recovered = recoverGeneratedCrash(generatedManifest, crashIndex);
        expect(recovered.decisions).not.toContainEqual({ kind: "abort" });
        expect(recovered.publishedCounts).toEqual(
          [...recovered.publishedCounts].sort((left, right) => left - right),
        );
        expect(recovered.finalDecision).toEqual({
          kind: "complete",
          terminal: "committed",
        });
        expect(
          decideRecovery(
            generatedManifest,
            recovered.progress,
            recovered.observation,
          ),
        ).toEqual(recovered.finalDecision);
      }
    }
  });
});

function createManifest(operationCount: number): TransactionManifestV1 {
  const operations = Array.from({ length: operationCount }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    return {
      operationId: `operation-${number}`,
      kind: "write_file" as const,
      path: `.brain/generated-${number}.json`,
      expected: missing,
      result: {
        kind: "file" as const,
        size: index + 1,
        sha256: (index + 1).toString(16).padStart(64, "0"),
      },
      stagedPath: `.brain/transactions/generated/staging/operation-${number}.payload`,
    };
  });
  const first = operations[0];
  if (first === undefined)
    throw new Error("generated manifest must not be empty");
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    transactionId: "generated",
    planDigest: "c".repeat(64),
    createdAt,
    operations: [first, ...operations.slice(1)],
  };
}

function generatedProgress(
  generatedManifest: TransactionManifestV1,
  phase: TransactionProgressV1["phase"],
  publishedOperationIds: readonly string[],
): TransactionProgressV1 {
  const digest = phase === "begun" ? null : manifestDigest;
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    transactionId: generatedManifest.transactionId,
    manifestDigest: digest,
    recoveryToken: digest ?? identityToken,
    phase,
    publishedOperationIds: [...publishedOperationIds],
    fileSync: "required",
    directorySync: "supported",
    createdAt: generatedManifest.createdAt,
    updatedAt: generatedManifest.createdAt,
  } as TransactionProgressV1;
}

function recoverGeneratedCrash(
  generatedManifest: TransactionManifestV1,
  crashIndex: number,
): {
  readonly decisions: readonly RecoveryDecision[];
  readonly publishedCounts: readonly number[];
  readonly finalDecision: RecoveryDecision;
  readonly progress: TransactionProgressV1;
  readonly observation: TransactionObservation;
} {
  const destinations = new Map<string, PathFingerprint>();
  const stagedPayloads = new Map<string, PathFingerprint>();
  generatedManifest.operations.forEach((operation, index) => {
    destinations.set(
      operation.path,
      index < crashIndex ? operation.result : operation.expected,
    );
    if (operation.stagedPath !== null) {
      stagedPayloads.set(
        operation.stagedPath,
        index < crashIndex ? missing : operation.result,
      );
    }
  });

  let currentProgress = generatedProgress(
    generatedManifest,
    "publishing",
    generatedManifest.operations
      .slice(0, Math.max(0, crashIndex - 1))
      .map((operation) => operation.operationId),
  );
  let currentObservation = { destinations, stagedPayloads };
  const decisions: RecoveryDecision[] = [];
  const publishedCounts: number[] = [
    currentProgress.publishedOperationIds.length,
  ];

  for (
    let step = 0;
    step < generatedManifest.operations.length * 3 + 4;
    step += 1
  ) {
    const decision = decideRecovery(
      generatedManifest,
      currentProgress,
      currentObservation,
    );
    decisions.push(decision);
    if (decision.kind === "record_published") {
      currentProgress = {
        ...currentProgress,
        publishedOperationIds: [
          ...currentProgress.publishedOperationIds,
          decision.operationId,
        ],
      };
      publishedCounts.push(currentProgress.publishedOperationIds.length);
      continue;
    }
    if (decision.kind === "publish") {
      const operation = generatedManifest.operations.find(
        (candidate) => candidate.operationId === decision.operationId,
      );
      if (operation === undefined)
        throw new Error("unknown generated operation");
      destinations.set(operation.path, operation.result);
      if (operation.stagedPath !== null) {
        stagedPayloads.set(operation.stagedPath, missing);
      }
      continue;
    }
    if (decision.kind === "commit") {
      currentProgress = {
        ...currentProgress,
        phase: "committed",
      } as TransactionProgressV1;
      continue;
    }
    if (decision.kind === "cleanup") {
      currentObservation = {
        destinations,
        stagedPayloads: new Map(
          [...stagedPayloads].map(([path]) => [path, missing] as const),
        ),
      };
      continue;
    }
    if (decision.kind === "complete") {
      return {
        decisions,
        publishedCounts,
        finalDecision: decision,
        progress: currentProgress,
        observation: currentObservation,
      };
    }
    throw new Error(
      `generated recovery blocked at crash index ${String(crashIndex)}`,
    );
  }
  throw new Error("generated recovery did not terminate");
}
