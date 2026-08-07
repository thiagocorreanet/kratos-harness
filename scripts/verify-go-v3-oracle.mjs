import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const defaultManifest = join(
  repositoryRoot,
  "compatibility/oracles/go-v3/v0.6.5/manifest.json",
);
const expected = {
  commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
  id: "go-v3-v0.6.5",
  tag: "v0.6.5",
  tagObject: "720f0a35074451208a0673324d223803add249e0",
};
const surfacePaths = {
  source: ["."],
  schemas: ["schemas"],
  skills: ["skills"],
  agents: ["agents"],
  hooks: ["hooks", "hooks.json"],
  "init-templates": ["templates", "internal/initgen/templates", "providers"],
  migration: [
    "internal/migrate",
    "cmd/yoda/migrate.go",
    "cmd/yoda/migrate_test.go",
    "docs/migracao-v2-v3.md",
  ],
  benchmarks: [
    "docs/bench",
    "internal/benchassets",
    "internal/gapbench",
    "internal/gapdetect",
    "tests/gap-bench",
    "tests/fixtures/gap-bench",
    "cmd/yoda/bench.go",
    "cmd/yoda/bench_test.go",
  ],
  "prd-contract": [
    "agents/prd-researcher.md",
    "schemas/prd-output.schema.json",
    "references/problem-discovery.md",
    "templates/brain/02-features/_template/00-prd.md",
    "tests/fixtures/gap-bench",
  ],
  "release-contract": [
    ".github/workflows/release.yml",
    ".github/workflows/dist-sync.yml",
    "scripts/diststage",
    "scripts/releasecheck",
    "scripts/mirror-dist-release.sh",
  ],
  "go-inputs": ["go.mod", "go.sum"],
  "plugin-manifests": [".claude-plugin", ".codex-plugin"],
};

function fail(message) {
  throw new Error(`Go v3 oracle verification failed: ${message}`);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail(`${commandName} ${args[0] ?? ""} did not complete successfully`);
  }
  return result.stdout;
}

function git(checkout, args, encoding = "utf8") {
  return command("git", ["-C", checkout, ...args], { encoding });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      ![
        "--manifest",
        "--source",
        "--dist-source",
        "--binary",
        "--plugin-cache",
      ].includes(flag) ||
      value === undefined
    ) {
      fail("expected option/value pairs for documented verifier options");
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

function assertDigest(value, context) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    fail(`${context} is not a SHA-256 digest`);
  }
}

function validateManifest(manifest, raw) {
  if (
    manifest.schema_version !== 1 ||
    manifest.oracle_id !== expected.id ||
    manifest.version !== "0.6.5" ||
    manifest.source?.tag !== expected.tag ||
    manifest.source?.tag_object !== expected.tagObject ||
    manifest.source?.commit !== expected.commit
  ) {
    fail("immutable oracle identity changed");
  }
  if (
    /https?:\/\/|ssh:\/\/|git@|file:\/\/|\/home\/|BEGIN [A-Z ]*PRIVATE KEY/iu.test(
      raw,
    )
  ) {
    fail("catalog contains a private URL, local path, or credential marker");
  }
  if (/"(?:content|payload|stdout|stderr|text)"/u.test(raw)) {
    fail("catalog contains a private payload field");
  }
  const provenance = manifest.provenance?.["private-go-v3-hash-only"];
  if (
    provenance?.license_status !== "no-mit-publication-grant-established" ||
    provenance?.public_representation !== "hash-and-metadata-only" ||
    provenance?.content_publication !== "denied"
  ) {
    fail("private provenance boundary is missing or weakened");
  }
  const requiredSurfaces = Object.keys(surfacePaths).sort();
  const surfaceIds = manifest.surfaces?.map(({ id }) => id).sort();
  if (JSON.stringify(surfaceIds) !== JSON.stringify(requiredSurfaces)) {
    fail("captured surface inventory changed");
  }
  const collections = [
    manifest.surfaces,
    manifest.prd_anchors,
    manifest.command_outputs,
    manifest.release_binaries,
    [manifest.plugin_projection],
  ];
  const ids = [];
  for (const collection of collections) {
    if (!Array.isArray(collection)) fail("artifact collection is missing");
    for (const artifact of collection) {
      if (
        artifact?.provenance_id !== "private-go-v3-hash-only" ||
        typeof artifact.id !== "string"
      ) {
        fail("artifact provenance is missing");
      }
      assertDigest(artifact.sha256, artifact.id);
      ids.push(artifact.id);
    }
  }
  if (new Set(ids).size !== ids.length) fail("artifact IDs are not unique");
  if (
    manifest.prd_anchors.length !== 4 ||
    manifest.command_outputs.length !== 2 ||
    manifest.release_binaries.length !== 3 ||
    manifest.verification?.status !== "passed"
  ) {
    fail("required evidence is incomplete");
  }
}

