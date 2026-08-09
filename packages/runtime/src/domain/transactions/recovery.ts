import type {
  TransactionManifestV1,
  TransactionProgressV1,
} from "@mestre-yoda/contracts";
import type {
  PathFingerprint,
  RecoveryDecision,
  TransactionObservation,
} from "./model.js";

const missing = { kind: "missing" } as const;

export function decideRecovery(
  manifest: TransactionManifestV1,
  progress: TransactionProgressV1,
  observation: TransactionObservation,
): RecoveryDecision {
  if (!hasValidIdentity(manifest, progress)) return blocked(null);

  const manifestFailure = findManifestFailure(manifest);
  if (manifestFailure !== undefined) return blocked(manifestFailure);

  const operationIds = manifest.operations.map(
    (operation) => operation.operationId,
  );
  if (!hasValidPublishedPrefix(progress, operationIds)) {
    return blocked(null);
  }
  if (hasUnexpectedStagedContent(manifest, observation)) return blocked(null);

  if (progress.phase === "aborted") {
    const payloads = inspectPayloads(manifest, observation);
    if (payloads.blockedOperationId !== null) {
      return blocked(payloads.blockedOperationId);
    }
    return payloads.hasPayload
      ? { kind: "cleanup", terminal: "aborted" }
      : { kind: "complete", terminal: "aborted" };
  }

  if (progress.phase === "begun" || progress.phase === "prepared") {
    const destinationFailure = findUnexpectedPrepublicationDestination(
      manifest,
      observation,
    );
    if (destinationFailure !== null) return blocked(destinationFailure);

    if (progress.phase === "begun") {
      const payloads = inspectPayloads(manifest, observation);
      if (payloads.blockedOperationId !== null) {
        return blocked(payloads.blockedOperationId);
      }
    } else {
      const payloadFailure = findUnpublishablePayload(manifest, observation);
      if (payloadFailure !== null) return blocked(payloadFailure);
    }
    return { kind: "abort" };
  }

  if (progress.phase === "committed") {
    const destinationFailure = findNonResultDestination(manifest, observation);
    if (destinationFailure !== null) return blocked(destinationFailure);

    const payloads = inspectPayloads(manifest, observation);
    if (payloads.blockedOperationId !== null) {
      return blocked(payloads.blockedOperationId);
    }
    return payloads.hasPayload
      ? { kind: "cleanup", terminal: "committed" }
      : { kind: "complete", terminal: "committed" };
  }

  return decidePublishing(manifest, progress, observation);
}

function findManifestFailure(
  manifest: TransactionManifestV1,
): string | null | undefined {
  const operationIds = new Set<string>();
  const paths = new Set<string>();
  const stagedPaths = new Set<string>();
  for (const operation of manifest.operations) {
    if (
      operationIds.has(operation.operationId) ||
      paths.has(operation.path) ||
      (operation.stagedPath !== null && stagedPaths.has(operation.stagedPath))
    ) {
      return null;
    }
    operationIds.add(operation.operationId);
    paths.add(operation.path);
    if (operation.stagedPath !== null) stagedPaths.add(operation.stagedPath);
    if (sameFingerprint(operation.expected, operation.result)) {
      return operation.operationId;
    }
  }
  return undefined;
}

function hasUnexpectedStagedContent(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
): boolean {
  const knownPaths = new Set(
    manifest.operations.flatMap((operation) =>
      operation.stagedPath === null ? [] : [operation.stagedPath],
    ),
  );
  for (const [path, fingerprint] of observation.stagedPayloads) {
    if (!knownPaths.has(path) && fingerprint.kind !== "missing") return true;
  }
  return false;
}

function decidePublishing(
  manifest: TransactionManifestV1,
  progress: TransactionProgressV1,
  observation: TransactionObservation,
): RecoveryDecision {
  let observedResultCount = 0;
  let foundPrecondition = false;

  for (const operation of manifest.operations) {
    const destination = observation.destinations.get(operation.path);
    if (destination === undefined) return blocked(operation.operationId);

    if (sameFingerprint(destination, operation.result)) {
      if (foundPrecondition) return blocked(operation.operationId);
      observedResultCount += 1;
      continue;
    }
    if (sameFingerprint(destination, operation.expected)) {
      foundPrecondition = true;
      continue;
    }
    return blocked(operation.operationId);
  }

  for (const operationId of progress.publishedOperationIds.slice(
    observedResultCount,
  )) {
    return blocked(operationId);
  }

  const payloadFailure = findPublishingPayloadFailure(
    manifest,
    observation,
    observedResultCount,
  );
  if (payloadFailure !== null) return blocked(payloadFailure);

  for (const operation of manifest.operations.slice(
    progress.publishedOperationIds.length,
    observedResultCount,
  )) {
    return { kind: "record_published", operationId: operation.operationId };
  }

  const next = manifest.operations[observedResultCount];
  return next === undefined
    ? { kind: "commit" }
    : { kind: "publish", operationId: next.operationId };
}

