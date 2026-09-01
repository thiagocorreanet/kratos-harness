import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectShippedPromptSurfaces,
  evaluatePromptCeiling,
} from "@kratos/runtime/domain/prompt-ceilings";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const distributionDir = join(repositoryRoot, "distribution");

console.log("=== Checking Prompt Size Ceilings ===");

const fileReader = (filePath) => {
  const fullPath = isAbsolute(filePath)
    ? filePath
    : join(repositoryRoot, filePath);
  try {
    return readFileSync(fullPath, "utf8");
  } catch {
    return undefined;
  }
};

const surfaces = collectShippedPromptSurfaces({
  repositoryRoot,
  distributionDir,
  fileReader,
});
let hasFailures = false;

console.log(
  `\nDiscovered ${surfaces.length} shipped prompt surfaces across all categories.\n`,
);
console.log(
  `${"Category".padEnd(28)} | ${"Measured".padStart(8)} / ${"Limit".padEnd(8)} | ${"Status".padEnd(8)} | Target`,
);
console.log("-".repeat(85));

for (const surface of surfaces) {
  const rendered = surface.getRenderedText();
  const evaluation = evaluatePromptCeiling(
    surface.category,
    rendered,
    surface.path,
  );

  const status = evaluation.passed ? "PASS" : "FAIL";
  const measured = `${evaluation.measuredChars}`.padStart(8);
  const limit = `${evaluation.ceilingChars}`.padEnd(8);
  const cat = surface.category.padEnd(28);

  console.log(
    `${cat} | ${measured} / ${limit} | ${status.padEnd(8)} | ${surface.path}`,
  );

  if (!evaluation.passed) {
    hasFailures = true;
    console.error(`  ERROR: ${evaluation.error}`);
  }
}

console.log("-".repeat(85));

if (hasFailures) {
  console.error("\nFAIL: One or more prompt size ceilings were exceeded.");
  console.error(
    "Policy: Factor detailed guidance into reference documents and link to them instead of raising the ceiling.\n",
  );
  process.exit(1);
} else {
  console.log("\nSUCCESS: All prompt size ceilings passed.\n");
}
