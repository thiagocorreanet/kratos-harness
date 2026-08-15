export interface AttestationClaims {
  readonly subjectDigest: string;
  readonly bundleDigest: string;
  readonly issuer: string;
  readonly keyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface EvidenceAttestation {
  readonly contractVersion: "1.0.0";
  readonly algorithm: "Ed25519";
  readonly claims: AttestationClaims;
  readonly claimsDigest: string;
  readonly signature: string;
}

export interface AttestationCrypto {
  readonly sha256: (value: string) => string;
  readonly sign: (canonicalClaims: string, keyId: string) => string;
  readonly verify: (
    canonicalClaims: string,
    signature: string,
    keyId: string,
  ) => boolean;
}

export interface TrustedEvidenceKey {
  readonly keyId: string;
  readonly issuer: string;
  readonly status: "active" | "revoked";
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export type AttestationVerification =
  | { readonly kind: "verified"; readonly claims: AttestationClaims }
  | {
      readonly kind: "invalid";
      readonly reason:
        | "attestation.digest_mismatch"
        | "attestation.expired"
        | "attestation.invalid_signature"
        | "attestation.key_expired"
        | "attestation.key_revoked"
        | "attestation.replayed"
        | "attestation.unknown_key";
    };

export type EvidenceTrust =
  | AttestationVerification
  | { readonly kind: "unsigned"; readonly label: "unsigned-local-evidence" };

function canonicalClaims(claims: AttestationClaims): string {
  return JSON.stringify({
    bundleDigest: claims.bundleDigest,
    expiresAt: claims.expiresAt,
    issuedAt: claims.issuedAt,
    issuer: claims.issuer,
    keyId: claims.keyId,
    nonce: claims.nonce,
    subjectDigest: claims.subjectDigest,
  });
}

export function createEvidenceAttestation(
  claims: AttestationClaims,
  crypto: AttestationCrypto,
): EvidenceAttestation {
  const canonical = canonicalClaims(claims);
  return {
    contractVersion: "1.0.0",
    algorithm: "Ed25519",
    claims,
    claimsDigest: crypto.sha256(canonical),
    signature: crypto.sign(canonical, claims.keyId),
  };
}

/** Performs offline verification; no project path or content is required. */
export function verifyEvidenceAttestation(
  attestation: EvidenceAttestation,
  input: {
    readonly trustedKeys: readonly TrustedEvidenceKey[];
    readonly now: string;
    readonly seenNonces: ReadonlySet<string>;
  },
  crypto: AttestationCrypto,
): AttestationVerification {
  const canonical = canonicalClaims(attestation.claims);
  if (crypto.sha256(canonical) !== attestation.claimsDigest) {
    return { kind: "invalid", reason: "attestation.digest_mismatch" };
  }
  const key = input.trustedKeys.find(
    (candidate) =>
      candidate.keyId === attestation.claims.keyId &&
      candidate.issuer === attestation.claims.issuer,
  );
  if (key === undefined) {
    return { kind: "invalid", reason: "attestation.unknown_key" };
  }
  if (key.status === "revoked") {
    return { kind: "invalid", reason: "attestation.key_revoked" };
  }
  if (
    input.now < key.validFrom ||
    (key.validUntil !== null && input.now > key.validUntil)
  ) {
    return { kind: "invalid", reason: "attestation.key_expired" };
  }
  if (input.now > attestation.claims.expiresAt) {
    return { kind: "invalid", reason: "attestation.expired" };
  }
  if (input.seenNonces.has(attestation.claims.nonce)) {
    return { kind: "invalid", reason: "attestation.replayed" };
  }
  if (!crypto.verify(canonical, attestation.signature, key.keyId)) {
    return { kind: "invalid", reason: "attestation.invalid_signature" };
  }
  return { kind: "verified", claims: attestation.claims };
}

export function classifyEvidenceTrust(
  attestation: EvidenceAttestation | null,
  input: {
    readonly trustedKeys: readonly TrustedEvidenceKey[];
    readonly now: string;
    readonly seenNonces: ReadonlySet<string>;
  },
  crypto: AttestationCrypto,
): EvidenceTrust {
  return attestation === null
    ? { kind: "unsigned", label: "unsigned-local-evidence" }
    : verifyEvidenceAttestation(attestation, input, crypto);
}
