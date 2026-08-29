import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const templateRoot = join(repositoryRoot, ".github", "ISSUE_TEMPLATE");

const formFiles = [
  "bug.yml",
  "compatibility.yml",
  "documentation.yml",
  "feature.yml",
  "security-safe.yml",
] as const;

const requiredFields: Record<(typeof formFiles)[number], readonly string[]> = {
  "bug.yml": [
    "affected-version",
    "environment",
    "reproduction",
    "expected",
    "actual",
    "regression-evidence",
    "policy",
  ],
  "compatibility.yml": [
    "oracle",
    "provenance",
    "exact-input",
    "expected-result",
    "observed-result",
    "classification",
    "differential-evidence",
    "policy",
  ],
  "documentation.yml": [
    "location",
    "audience-problem",
    "proposed-change",
    "acceptance-evidence",
    "policy",
  ],
  "feature.yml": [
    "problem",
    "proposed-outcome",
    "acceptance-evidence",
    "alternatives",
    "impact",
    "policy",
  ],
  "security-safe.yml": [
    "safe-scope",
    "desired-hardening",
    "acceptance-evidence",
    "public-safety",
  ],
};

const existingLabels = new Set([
  "area:compatibility",
  "area:security",
  "bug",
  "documentation",
  "english-only",
  "enhancement",
  "type:documentation",
  "type:feature",
  "type:research",
  "type:security",
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown, context: string): JsonObject {
  expect(value, context).not.toBeNull();
  expect(Array.isArray(value), context).toBe(false);
  expect(typeof value, context).toBe("object");
  return value as JsonObject;
}

function onlyKeys(
  value: JsonObject,
  allowed: readonly string[],
  context: string,
): void {
  expect(
    Object.keys(value).filter((key) => !allowed.includes(key)),
    context,
  ).toEqual([]);
}

async function readYaml(path: string): Promise<JsonObject> {
  const source = await readFile(path, "utf8");
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
  });
  expect(document.errors, path).toEqual([]);
  expect(document.warnings, path).toEqual([]);
  return object(document.toJS(), path);
}

function validateBodyElement(
  elementValue: unknown,
  context: string,
): JsonObject {
  const element = object(elementValue, context);
  const type = element.type;
  expect(["markdown", "input", "textarea", "dropdown", "checkboxes"]).toContain(
    type,
  );

  if (type === "markdown") {
    onlyKeys(element, ["type", "attributes"], context);
    const attributes = object(element.attributes, `${context}.attributes`);
    expect(Object.keys(attributes), `${context}.attributes`).toEqual(["value"]);
    expect(attributes.value, context).toEqual(expect.any(String));
    return element;
  }

  onlyKeys(element, ["type", "id", "attributes", "validations"], context);
  expect(element.id, context).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  const attributes = object(element.attributes, `${context}.attributes`);
  expect(attributes.label, context).toEqual(expect.any(String));

  const allowedAttributeKeys: Record<string, readonly string[]> = {
    input: ["label", "description", "placeholder", "value"],
    textarea: ["label", "description", "placeholder", "value", "render"],
    dropdown: ["label", "description", "multiple", "options"],
    checkboxes: ["label", "description", "options"],
  };
  onlyKeys(attributes, allowedAttributeKeys[String(type)] ?? [], context);

  if (type === "dropdown") {
    expect(attributes.options, context).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
  }
  if (type === "checkboxes") {
    expect(element.validations, context).toBeUndefined();
    expect(Array.isArray(attributes.options), context).toBe(true);
    for (const [index, optionValue] of (
      attributes.options as unknown[]
    ).entries()) {
      const option = object(
        optionValue,
        `${context}.options[${String(index)}]`,
      );
      onlyKeys(option, ["label", "required"], context);
      expect(option.label, context).toEqual(expect.any(String));
      expect(option.required, context).toBe(true);
    }
    return element;
  }

  const validations = object(element.validations, `${context}.validations`);
  expect(validations).toEqual({ required: true });
  return element;
}

