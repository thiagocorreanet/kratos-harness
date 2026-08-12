import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { gitCommandRecord } from "../packages/runtime/src/domain/git/evidence.js";

const digests = sha256Digests();
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const raw = (
  overrides: Partial<Parameters<typeof gitCommandRecord>[1]> = {},
) => ({
  spawned: true,
  exitCode: 0,
  stdout: utf8(""),
  stderr: utf8(""),
  timedOut: false,
  ...overrides,
});

describe("gitCommandRecord", () => {
  it("records argv, exit code, digests, and byte counts", () => {
    const record = gitCommandRecord(
      ["status", "--porcelain=v2"],
      raw({ stdout: utf8("out"), stderr: utf8("err") }),
      digests,
    );

    expect(record).toEqual({
      argv: ["status", "--porcelain=v2"],
      exitCode: 0,
      stdoutSha256: digests.sha256Bytes(utf8("out")),
      stdoutBytes: 3,
      stderrSha256: digests.sha256Bytes(utf8("err")),
      stderrBytes: 3,
      outcome: "ok",
    });
  });

  it("carries no output bytes, duration, or timestamp", () => {
    const record = gitCommandRecord(
      ["status"],
      raw({ stdout: utf8("secret content") }),
      digests,
    );
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain("secret content");
    expect(Object.keys(record).sort()).toEqual([
      "argv",
      "exitCode",
      "outcome",
      "stderrBytes",
      "stderrSha256",
      "stdoutBytes",
      "stdoutSha256",
    ]);
  });

  it("reports a non-zero exit as failed", () => {
    expect(
      gitCommandRecord(["status"], raw({ exitCode: 128 }), digests).outcome,
    ).toBe("failed");
  });

  it("reports a timeout as timeout regardless of exit code", () => {
    expect(
      gitCommandRecord(
        ["status"],
        raw({ exitCode: null, timedOut: true }),
        digests,
      ).outcome,
    ).toBe("timeout");
  });

  it("reports an unspawned process as not_spawned with a null exit code", () => {
    const record = gitCommandRecord(
      ["status"],
      raw({ spawned: false, exitCode: null }),
      digests,
    );

    expect(record.outcome).toBe("not_spawned");
    expect(record.exitCode).toBeNull();
  });

  it("produces an equal record for an equal command result", () => {
    const first = gitCommandRecord(
      ["status"],
      raw({ stdout: utf8("x") }),
      digests,
    );
    const second = gitCommandRecord(
      ["status"],
      raw({ stdout: utf8("x") }),
      digests,
    );

    expect(first).toEqual(second);
  });
});
