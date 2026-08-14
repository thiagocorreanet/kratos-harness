import { describe, expect, it } from "vitest";

import {
  classifyHostContract,
  missingCapabilities,
  normalizeCapabilities,
} from "@mestre-yoda/runtime/domain/host";

describe("host contract negotiation", () => {
  it("accepts the revision this bundle carries", () => {
    expect(classifyHostContract({ hostContract: "1.0.0" })).toBeNull();
  });

  // The frozen cases in fixtures/contracts/v1/version-cases.json, now reached
  // through a message rather than through the classifier directly.
  it.each([
    ["a previous revision", "0.9.0", "contract.host_version_unsupported"],
    ["a future revision", "2.0.0", "contract.host_version_unsupported"],
    ["a malformed revision", "1.x", "contract.host_version_invalid"],
  ])("refuses %s", (_name, hostContract, reasonCode) => {
    const refusal = classifyHostContract({ hostContract });
    expect(refusal?.reasonCode).toBe(reasonCode);
    expect(refusal?.exitCode).toBe(2);
    expect(refusal?.status).toBe("failure");
    expect(refusal?.stateChanged).toBe(false);
  });

  it.each([
    ["a message with no contract", {}],
    ["a message that is not an object", "1.0.0"],
    ["null", null],
    ["a numeric contract", { hostContract: 1 }],
    ["an untrimmed contract", { hostContract: " 1.0.0" }],
  ])("refuses %s as invalid", (_name, document) => {
    expect(classifyHostContract(document)?.reasonCode).toBe(
      "contract.host_version_invalid",
    );
  });

  it("never echoes the declared revision", () => {
    const hostile = "1.0.0<script>/etc/passwd";
    const refusal = classifyHostContract({ hostContract: hostile });
    expect(JSON.stringify(refusal)).not.toContain(hostile);
    expect(JSON.stringify(refusal)).not.toContain("passwd");
  });

  it("reads the contract before anything validates the message", () => {
    // The message is otherwise unusable, and the answer still names the
    // contract rather than a missing field. That ordering is the whole point:
    // the schema pins hostContract to a constant, so a drifted host would
    // otherwise be reported as a bad property.
    expect(classifyHostContract({ hostContract: "0.9.0" })?.reasonCode).toBe(
      "contract.host_version_unsupported",
    );
  });
});

describe("host capability normalization", () => {
  it("sorts and deduplicates what a host declared", () => {
    expect(
      normalizeCapabilities([
        "process.execute",
        "filesystem.read",
        "process.execute",
      ]),
    ).toEqual(["filesystem.read", "process.execute"]);
  });

  it.each([
    ["a non-array", "filesystem.read"],
    ["undefined", undefined],
    ["null", null],
  ])("treats %s as no capabilities", (_name, value) => {
    expect(normalizeCapabilities(value)).toEqual([]);
  });

  it("drops entries that are not capability identifiers", () => {
    expect(
      normalizeCapabilities([
        "filesystem.read",
        "",
        "-leading",
        "with space",
        42,
        null,
        "a".repeat(129),
      ]),
    ).toEqual(["filesystem.read"]);
  });

  it("returns a list a caller cannot edit", () => {
    expect(Object.isFrozen(normalizeCapabilities(["a"]))).toBe(true);
  });

  it("normalizes two orderings to the same list", () => {
    expect(normalizeCapabilities(["b", "a"])).toEqual(
      normalizeCapabilities(["a", "b"]),
    );
  });
});

describe("missing host capabilities", () => {
  it("names what an operation needs and the host did not offer", () => {
    expect(
      missingCapabilities(
        ["filesystem.read"],
        ["process.execute", "filesystem.read", "filesystem.write"],
      ),
    ).toEqual(["filesystem.write", "process.execute"]);
  });

  it("reports nothing when the host offers everything required", () => {
    expect(
      missingCapabilities(
        ["filesystem.read", "process.execute"],
        ["filesystem.read"],
      ),
    ).toEqual([]);
  });

  it("reports each requirement once", () => {
    expect(missingCapabilities([], ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns a list a caller cannot edit", () => {
    expect(Object.isFrozen(missingCapabilities([], ["a"]))).toBe(true);
  });
});