async function readForm(
  filename: (typeof formFiles)[number],
): Promise<JsonObject> {
  return readYaml(join(templateRoot, filename));
}

describe("GitHub Issue Form schema contract", () => {
  it("exposes exactly five forms and one chooser configuration", async () => {
    expect((await readdir(templateRoot)).sort()).toEqual(
      [...formFiles, "config.yml"].sort(),
    );
  });

  it("disables blank issues and routes confidential reports privately first", async () => {
    const config = await readYaml(join(templateRoot, "config.yml"));
    onlyKeys(config, ["blank_issues_enabled", "contact_links"], "config.yml");
    expect(config.blank_issues_enabled).toBe(false);
    expect(Array.isArray(config.contact_links)).toBe(true);
    const contactLinks = config.contact_links as unknown[];
    expect(contactLinks).toHaveLength(2);
    const security = object(contactLinks[0], "config.yml.contact_links[0]");
    const support = object(contactLinks[1], "config.yml.contact_links[1]");
    expect(security.name).toMatch(/vulnerability/i);
    expect(security.url).toBe(
      "https://github.com/thiagocorreanet/kratos/security/advisories/new",
    );
    expect(support.name).toMatch(/support/i);
    expect(support.url).toBe(
      "https://github.com/thiagocorreanet/kratos/blob/main/SUPPORT.md",
    );
  });

  it.each(formFiles)(
    "validates GitHub schema and policy for %s",
    async (filename) => {
      const form = await readForm(filename);
      onlyKeys(
        form,
        ["name", "description", "title", "labels", "assignees", "body"],
        filename,
      );
      expect(form.name, filename).toEqual(expect.any(String));
      expect(form.description, filename).toEqual(expect.any(String));
      expect(form.title, filename).toMatch(/^\[[A-Z-]+\] /);
      expect(form.labels, filename).toEqual(
        expect.arrayContaining(["english-only"]),
      );
      for (const label of form.labels as string[]) {
        expect(
          existingLabels.has(label),
          `${filename}: unknown label ${label}`,
        ).toBe(true);
      }

      expect(Array.isArray(form.body), filename).toBe(true);
      const elements = (form.body as unknown[]).map((element, index) =>
        validateBodyElement(element, `${filename}.body[${String(index)}]`),
      );
      const ids = elements.flatMap((element) =>
        typeof element.id === "string" ? [element.id] : [],
      );
      expect(new Set(ids).size, `${filename}: duplicate IDs`).toBe(ids.length);
      expect(ids, filename).toEqual(
        expect.arrayContaining([...requiredFields[filename]]),
      );

      const markdown = elements
        .filter((element) => element.type === "markdown")
        .map((element) => object(element.attributes, filename).value)
        .join("\n");
      expect(markdown).toMatch(/English/i);
      expect(markdown).toMatch(/secret|private data/i);
    },
  );

  it("makes the public security-safe form impossible to mistake for disclosure", async () => {
    const form = await readForm("security-safe.yml");
    const source = JSON.stringify(form);
    expect(source).toMatch(/public security hardening/i);
    expect(source).toContain(
      "https://github.com/thiagocorreanet/kratos/security/advisories/new",
    );
    expect(source).toMatch(/do not.*vulnerabilit/i);
    expect(source).toMatch(/no suspected vulnerability/i);
    expect(source).toMatch(/no secret/i);
  });
});

