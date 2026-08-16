// Generated from registered JSON Schemas. Do not edit.
// dependency: https://kratos.dev/schemas/result/v1 sha256:6ad1a8b5f56b324184f7cb3b760ed7d6a921fef98f4857130e15a6c0825236b9
// source: https://kratos.dev/schemas/host/adapter-message/v1 sha256:40e9d8e3bc053fe706ff7b92743370bf892522d267eca1f2cbc12e4c808bfecd
// source: https://kratos.dev/schemas/host/init-answers/v1 sha256:c816614cac9e6c5dd43f4f6f5bbab01dbcfb6e7bf58af4e30c6c311d57411806
// source: https://kratos.dev/schemas/host/operation-message/v1 sha256:8c31f1bc77a84c5a7e0955bff0931c5ceab9588c9aa2229502370ef2ba7205c4
// source: https://kratos.dev/schemas/state/approval/v1 sha256:746f251be3908027032d23be08c4f300cdf63455e6c32cdea73f459b03da07bf
// source: https://kratos.dev/schemas/state/event/v1 sha256:83431b3a9c1615460eb6faef640671e8ae300a1c347b929c009570a177e6c80d
// source: https://kratos.dev/schemas/state/evidence/v1 sha256:c8acfc4104fdf4f095059a241b30806c41d7023420710439e3e63122f5546bbf
// source: https://kratos.dev/schemas/state/feature/v1 sha256:e7f2cd451bc3e864e805b82b21d8abbc1468c710c0dd87cf50a77c359256165e
// source: https://kratos.dev/schemas/state/lock/v1 sha256:67bdc8eae594bae0df25dd61df39081dfbe77d96514a0bf24fecf4af20859a55
// source: https://kratos.dev/schemas/state/migration/v1 sha256:6251345514f7cee7fd512b79758f71c41c6abc440be786eae035331e131b003e
// source: https://kratos.dev/schemas/state/project-config/v1 sha256:0471230187a6ee726fdd26c68f524c9649730765b9962b3668c0eeccd3580fbf
// source: https://kratos.dev/schemas/state/snapshot/v1 sha256:d69b9106ce76a395900012d65a507355aa45d19c4f52e21407e95ced233877e8
// source: https://kratos.dev/schemas/state/transaction-manifest/v1 sha256:451cddd26a731a556f2a6cd764f9076b7c697ed640432a3145f2c56afd762eaa
// source: https://kratos.dev/schemas/state/transaction-progress/v1 sha256:87c50f21dd68caafe3044fc2cba589a5505e289b9eabf591628480e2ec64acc4

export namespace AdapterMessageV1Contract {
  export type AdapterMessageV1 = RequestMessage | ResponseMessage;
  export type Id = string;
  export type Semver = string;
  export type PayloadContract = string;
  export type Reference = string;
  export type Sha256 = string;
  export type KratosUniversalResultV1 =
    | {
        contractVersion: "1.0.0";
        status: "success";
        exitCode: 0;
        reasonCode: string;
        summary: string;
        why: string[];
        evidence: Evidence[];
        stateChanged: boolean;
        retryable: false;
        recovery: null;
      }
    | {
        contractVersion: "1.0.0";
        status: "failure";
        exitCode: 1 | 2;
        reasonCode: string;
        summary: string;
        /**
         * @minItems 1
         */
        why: [string, ...string[]];
        evidence: Evidence[];
        stateChanged: boolean;
        retryable: boolean;
        recovery: string;
      }
    | {
        contractVersion: "1.0.0";
        status: "blocked";
        exitCode: 3 | 4 | 5;
        reasonCode: string;
        summary: string;
        /**
         * @minItems 1
         */
        why: [string, ...string[]];
        evidence: Evidence[];
        stateChanged: boolean;
        retryable: boolean;
        recovery: string;
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
    payload: KratosUniversalResultV1;
    correlationId: Id;
  }
  export interface Evidence {
    kind: "artifact" | "event" | "approval" | "test" | "observation";
    ref: string;
    sha256?: string;
  }
}
export type AdapterMessageV1 = AdapterMessageV1Contract.AdapterMessageV1;
export namespace InitAnswersV1Contract {
  export interface InitAnswersV1 {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    /**
     * @minItems 1
     */
    hosts: ["claude" | "codex", ...("claude" | "codex")[]];
    language?: "en" | "pt-BR";
    policyMode?: "standard" | "strict";
    snapshots?: boolean;
  }
}
export type InitAnswersV1 = InitAnswersV1Contract.InitAnswersV1;
export namespace HostOperationMessageV1Contract {
  export type HostOperationMessageV1 =
    | ApprovalMessage
    | HookMessage
    | TimeoutMessage
    | CancellationMessage
    | ErrorMessage;
  export type Id = string;
  export type Reference = string;
  export type Sha256 = string;
  export type Mutation = {
    [k: string]: unknown | undefined;
  } & {
    state: "none" | "prepared" | "publishing" | "committed";
    transactionRef: Reference | null;
  };
  export type SafeLine = string;

