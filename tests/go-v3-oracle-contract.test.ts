import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = join(
  repositoryRoot,
  "compatibility/oracles/go-v3/v0.6.5/manifest.json",
);
const sha256 = /^[0-9a-f]{64}$/u;

interface Artifact {
  readonly id: string;
  readonly provenance_id: string;
  readonly sha256: string;
}

interface Manifest {
  readonly schema_version: number;
  readonly oracle_id: string;
  readonly version: string;
  readonly source: Record<string, unknown>;
  readonly distribution: Record<string, unknown>;
  readonly surfaces: readonly (Artifact & { readonly file_count: number })[];
  readonly prd_anchors: readonly (Artifact & {
    readonly bytes: number;
    readonly source_path: string;
  })[];
  readonly command_outputs: readonly (Artifact & {
    readonly arguments: readonly string[];
    readonly stdout_bytes: number;
    readonly exit_code: number;
    readonly stderr_empty: boolean;
  })[];
  readonly release_binaries: readonly (Artifact & {
    readonly asset: string;
    readonly bytes: number;
    readonly goarch: string;
    readonly goos: string;
  })[];
  readonly plugin_projection: Artifact & { readonly file_count: number };
  readonly provenance: Record<string, Record<string, unknown>>;
  readonly verification: Record<string, unknown>;
}

let manifest: Manifest;
let rawManifest: string;

beforeAll(async () => {
  rawManifest = await readFile(manifestPath, "utf8");
  manifest = JSON.parse(rawManifest) as Manifest;
});

describe("frozen Go v3 oracle catalog", () => {
  it("pins one exact source and distribution release", () => {
    expect(manifest).toMatchObject({
      schema_version: 1,
      oracle_id: "go-v3-v0.6.5",
      version: "0.6.5",
      source: {
        repository_slug: "betaup-sistemas/mestre-yoda",
        visibility: "private",
        tag: "v0.6.5",
        tag_object: "720f0a35074451208a0673324d223803add249e0",
        commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
        go_version: "1.23.4",
        file_count: 1157,
      },
      distribution: {
        repository_slug: "betaup-sistemas/mestre-yoda-dist",
        visibility: "private",
        tag: "v0.6.5",
        commit: "e6e6803c9329a53d362217a8f829a2801c83609d",
        file_count: 59,
      },
    });
    expect(manifest.source.archive_sha256).toMatch(sha256);
    expect(manifest.distribution.archive_sha256).toMatch(sha256);
  });

  it("captures every required private surface by hash and count", () => {
    expect(manifest.surfaces.map(({ id }) => id).sort()).toEqual(
      [
        "agents",
        "benchmarks",
        "go-inputs",
        "hooks",
        "init-templates",
        "migration",
        "plugin-manifests",
        "prd-contract",
        "release-contract",
        "schemas",
        "skills",
        "source",
      ].sort(),
    );
    for (const artifact of manifest.surfaces) {
      expect(artifact.sha256, artifact.id).toMatch(sha256);
      expect(artifact.file_count, artifact.id).toBeGreaterThan(0);
      expect(artifact.provenance_id, artifact.id).toBe(
        "private-go-v3-hash-only",
      );
    }
  });

  it("locks the four independent PRD anchors", () => {
    expect(manifest.prd_anchors.map(({ id }) => id)).toEqual([
      "prd-researcher",
      "prd-output-schema",
      "problem-discovery",
      "prd-template",
    ]);
    for (const artifact of manifest.prd_anchors) {
      expect(artifact.sha256, artifact.id).toMatch(sha256);
      expect(artifact.bytes, artifact.id).toBeGreaterThan(0);
      expect(artifact.source_path, artifact.id).not.toMatch(/^\//u);
      expect(artifact.provenance_id, artifact.id).toBe(
        "private-go-v3-hash-only",
      );
    }
  });

  it("fixes command outputs, binaries, and installed plugin projection", () => {
    expect(
      manifest.command_outputs.map(
        ({ arguments: commandArguments }) => commandArguments,
      ),
    ).toEqual([["version"], ["--help"]]);
    for (const output of manifest.command_outputs) {
      expect(output.sha256, output.id).toMatch(sha256);
      expect(output.stdout_bytes, output.id).toBeGreaterThan(0);
      expect(output.exit_code, output.id).toBe(0);
      expect(output.stderr_empty, output.id).toBe(true);
    }

    expect(
      manifest.release_binaries.map(({ asset, goarch, goos }) => ({
        asset,
        goarch,
        goos,
      })),
    ).toEqual([
      { asset: "yoda-linux-amd64", goarch: "amd64", goos: "linux" },
      {
        asset: "yoda-windows-amd64.exe",
        goarch: "amd64",
        goos: "windows",
      },
      { asset: "yoda-darwin-arm64", goarch: "arm64", goos: "darwin" },
    ]);
    for (const binary of manifest.release_binaries) {
      expect(binary.sha256, binary.id).toMatch(sha256);
      expect(binary.bytes, binary.id).toBeGreaterThan(1_000_000);
    }
    expect(manifest.plugin_projection).toMatchObject({
      id: "codex-cache-dist-projection",
      file_count: 59,
      provenance_id: "private-go-v3-hash-only",
    });
    expect(manifest.plugin_projection.sha256).toMatch(sha256);
  });

  it("records passed build and complete test evidence", () => {
    expect(manifest.verification).toMatchObject({
      status: "passed",
      source_rebuilds: 2,
      binary_rebuilds: 2,
      source_archives_identical: true,
      release_binaries_identical: true,
      installed_linux_binary_identical: true,
      go: {
        version: "1.23.4",
        race_suite: "passed",
        coverage_gate: "passed",
        total_coverage_percent: 81.97,
      },
      cross_builds: { darwin_arm64: "passed", windows_amd64: "passed" },
      python: { version: "3.12.3", gap_bench_tests: 10, spec_v2_tests: 75 },
      skill_cap: { limit: 150, observed_lines: 119, status: "passed" },
      tmpdir_outside_checkout: true,
    });
  });

  it("keeps all private artifacts metadata-only and publication-blocked", () => {
    expect(manifest.provenance["private-go-v3-hash-only"]).toEqual({
      owner: "BetaUp Sistemas",
      source_visibility: "private",
      license_status: "no-mit-publication-grant-established",
      classification: "behavioral-oracle-metadata",
      public_representation: "hash-and-metadata-only",
      content_publication: "denied",
    });

    expect(rawManifest).not.toMatch(
      /https?:\/\/|ssh:\/\/|git@|file:\/\/|\/home\/|BEGIN [A-Z ]*PRIVATE KEY/iu,
    );
    expect(rawManifest).not.toMatch(
      /"(?:content|payload|stdout|stderr|text)"/u,
    );
  });
});