describe("pull request and contribution workflow contract", () => {
  it("separates deterministic evidence from model evaluations", async () => {
    const template = await readFile(
      join(repositoryRoot, ".github", "pull_request_template.md"),
      "utf8",
    );
    for (const heading of [
      "## Linked issue and work ID",
      "## Outcome and design",
      "## Compatibility and public contracts",
      "## State, migration, security, and rollback",
      "## Deterministic test evidence",
      "## Prompt and model evaluations",
      "## Failure evidence",
      "## Provenance",
      "## Checklist",
    ]) {
      expect(template).toContain(heading);
    }
    expect(template).toContain("Closes #ISSUE_NUMBER");
    expect(template).toMatch(/not a substitute for deterministic tests/i);
    expect(template).toMatch(/Signed-off-by|DCO/);
    expect(template).toMatch(/normative English/i);

    const deterministic =
      /## Deterministic test evidence\n(?<body>[\s\S]*?)\n## Prompt and model evaluations/u.exec(
        template,
      )?.groups?.body;
    expect(deterministic).toBeDefined();
    expect(deterministic).toMatch(/^- Acceptance evidence record:/mu);
    expect(deterministic).toMatch(/^- Focused verification:/mu);
    expect(deterministic).toMatch(
      /^- Full repository verification: `npm run verify`/mu,
    );
    expect(deterministic).toMatch(/^- Diff hygiene: `git diff --check`/mu);
  });

  it("documents labels, milestones, stable IDs, and proposed branches", async () => {
    const workflow = await readFile(
      join(repositoryRoot, "docs", "contributing", "workflow.md"),
      "utf8",
    );
    for (const namespace of [
      "type:*",
      "area:*",
      "priority:p0",
      "status:blocked",
    ]) {
      expect(workflow).toContain(`\`${namespace}\``);
    }
    for (const milestone of [
      "Foundation",
      "Compatibility Contract",
      "Deterministic Runtime",
      "SDD Workflow Parity",
      "Host Integrations",
      "Migration and Observability",
      "Quality Campaign",
      "Public Beta",
      "Post-1.0 Ideas",
    ]) {
      expect(workflow).toContain(milestone);
    }
    for (const stream of [
      "FND",
      "CMP",
      "RUN",
      "SDD",
      "ADP",
      "MIG",
      "OBS",
      "QAL",
      "BET",
      "FUT",
    ]) {
      expect(workflow).toMatch(new RegExp(`\\b${stream}\\b`));
    }
    expect(workflow).toContain("[STREAM-NN]");
    expect(workflow).toMatch(/immutable/i);
    expect(workflow).toMatch(/never reused/i);
    expect(workflow).toMatch(/`developer`.*`main`/s);
    expect(workflow).toContain("issue #60");
    expect(workflow).toMatch(/proposed.*not active/is);
  });

  it("keeps YAML development-only", async () => {
    const packageManifest = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(packageManifest.dependencies).toBeUndefined();
    expect(packageManifest.devDependencies.ajv).toBe("8.20.0");
    expect(packageManifest.devDependencies.yaml).toBe("2.9.0");
    expect(packageManifest.scripts["templates:validate"]).toBe(
      "node scripts/validate-github-templates.mjs",
    );
  });
});

describe("local draft discovery", () => {
  it("renders and removes one complete temporary draft per form", async () => {
    const draftRoot = await mkdtemp(join(tmpdir(), "kratos-issue-drafts-"));
    try {
      for (const filename of formFiles) {
        const form = await readForm(filename);
        const sections = (form.body as unknown[])
          .map((value, index) =>
            validateBodyElement(value, `${filename}.body[${String(index)}]`),
          )
          .filter((element) => element.type !== "markdown")
          .map((element) => {
            const attributes = object(element.attributes, filename);
            return `## ${String(attributes.label)}\n\nLocal draft value for ${String(element.id)}.`;
          });
        const draft = `# ${String(form.name)}\n\n${sections.join("\n\n")}\n`;
        const draftPath = join(draftRoot, filename.replace(/\.yml$/, ".md"));
        await writeFile(draftPath, draft, "utf8");
        const rendered = await readFile(draftPath, "utf8");
        for (const id of requiredFields[filename]) {
          expect(rendered, `${filename}: missing ${id}`).toContain(
            `Local draft value for ${id}.`,
          );
        }
      }
      expect((await readdir(draftRoot)).sort()).toEqual(
        formFiles.map((filename) => filename.replace(/\.yml$/, ".md")).sort(),
      );
    } finally {
      await rm(draftRoot, { recursive: true, force: true });
    }
  });
});
