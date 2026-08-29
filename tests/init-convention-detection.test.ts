import { describe, expect, it } from "vitest";
import { detectLanguageConventions } from "@kratos/runtime/domain/init";

describe("convention detection", () => {
  it("detects dominant conventions from existing repository files when preserveConventions is true", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["README.pt-BR.md", "src", "package.json"],
      sampleContent: [
        {
          path: "README.pt-BR.md",
          content: "Brazilian Portuguese documentation sample",
        },
      ],
    });
    expect(convention.documentation).toBe("pt-BR");
  });

  it("detects pt-BR documentation from root entries without sample content", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["README.pt-BR.md", "src", "package.json"],
    });
    expect(convention.documentation).toBe("pt-BR");
  });

  it("detects pt-BR documentation from LEIAME.md", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["LEIAME.md", "src", "package.json"],
    });
    expect(convention.documentation).toBe("pt-BR");
  });

  it("detects en documentation from README.en.md or standard english samples", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["README.en.md", "src", "package.json"],
      sampleContent: [
        { path: "README.en.md", content: "English documentation sample" },
      ],
    });
    expect(convention.documentation).toBe("en");
  });

  it("returns empty convention when root entries are unrecognized", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["random_file.bin"],
    });
    expect(convention).toEqual({});
  });
});
