import { describe, expect, it } from "vitest";
import {
  projectProfileQuestions,
  relayProjectProfileAnswers,
  shapeProfileLeaf,
} from "../distribution/shared/project-profile-relay.mjs";

describe("project-profile-relay", () => {
  it("exports the 10 canonical interview questions in stable order", () => {
    expect(projectProfileQuestions).toHaveLength(10);
    expect(projectProfileQuestions.map((q) => q.key)).toEqual([
      "projectProfile.commands.test",
      "projectProfile.commands.lint",
      "projectProfile.commands.build",
      "projectProfile.commands.run",
      "projectProfile.paths.source",
      "projectProfile.paths.tests",
      "projectProfile.paths.configuration",
      "projectProfile.conventions.directoryLayout",
      "projectProfile.conventions.naming",
      "projectProfile.conventions.implementationLanguages",
    ]);
  });

  describe("shapeProfileLeaf", () => {
    it("shapes confirmed candidate value as resolved", () => {
      expect(
        shapeProfileLeaf({
          confirmed: true,
          value: "npm test",
          evidence: "package.json#scripts.test",
        }),
      ).toEqual({
        status: "resolved",
        value: "npm test",
      });
    });

    it("shapes unconfirmed candidate with evidence as derived", () => {
      expect(
        shapeProfileLeaf({
          value: "npm test",
          evidence: "package.json#scripts.test",
        }),
      ).toEqual({
        status: "derived",
        value: "npm test",
        evidence: "package.json#scripts.test",
      });

      expect(
        shapeProfileLeaf({
          confirmed: false,
          value: "npm run build",
          evidence: "package.json#scripts.build",
        }),
      ).toEqual({
        status: "derived",
        value: "npm run build",
        evidence: "package.json#scripts.build",
      });
    });

    it("preserves already structured resolved leaf", () => {
      expect(
        shapeProfileLeaf({
          status: "resolved",
          value: "pytest",
        }),
      ).toEqual({
        status: "resolved",
        value: "pytest",
      });
    });

    it("preserves already structured derived leaf", () => {
      expect(
        shapeProfileLeaf({
          status: "derived",
          value: "cargo test",
          evidence: "Cargo.toml",
        }),
      ).toEqual({
        status: "derived",
        value: "cargo test",
        evidence: "Cargo.toml",
      });
    });

    it("preserves not-applicable leaf", () => {
      expect(
        shapeProfileLeaf({
          status: "not-applicable",
          reason: "No build step required.",
        }),
      ).toEqual({
        status: "not-applicable",
        reason: "No build step required.",
      });
    });

    it("shapes blank, undefined, null, or empty leaf as unresolved", () => {
      expect(shapeProfileLeaf(undefined)).toEqual({ status: "unresolved" });
      expect(shapeProfileLeaf(null)).toEqual({ status: "unresolved" });
      expect(shapeProfileLeaf("")).toEqual({ status: "unresolved" });
      expect(shapeProfileLeaf({ status: "unresolved" })).toEqual({
        status: "unresolved",
      });
    });
  });

  describe("relayProjectProfileAnswers", () => {
    it("shapes flat answers with mixed confirmed, derived, not-applicable, and blank leaves", () => {
      const answers = {
        "projectProfile.commands.test": {
          confirmed: true,
          value: "npm test",
        },
        "projectProfile.commands.lint": {
          value: "npm run lint",
          evidence: "package.json#scripts.lint",
        },
        "projectProfile.commands.build": {
          status: "not-applicable",
          reason: "Directly interpreted.",
        },
        // run is omitted/blank -> unresolved
        "projectProfile.paths.source": {
          status: "derived",
          value: ["src"],
          evidence: "directory:src",
        },
        "projectProfile.paths.tests": {
          status: "resolved",
          value: ["tests"],
        },
        // configuration is null -> unresolved
        "projectProfile.paths.configuration": null,
        "projectProfile.conventions.directoryLayout": {
          status: "resolved",
          value: "Monorepo layout.",
        },
        "projectProfile.conventions.naming": "",
        "projectProfile.conventions.implementationLanguages": {
          confirmed: true,
          value: ["TypeScript"],
        },
      };

      const result = relayProjectProfileAnswers(answers);

      expect(result).toEqual({
        commands: {
          test: { status: "resolved", value: "npm test" },
          lint: {
            status: "derived",
            value: "npm run lint",
            evidence: "package.json#scripts.lint",
          },
          build: {
            status: "not-applicable",
            reason: "Directly interpreted.",
          },
          run: { status: "unresolved" },
        },
        paths: {
          source: {
            status: "derived",
            value: ["src"],
            evidence: "directory:src",
          },
          tests: { status: "resolved", value: ["tests"] },
          configuration: { status: "unresolved" },
        },
        conventions: {
          directoryLayout: {
            status: "resolved",
            value: "Monorepo layout.",
          },
          naming: { status: "unresolved" },
          implementationLanguages: {
            status: "resolved",
            value: ["TypeScript"],
          },
        },
      });
    });
  });
});