  export interface ApprovalMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    correlationId: Id;
    operationId: Id;
    sequence: number;
    occurredAt: string;
    kind: "approval";
    payload: {
      approvalId: Id;
      decision: "approved" | "rejected";
      scope: Id;
      artifact: Artifact;
      challenge: Sha256;
      approver: Id;
      expiresAt: string | null;
    };
  }
  export interface Artifact {
    ref: Reference;
    sha256: Sha256;
  }
  export interface HookMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    correlationId: Id;
    operationId: Id;
    sequence: number;
    occurredAt: string;
    kind: "hook";
    payload: {
      host: "claude-code" | "codex";
      hook: Id;
      phase: "before" | "after";
      artifact: Artifact;
    };
  }
  export interface TimeoutMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    correlationId: Id;
    operationId: Id;
    sequence: number;
    occurredAt: string;
    kind: "timeout";
    payload: {
      deadline: string;
      elapsedMs: number;
      mutation: Mutation;
    };
  }
  export interface CancellationMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    correlationId: Id;
    operationId: Id;
    sequence: number;
    occurredAt: string;
    kind: "cancellation";
    payload: {
      requestedBy: Id;
      reason: SafeLine;
      mutation: Mutation;
    };
  }
  export interface ErrorMessage {
    contractVersion: "1.0.0";
    hostContract: "1.0.0";
    messageId: Id;
    correlationId: Id;
    operationId: Id;
    sequence: number;
    occurredAt: string;
    kind: "error";
    payload: {
      reasonCode: string;
      retryable: boolean;
      recovery: SafeLine;
      mutation: Mutation;
    };
  }
}
export type HostOperationMessageV1 =
  HostOperationMessageV1Contract.HostOperationMessageV1;
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
    expiresAt: Timestamp;
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
export namespace FeatureStateV1Contract {
  export interface FeatureStateV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    feature: string;
    objective: {
      text: string;
      status: "active" | "completed";
      createdAt: string;
      updatedAt: string;
      revision: number;
      budget?: {
        tokens: number;
      };
    };
  }
}
export type FeatureStateV1 = FeatureStateV1Contract.FeatureStateV1;
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
export namespace TransactionManifestV1Contract {
  export type Id = string;
  export type Sha256 = string;
  export type Timestamp = string;
  export type Operation =
    | {
        operationId: Id;
        kind: "write_file";
        path: Reference;
        expected: Fingerprint;
        result: Fingerprint;
        stagedPath: Reference;
      }
    | {
        operationId: Id;
        kind: "create_directory" | "delete_file";
        path: Reference;
        expected: Fingerprint;
        result: Fingerprint;
        stagedPath: null;
      };
  export type Reference = string;
  export type Fingerprint =
    | {
        kind: "missing";
      }
    | {
        kind: "directory";
      }
    | {
        kind: "file";
        size: SafeInteger;
        sha256: Sha256;
      };
  export type SafeInteger = number;

  export interface TransactionManifestV1 {
    contractVersion: "1.0.0";
    stateContract: "1.0.0";
    transactionId: Id;
    planDigest: Sha256;
    createdAt: Timestamp;
    /**
     * @minItems 1
     */
    operations: [Operation, ...Operation[]];
  }
}
export type TransactionManifestV1 =
  TransactionManifestV1Contract.TransactionManifestV1;
export namespace TransactionProgressV1Contract {
  export type TransactionProgressV1 =
    | {
        contractVersion: "1.0.0";
        stateContract: "1.0.0";
        transactionId: Id;
        manifestDigest: null;
        recoveryToken: Sha256;
        phase: "begun";
        publishedOperationIds: Id[];
        fileSync: "required";
        directorySync: "not_attempted" | "supported" | "unsupported";
        createdAt: Timestamp;
        updatedAt: Timestamp;
      }
    | {
        contractVersion: "1.0.0";
        stateContract: "1.0.0";
        transactionId: Id;
        manifestDigest: Sha256;
        recoveryToken: Sha256;
        phase: "prepared" | "publishing" | "committed";
        publishedOperationIds: Id[];
        fileSync: "required";
        directorySync: "not_attempted" | "supported" | "unsupported";
        createdAt: Timestamp;
        updatedAt: Timestamp;
      }
    | {
        contractVersion: "1.0.0";
        stateContract: "1.0.0";
        transactionId: Id;
        manifestDigest: Sha256 | null;
        recoveryToken: Sha256;
        phase: "aborted";
        publishedOperationIds: Id[];
        fileSync: "required";
        directorySync: "not_attempted" | "supported" | "unsupported";
        createdAt: Timestamp;
        updatedAt: Timestamp;
      };
  export type Id = string;
  export type Sha256 = string;
  export type Timestamp = string;
}
export type TransactionProgressV1 =
  TransactionProgressV1Contract.TransactionProgressV1;
