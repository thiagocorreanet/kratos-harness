import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { parseDocument } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const templateRoot = join(repositoryRoot, ".github", "ISSUE_TEMPLATE");
const schemaCommit = "4b00bca7dc9307b9dd34ca13d8c87329d66ad4ce";
const schemaSha256 =
  "c2722dbf00334ce4fdeffa960b8c9047caf4f1cbb8f3809663f4d604b1d3ae76";
const schemaUrl = `https://raw.githubusercontent.com/SchemaStore/schemastore/${schemaCommit}/src/schemas/json/github-issue-forms.json`;

const response = await globalThis.fetch(schemaUrl, {
  headers: { "user-agent": "mestre-yoda-template-validator" },
});
if (!response.ok) {
  throw new Error(
    `Unable to fetch pinned GitHub Issue Forms schema: HTTP ${String(response.status)}`,
  );
}

const schemaBytes = new Uint8Array(await response.arrayBuffer());
const observedSha256 = createHash("sha256").update(schemaBytes).digest("hex");
if (observedSha256 !== schemaSha256) {
  throw new Error(
    `Pinned schema hash mismatch: expected ${schemaSha256}, observed ${observedSha256}`,
  );
}

const schema = JSON.parse(new TextDecoder().decode(schemaBytes));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const filenames = (await readdir(templateRoot))
  .filter((filename) => filename.endsWith(".yml") && filename !== "config.yml")
  .sort();

for (const filename of filenames) {
  const path = join(templateRoot, filename);
  const source = await readFile(path, "utf8");
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new Error(
      `${filename}: YAML parse findings: ${JSON.stringify([
        ...document.errors,
        ...document.warnings,
      ])}`,
    );
  }
  const value = document.toJS();
  if (!validate(value)) {
    throw new Error(
      `${filename}: GitHub Issue Forms schema findings: ${JSON.stringify(validate.errors)}`,
    );
  }
  process.stdout.write(`valid: ${filename}\n`);
}

process.stdout.write(`schema-commit: ${schemaCommit}\n`);
process.stdout.write(`schema-sha256: ${schemaSha256}\n`);
process.stdout.write(`forms: ${String(filenames.length)}\n`);
