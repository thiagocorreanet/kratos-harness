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
    expect(
      Object.fromEntries(
        manifest.surfaces.map(({ id, sha256 }) => [id, sha256]),
      ),
    ).toEqual({
      agents:
        "390d56fa01d3af732ad0207c23734cf5735c1fa64b1ddfd7f00857615653d37e",
      benchmarks:
        "11b79efdc0e08211a2810cab7ad4c1df7637b638ef1b1e7550bab80115b17dfd",
      "go-inputs":
        "7182371e0e5a23bb1ae1f24b51e156b3de87396163f856788cdf75a2a121d9ad",
      hooks: "9f357297871a157d2aeb07f5604e389abd613d7d2d03ecf54ea6e8c919e5f46f",
      "init-templates":
        "c0bc812195f1ac714152a652eb052edf7bcd4e5d345529f6955fe18d4e36f730",
      migration:
        "c96b561e1b289cc4619675ff1597a234937071a0f4c177c241dabbf60055e2ce",
      "plugin-manifests":
        "f491b25a0ab48f97e544935afb707a7a9188f3d55fe4189af2638648c1d6ac76",
      "prd-contract":
        "f213095d91c8da81faff4d8ef0ec3bd1c10097f1ddb513d19a91793740775974",
      "release-contract":
        "029673cb911a3469deb30d770d5b263239b4f3fba3ca5095f6a1f834760100e1",
      schemas:
        "13994d61e989d72ee74a640243738c45f6ee1d32545e396ce9b049670455a503",
      skills:
        "7aafdb22f482184f407b030859cb97dedd20e62e3d3264325068b5595558c507",
      source:
        "637a0b0acd89666c2a8cac5f9a0af8e1b5a56b9eeca8a145af3a0c0f66badfc4",
    });
  });

  it("locks the four independent PRD anchors", () => {
    expect(manifest.prd_anchors).toEqual([
      {
        id: "prd-researcher",
        source_path: "agents/prd-researcher.md",
        bytes: 6876,
        sha256:
          "b032604100e7f54f6a78259d3e3df6e907f651eee62a85f39b7f8cb3569009dc",
        provenance_id: "private-go-v3-hash-only",
      },
      {
        id: "prd-output-schema",
        source_path: "schemas/prd-output.schema.json",
        bytes: 4855,
        sha256:
          "7fa4f468520fac2f2a0d3b766257e162d25f37520dd7507230616257f2fe503e",
        provenance_id: "private-go-v3-hash-only",
      },
      {
        id: "problem-discovery",
        source_path: "references/problem-discovery.md",
        bytes: 5670,
        sha256:
          "360c231c9156d39872f82de6fe65fd2c454e5abbbd8c5ff52cf6a0d2570d7e96",
        provenance_id: "private-go-v3-hash-only",
      },
      {
        id: "prd-template",
        source_path: "templates/brain/02-features/_template/00-prd.md",
        bytes: 2578,
        sha256:
          "75485f0049e38644cdb9c00db976a4d1c730a03bbf81d4e949a3bd58449453c3",
        provenance_id: "private-go-v3-hash-only",
      },
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
    expect(manifest.command_outputs.map(({ sha256 }) => sha256)).toEqual([
      "34bf52562bae401de106933a7565c9d3a5c8dc83c04b0b29492dd3f6f3983b7a",
      "8fe918223dc75b5fc644f2769fa38456077c1b0467e5bc2394597a77431414b6",
    ]);

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
    expect(manifest.release_binaries.map(({ sha256 }) => sha256)).toEqual([
      "da4ec4a2394ae90a94722f633bcb9157ddc5ee0133f46540b7c2c700abe378b8",
      "14ba51351606cb2706729027258ed5408a5d0bf592ccf78dc20360fb127fe645",
      "bf6a721aec8de8076330ce1e72308a60f3a351e216b307201a0987d48f1ff88d",
    ]);
    expect(manifest.plugin_projection).toMatchObject({
      id: "codex-cache-dist-projection",
      file_count: 59,
      provenance_id: "private-go-v3-hash-only",
    });
    expect(manifest.plugin_projection.sha256).toMatch(sha256);
    expect(manifest.plugin_projection.sha256).toBe(
      "0ac3c54c2f0932eb2c60f13e4522cfcca8f4218000fe2d68a589dcf3fa0b0dc3",
    );
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
