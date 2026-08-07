// Generated from registered JSON Schemas. Do not edit.
// source: https://mestre-yoda.dev/schemas/host/adapter-message/v1 sha256:58e71d3742ef50904aa6b1b8d848e7455ad0305d70e9e809e1ddf901fc6c4cb2
// source: https://mestre-yoda.dev/schemas/state/approval/v1 sha256:841fd2dd3ba3abf8ff4bfda6571b2be4ddbcf544e3551c55677fbf4243dba13b
// source: https://mestre-yoda.dev/schemas/state/event/v1 sha256:e803d6e14b50675a6bbd3f7b39df0a50b6d6fd1f90017d6a9f74a6b6848ca878
// source: https://mestre-yoda.dev/schemas/state/evidence/v1 sha256:ac5147a7fb442720e288f1c1a0bfcb76c75e02f4af9a0dd6e8c0a3922a7587d3
// source: https://mestre-yoda.dev/schemas/state/lock/v1 sha256:488d2e7f8269ef8803dd7f7803bddca2110759afc1cc42bbc8ca1498ffeb601b
// source: https://mestre-yoda.dev/schemas/state/migration/v1 sha256:5b1082202fcc83a9a3c2af6c4894eb3d3774ed1b2e6d43871a98bda1c9c409ef
// source: https://mestre-yoda.dev/schemas/state/project-config/v1 sha256:78fc5822e1cbf79b0185ceb8d40b64394acfcbb2fc2050526c702c3dc62efebb
// source: https://mestre-yoda.dev/schemas/state/snapshot/v1 sha256:bb600b0d7d311bda1e150ee9121388b68567a4806f55aca1e77b501faace02fb

export namespace AdapterMessageV1Contract {
  export type AdapterMessageV1 = RequestMessage | ResponseMessage;
  export type Id = string;
  export type Semver = string;
  export type PayloadContract = string;
  export type Reference = string;
  export type Sha256 = string;
  export type MestreYodaUniversalResultV1 = {
    [k: string]: unknown | undefined;
  } & {
    contractVersion: "1.0.0";
    status: "success" | "failure" | "blocked";
    exitCode: number;
    reasonCode: string;
    summary: string;
    why: string[];
    evidence: Evidence[];
    stateChanged: boolean;
    retryable: boolean;
    recovery: string | null;
  };

  export interface RequestMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    messageType: "request";
    host: Id;
    operation: Id;
    capabilities: Id[];
    observedIdentity: ObservedIdentity;
    payloadContract: PayloadContract;
    payload: RequestPayload;
    correlationId: Id;
  }
  export interface ObservedIdentity {
    adapterVersion: Semver;
    model: Id | null;
  }
  export interface RequestPayload {
    ref: Reference;
    sha256: Sha256;
  }
  export interface ResponseMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    messageType: "response";
    host: Id;
    operation: Id;
    capabilities: Id[];
    observedIdentity: ObservedIdentity;
    payloadContract: PayloadContract;
    payload: MestreYodaUniversalResultV1;
    correlationId: Id;
  }
  export interface Evidence {
    kind: "artifact" | "event" | "approval" | "test" | "observation";
    ref: string;
    sha256?: string;
  }
}
export type AdapterMessageV1 = AdapterMessageV1Contract.AdapterMessageV1;
export namespace ApprovalV1Contract {
  export type Id = string;
  export type Sha256 = string;
  export type SafeLine = string;
  export type Timestamp = string;

  export interface ApprovalV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    approvalId: Id;
    runId: Id;
    gate: Id;
    decision: "approved" | "rejected";
    prdDigest: Sha256;
    specDigest: Sha256;
    policyVersion: Id;
    approver: Id;
    observation: SafeLine;
    challenge: Sha256;
    decidedAt: Timestamp;
  }
}
export type ApprovalV1 = ApprovalV1Contract.ApprovalV1;
export namespace EventV1Contract {
  export type Id = string;
  export type Timestamp = string;
  export type Reference = string;
  export type Sha256 = string;

  export interface EventV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    eventId: Id;
    eventType: "operation" | "decision" | "transition" | "recovery";
    occurredAt: Timestamp;
    operation: Id;
    policyVersion: Id;
    priorRevision: number;
    resultingRevision: number;
    reasonCode: string;
    effect: "none" | "state" | "artifact" | "state-and-artifact";
    artifactRefs: Reference[];
    evidenceRefs: Reference[];
    observedIdentity: {
      host: Id;
      model: Id | null;
    };
    previousHash: Sha256 | null;
    eventHash: Sha256;
  }
}
export type EventV1 = EventV1Contract.EventV1;
export namespace EvidenceV1Contract {
  export type Id = string;
  export type Reference = string;
  export type Sha256 = string;
  export type Timestamp = string;

  export interface EvidenceV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    evidenceId: Id;
    kind: "artifact" | "event" | "approval" | "test" | "observation";
    ref: Reference;
    sha256: Sha256;
    classification: "public" | "internal" | "restricted";
    redaction: "none" | "metadata-only" | "redacted";
    recordedAt: Timestamp;
  }
}
export type EvidenceV1 = EvidenceV1Contract.EvidenceV1;
export namespace LockLeaseV1Contract {
  export type Id = string;
  export type Timestamp = string;

  export interface LockLeaseV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    resource: Id;
    owner: Id;
    leaseId: Id;
    acquiredAt: Timestamp;
    expiresAt: Timestamp;
    fencingToken: number;
    stateRevision: number;
  }
}
export type LockLeaseV1 = LockLeaseV1Contract.LockLeaseV1;
export namespace MigrationV1Contract {
  export type Id = string;
  export type Sha256 = string;
  export type Reference = string;
  export type Timestamp = string;

  export interface MigrationV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    migrationId: Id;
    sourceContract: "0.9.0" | "go-v3@0.6.5";
    destinationContract: "1.0.0";
    planDigest: Sha256;
    authorizationRef: Reference;
    backupDigest: Sha256;
    status: "planned" | "authorized" | "completed" | "failed" | "rolled-back";
    /**
     * @minItems 1
     */
    conversions: [
      {
        payloadContract: Id;
        sourceDigest: Sha256;
        destinationDigest: Sha256;
      },
      ...{
        payloadContract: Id;
        sourceDigest: Sha256;
        destinationDigest: Sha256;
      }[],
    ];
    verificationRefs: Reference[];
    rollbackRef: Reference;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }
}
export type MigrationV1 = MigrationV1Contract.MigrationV1;
export namespace ProjectConfigV1Contract {
  export interface ProjectConfigV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    pluginVersion: "0.0.0-development";
    hostContract: "1.0.0";
    language: "en" | "pt-BR";
    policyMode: "standard" | "strict";
    managedState: {
      directory: ".brain";
      eventLog: "events.jsonl";
      snapshots: boolean;
    };
  }
}
export type ProjectConfigV1 = ProjectConfigV1Contract.ProjectConfigV1;
export namespace SnapshotV1Contract {
  export type Id = string;
  export type Sha256 = string;
  export type Timestamp = string;

  export interface SnapshotV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    projectId: Id;
    runId: Id;
    status: "idle" | "active" | "blocked" | "completed";
    currentStep: Id | null;
    eventCursor: number;
    eventHash: Sha256;
    policyVersion: Id;
    lineage: {
      prdDigest: Sha256;
      specDigest: Sha256;
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }
}
export type SnapshotV1 = SnapshotV1Contract.SnapshotV1;
