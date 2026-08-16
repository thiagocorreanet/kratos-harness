import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";

import {
  authorizeControlTowerDataOperation,
  classifyEvidenceTrust,
  comparePolicyPackShadow,
  createEvidenceAttestation,
  evaluateIndependentJudges,
  planControlTowerPublish,
  resolveControlTowerConflict,
  selectRigorProfile,
  verifyEvidenceAttestation,
  type AttestationCrypto,
  type PolicyPack,
} from "@kratos/runtime/domain/extensions";
import { describe, expect, it } from "vitest";

describe("risk-adaptive policy packs", () => {
  const pack: PolicyPack = {
    packId: "org-default",
    version: "1.0.0",
    digest: "a".repeat(64),
    authority: "organization",
    trusted: true,
    defaultProfileId: "standard",
    minimumProfileId: "standard",
    profiles: [
      {
        id: "standard",
        rank: 10,
        requirements: {
          gateIds: ["tests"],
          evidenceKinds: ["test"],
          minimumApprovals: 1,
          independentJudges: 0,
        },
      },
      {
        id: "critical",
        rank: 20,
        extends: "standard",
        requirements: {
          gateIds: ["security-review"],
          evidenceKinds: ["security-scan"],
          minimumApprovals: 2,
          independentJudges: 2,
        },
      },
    ],
    rules: [
      {
        id: "security-sensitive",
        profileId: "critical",
        when: { securitySensitive: true },
      },
    ],
  };

  it("selects a deterministic profile without weakening inherited policy", () => {
    const result = selectRigorProfile(pack, {
      changedFiles: 3,
      touchesProtectedPath: false,
      securitySensitive: true,
      changesPublicContract: false,
      migratesData: false,
    });
    expect(result).toMatchObject({
      kind: "selected",
      profileId: "critical",
      matchedRuleIds: ["security-sensitive"],
      requirements: {
        gateIds: ["security-review", "tests"],
        minimumApprovals: 2,
        independentJudges: 2,
      },
    });
  });

  it("fails closed for an untrusted pack", () => {
    expect(
      selectRigorProfile(
        { ...pack, trusted: false },
        {
          changedFiles: 0,
          touchesProtectedPath: false,
          securitySensitive: false,
          changesPublicContract: false,
          migratesData: false,
        },
      ),
    ).toEqual({ kind: "refused", reason: "policy.untrusted" });
  });

  it("reports a shadow comparison without changing historical decisions", () => {
    const selected = selectRigorProfile(pack, {
      changedFiles: 3,
      touchesProtectedPath: false,
      securitySensitive: true,
      changesPublicContract: false,
      migratesData: false,
    });
    expect(
      comparePolicyPackShadow(
        {
          profileId: "standard",
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the fixture pack above always declares this profile
          requirements: pack.profiles[0]!.requirements,
        },
        selected,
      ),
    ).toMatchObject({
      kind: "compared",
      change: "tightened",
      addedGateIds: ["security-review"],
    });
  });
});

describe("independent dual-judge evidence", () => {
  const expected = {
    artifactDigest: "a".repeat(64),
    criteriaDigest: "b".repeat(64),
    rubricVersion: "rubric-v1",
  };
  const observation = {
    ...expected,
    judgeId: "judge-a",
    independenceKey: "provider-a/model-a",
    verdict: "pass" as const,
    timedOut: false,
    observedAt: "2026-08-15T12:00:00.000Z",
  };

  it("returns a candidate only when two independent observations agree", () => {
    expect(
      evaluateIndependentJudges(expected, [
        observation,
        {
          ...observation,
          judgeId: "judge-b",
          independenceKey: "provider-b/model-b",
        },
      ]),
    ).toMatchObject({ kind: "candidate", verdict: "pass" });
  });

  it("escalates disagreement without mutating policy state", () => {
    expect(
      evaluateIndependentJudges(expected, [
        observation,
        {
          ...observation,
          judgeId: "judge-b",
          independenceKey: "provider-b/model-b",
          verdict: "fail",
        },
      ]),
    ).toMatchObject({
      kind: "human-review",
      reason: "judge.disagreement",
    });
  });
});

