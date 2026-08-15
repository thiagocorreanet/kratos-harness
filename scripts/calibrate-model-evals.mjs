import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function verdict(rubric, scores) {
  let weighted = 0;
  let weight = 0;
  for (const dimension of rubric.dimensions) {
    const score = scores[dimension.id];
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`invalid score for ${dimension.id}`);
    }
    if (
      rubric.hardFailDimensions.includes(dimension.id) &&
      score < dimension.minimum
    ) {
      return "fail";
    }
    weighted += score * dimension.weight;
    weight += dimension.weight;
  }
  return weighted / weight >= rubric.passingWeightedAverage ? "pass" : "fail";
}

const [rubric, calibration] = await Promise.all([
  readJson("quality/evaluations/rubric.v1.json"),
  readJson("quality/evaluations/calibration.v1.json"),
]);

const failures = calibration.samples.filter(
  (sample) => verdict(rubric, sample.scores) !== sample.expected,
);
if (failures.length > 0) {
  console.error(
    `model evaluation calibration failed: ${failures.map(({ id }) => id).join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `model evaluation calibration passed: ${calibration.samples.length} samples`,
  );
}
