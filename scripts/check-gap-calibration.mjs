import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CalibrationError,
  renderCalibration,
  scoreCalibration,
} from "./lib/gap-calibration.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8"));
}

const [corpus, observed, schema] = await Promise.all([
  readJson("quality/gap-detection/corpus.v1.json"),
  readJson("quality/gap-detection/observed.v1.json"),
  readJson("schemas/host/gap-proposal.v1.schema.json"),
]);

// Every recorded proposal is checked against the same published contract the
// runtime validates, so a corpus cannot drift into a shape no command accepts.
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(schema);
for (const document of observed.documents) {
  if (document.proposal !== null && !validate(document.proposal)) {
    console.error(
      `gap calibration failed: ${document.id} proposal does not satisfy host.gap-proposal@1.0.0`,
    );
    process.exitCode = 1;
  }
}

try {
  const report = scoreCalibration(corpus, observed);
  process.stdout.write(`${renderCalibration(report)}\n`);
  const thresholds = corpus.thresholds;
  if (
    report.recall < thresholds.minimumRecall ||
    report.falseGaps > thresholds.maximumFalseGaps
  ) {
    console.error(
      `gap calibration failed: recall ${report.recall.toFixed(2)} or ${String(report.falseGaps)} false gaps is outside the recorded thresholds`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof CalibrationError)) throw error;
  console.error(`gap calibration failed: ${error.message}`);
  process.exitCode = 1;
}