describe("optional Control Tower", () => {
  const envelope = {
    tenantId: "tenant-a",
    projectId: "project-a",
    bundleDigest: "a".repeat(64),
    signed: true,
    encrypted: true,
    redacted: true,
    containsSource: false,
    containsPrompt: false,
    containsSecret: false,
  };

  it("publishes only privacy-safe evidence as a non-authoritative consumer", () => {
    expect(
      planControlTowerPublish({
        enabled: true,
        online: true,
        authenticatedTenantId: "tenant-a",
        role: "contributor",
        envelope,
      }),
    ).toMatchObject({ kind: "publish", remoteAuthority: "evidence-consumer" });
  });

  it("keeps local evidence authoritative during divergence", () => {
    expect(
      resolveControlTowerConflict({
        localBundleDigest: "a".repeat(64),
        remoteBundleDigest: "b".repeat(64),
      }),
    ).toEqual({
      kind: "publish-local-evidence",
      authoritativeDigest: "a".repeat(64),
    });
  });

  it("requires tenant-scoped administration for export and deletion", () => {
    expect(
      authorizeControlTowerDataOperation({
        operation: "delete",
        authenticatedTenantId: "tenant-a",
        requestedTenantId: "tenant-a",
        projectId: "project-a",
        role: "administrator",
      }),
    ).toMatchObject({ kind: "authorized", operation: "delete" });
    expect(
      authorizeControlTowerDataOperation({
        operation: "export",
        authenticatedTenantId: "tenant-a",
        requestedTenantId: "tenant-b",
        projectId: "project-a",
        role: "administrator",
      }),
    ).toMatchObject({ reason: "tower.tenant_mismatch" });
  });
});

describe("signed evidence attestations", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const crypto: AttestationCrypto = {
    sha256: (value) => createHash("sha256").update(value).digest("hex"),
    sign: (value) =>
      nodeSign(null, Buffer.from(value), privateKey).toString("base64url"),
    verify: (value, signature) =>
      nodeVerify(
        null,
        Buffer.from(value),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
  };
  const claims = {
    subjectDigest: "a".repeat(64),
    bundleDigest: "b".repeat(64),
    issuer: "kratos-test",
    keyId: "test-key-1",
    issuedAt: "2026-08-15T12:00:00.000Z",
    expiresAt: "2026-08-16T12:00:00.000Z",
    nonce: "nonce-1",
  };
  const trustedKeys = [
    {
      keyId: "test-key-1",
      issuer: "kratos-test",
      status: "active" as const,
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: null,
    },
  ];

  it("verifies sanitized evidence offline", () => {
    const attestation = createEvidenceAttestation(claims, crypto);
    expect(
      verifyEvidenceAttestation(
        attestation,
        {
          trustedKeys,
          now: "2026-08-15T13:00:00.000Z",
          seenNonces: new Set(),
        },
        crypto,
      ),
    ).toMatchObject({ kind: "verified", claims });
  });

  it("rejects tampering, revocation, and replay", () => {
    const attestation = createEvidenceAttestation(claims, crypto);
    expect(
      verifyEvidenceAttestation(
        { ...attestation, claims: { ...claims, bundleDigest: "c".repeat(64) } },
        {
          trustedKeys,
          now: "2026-08-15T13:00:00.000Z",
          seenNonces: new Set(),
        },
        crypto,
      ),
    ).toMatchObject({ reason: "attestation.digest_mismatch" });
    expect(
      verifyEvidenceAttestation(
        attestation,
        {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the fixture always declares one trusted key
          trustedKeys: [{ ...trustedKeys[0]!, status: "revoked" }],
          now: "2026-08-15T13:00:00.000Z",
          seenNonces: new Set(),
        },
        crypto,
      ),
    ).toMatchObject({ reason: "attestation.key_revoked" });
    expect(
      verifyEvidenceAttestation(
        attestation,
        {
          trustedKeys,
          now: "2026-08-15T13:00:00.000Z",
          seenNonces: new Set(["nonce-1"]),
        },
        crypto,
      ),
    ).toMatchObject({ reason: "attestation.replayed" });
  });

  it("keeps unsigned local evidence supported and honestly labeled", () => {
    expect(
      classifyEvidenceTrust(
        null,
        {
          trustedKeys,
          now: "2026-08-15T13:00:00.000Z",
          seenNonces: new Set(),
        },
        crypto,
      ),
    ).toEqual({ kind: "unsigned", label: "unsigned-local-evidence" });
  });
});