function hasValidIdentity(
  manifest: TransactionManifestV1,
  progress: TransactionProgressV1,
): boolean {
  if (
    manifest.transactionId !== progress.transactionId ||
    manifest.createdAt !== progress.createdAt
  ) {
    return false;
  }

  switch (progress.phase) {
    case "begun":
      return true;
    case "aborted":
      return (
        progress.manifestDigest === null ||
        progress.recoveryToken === progress.manifestDigest
      );
    case "prepared":
    case "publishing":
    case "committed":
      return progress.recoveryToken === progress.manifestDigest;
  }
}

function hasValidPublishedPrefix(
  progress: TransactionProgressV1,
  operationIds: readonly string[],
): boolean {
  const published = progress.publishedOperationIds;
  if (new Set(published).size !== published.length) return false;
  if (
    published.some((operationId, index) => operationId !== operationIds[index])
  ) {
    return false;
  }

  if (
    progress.phase === "begun" ||
    progress.phase === "prepared" ||
    progress.phase === "aborted"
  ) {
    return published.length === 0;
  }
  if (progress.phase === "committed") {
    return published.length === operationIds.length;
  }
  return published.length <= operationIds.length;
}

function findUnexpectedPrepublicationDestination(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
): string | null {
  for (const operation of manifest.operations) {
    const destination = observation.destinations.get(operation.path);
    if (
      destination === undefined ||
      !sameFingerprint(destination, operation.expected)
    ) {
      return operation.operationId;
    }
  }
  return null;
}

function findNonResultDestination(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
): string | null {
  for (const operation of manifest.operations) {
    const destination = observation.destinations.get(operation.path);
    if (
      destination === undefined ||
      !sameFingerprint(destination, operation.result)
    ) {
      return operation.operationId;
    }
  }
  return null;
}

function findUnpublishablePayload(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
): string | null {
  for (const operation of manifest.operations) {
    if (operation.stagedPath === null) continue;
    const payload = observation.stagedPayloads.get(operation.stagedPath);
    if (payload === undefined || !sameFingerprint(payload, operation.result)) {
      return operation.operationId;
    }
  }
  return null;
}

function findPublishingPayloadFailure(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
  observedResultCount: number,
): string | null {
  for (const [index, operation] of manifest.operations.entries()) {
    if (operation.stagedPath === null) continue;
    const payload =
      observation.stagedPayloads.get(operation.stagedPath) ?? missing;
    if (index < observedResultCount) {
      if (payload.kind !== "missing") return operation.operationId;
    } else if (!sameFingerprint(payload, operation.result)) {
      return operation.operationId;
    }
  }
  return null;
}

function inspectPayloads(
  manifest: TransactionManifestV1,
  observation: TransactionObservation,
): {
  readonly blockedOperationId: string | null;
  readonly hasPayload: boolean;
} {
  let hasPayload = false;
  for (const operation of manifest.operations) {
    if (operation.stagedPath === null) continue;
    const payload =
      observation.stagedPayloads.get(operation.stagedPath) ?? missing;
    if (payload.kind === "missing") continue;
    if (!sameFingerprint(payload, operation.result)) {
      return { blockedOperationId: operation.operationId, hasPayload: false };
    }
    hasPayload = true;
  }
  return { blockedOperationId: null, hasPayload };
}

function sameFingerprint(
  left: PathFingerprint,
  right: PathFingerprint,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "file" || right.kind !== "file") return true;
  return left.size === right.size && left.sha256 === right.sha256;
}

function blocked(operationId: string | null): RecoveryDecision {
  return {
    kind: "blocked",
    reasonCode: "runtime.state_corrupt",
    operationId,
  };
}
