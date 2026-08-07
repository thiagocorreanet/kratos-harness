// Generated from registered JSON Schemas. Do not edit.
// source: https://mestre-yoda.dev/schemas/host/adapter-message/v1 sha256:b0e61944a2eb93215c46d23bdae08a0e9905a43ccf8edd91eef63f76fc63fafe
// source: https://mestre-yoda.dev/schemas/state/approval/v1 sha256:44c6490092a4effd67783f79ff19882be82059dc6b7b6524bb4417200a2ea73e
// source: https://mestre-yoda.dev/schemas/state/event/v1 sha256:06bf5fd6429b6bdd373bbb24e3cfa14e3d87a7797281cec9b1c1da46dbb2e38a
// source: https://mestre-yoda.dev/schemas/state/evidence/v1 sha256:471159581ca5b7ad791587723f938f3fa9befff2ebe6b1a0fc1e9b5427cec72c
// source: https://mestre-yoda.dev/schemas/state/lock/v1 sha256:04891b0af102b4c71ad1fade1413e0729bd6d0367540453d2fe997270ac236a4
// source: https://mestre-yoda.dev/schemas/state/migration/v1 sha256:698bcf9534ba820e0e807182c2d82dd0f1bd25031c79a6b7774a1674398c7cb6
// source: https://mestre-yoda.dev/schemas/state/project-config/v1 sha256:78fc5822e1cbf79b0185ceb8d40b64394acfcbb2fc2050526c702c3dc62efebb
// source: https://mestre-yoda.dev/schemas/state/snapshot/v1 sha256:6792451a6fb91370c8ca25e2943608837e9287d463f8d5377c8adaa8e1427677

export namespace AdapterMessageV1Contract {
  export type AdapterMessageV1 = {
    [k: string]: unknown | undefined;
  } & {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    messageType: "request" | "response";
    host: Id;
    operation: Id;
    capabilities: Id[];
    observedIdentity: {
      adapterVersion: Semver;
      model: Id | null;
    };
    payloadContract: PayloadContract;
    payload: RequestPayload | MestreYodaUniversalResultV1;
    correlationId: Id;
  };
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

  export interface RequestPayload {
    ref: Reference;
    sha256: Sha256;
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