function archive(checkout, paths) {
  return git(
    checkout,
    ["archive", "--format=tar", expected.tag, "--", ...paths],
    null,
  );
}

function verifySource(source, manifest) {
  if (git(source, ["rev-parse", expected.tag]).trim() !== expected.tagObject) {
    fail("source tag object does not match");
  }
  if (
    git(source, ["rev-parse", `${expected.tag}^{commit}`]).trim() !==
    expected.commit
  ) {
    fail("source commit does not match");
  }
  for (const surface of manifest.surfaces) {
    const paths = surfacePaths[surface.id];
    const bytes = archive(source, paths);
    const files = git(source, [
      "ls-tree",
      "-r",
      "--name-only",
      expected.tag,
      "--",
      ...paths,
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    if (hash(bytes) !== surface.sha256 || files.length !== surface.file_count) {
      fail(`source surface ${surface.id} does not match`);
    }
  }
  for (const anchor of manifest.prd_anchors) {
    const bytes = git(
      source,
      ["show", `${expected.tag}:${anchor.source_path}`],
      null,
    );
    if (hash(bytes) !== anchor.sha256 || bytes.length !== anchor.bytes) {
      fail(`PRD anchor ${anchor.id} does not match`);
    }
  }
  console.log(`source ${expected.commit}: verified`);
}

function verifyDistribution(distribution, manifest) {
  const commit = git(distribution, [
    "rev-parse",
    `${expected.tag}^{commit}`,
  ]).trim();
  const bytes = archive(distribution, ["."]);
  const count = git(distribution, [
    "ls-tree",
    "-r",
    "--name-only",
    expected.tag,
  ])
    .trim()
    .split("\n")
    .filter(Boolean).length;
  if (
    commit !== manifest.distribution.commit ||
    hash(bytes) !== manifest.distribution.archive_sha256 ||
    count !== manifest.distribution.file_count
  ) {
    fail("distribution snapshot does not match");
  }
  console.log(`distribution ${commit}: verified`);
}

function verifyBinary(binary, manifest) {
  const expectedBinary = manifest.release_binaries.find(
    ({ id }) => id === "linux-amd64",
  );
  const bytes = readFileSync(binary);
  if (
    hash(bytes) !== expectedBinary.sha256 ||
    bytes.length !== expectedBinary.bytes
  ) {
    fail("Linux binary does not match");
  }
  for (const output of manifest.command_outputs) {
    const result = spawnSync(binary, output.arguments, { encoding: null });
    if (
      result.status !== output.exit_code ||
      result.stderr.length !== 0 ||
      result.stdout.length !== output.stdout_bytes ||
      hash(result.stdout) !== output.sha256
    ) {
      fail(`binary command ${output.id} does not match`);
    }
  }
  console.log(`binary ${expectedBinary.sha256}: verified`);
}

function projection(checkout, paths) {
  const lines = paths.map(
    (path) => `${hash(readFileSync(join(checkout, path)))}  ${path}\n`,
  );
  return hash(lines.join(""));
}

function verifyPluginCache(cache, distribution, manifest) {
  if (distribution === undefined) fail("--plugin-cache requires --dist-source");
  const paths = git(distribution, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    if (
      !statSync(join(cache, path)).isFile() ||
      hash(readFileSync(join(cache, path))) !==
        hash(readFileSync(join(distribution, path)))
    ) {
      fail(`plugin projection differs at ${path}`);
    }
  }
  if (
    paths.length !== manifest.plugin_projection.file_count ||
    projection(cache, paths) !== manifest.plugin_projection.sha256
  ) {
    fail("plugin projection does not match");
  }
  console.log(
    `plugin projection ${manifest.plugin_projection.sha256}: verified`,
  );
}

const options = parseArguments(process.argv.slice(2));
const manifestPath = options.manifest ?? defaultManifest;
const rawManifest = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(rawManifest);
validateManifest(manifest, rawManifest);
console.log(
  `oracle ${manifest.oracle_id}: public catalog verified (${manifest.surfaces.length} surfaces, ${manifest.prd_anchors.length} PRD anchors, ${manifest.release_binaries.length} binaries)`,
);
if (options.source !== undefined) verifySource(options.source, manifest);
if (options["dist-source"] !== undefined)
  verifyDistribution(options["dist-source"], manifest);
if (options.binary !== undefined) verifyBinary(options.binary, manifest);
if (options["plugin-cache"] !== undefined)
  verifyPluginCache(options["plugin-cache"], options["dist-source"], manifest);
