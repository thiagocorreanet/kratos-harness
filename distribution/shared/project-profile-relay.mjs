const question = (key, prompt) => Object.freeze({ key, prompt });

/** Canonical profile interview shared by every packaged host. */
export const projectProfileQuestions = Object.freeze([
  question(
    "projectProfile.commands.test",
    "What exact test command should run from the project root?",
  ),
  question(
    "projectProfile.commands.lint",
    "What exact lint command should run from the project root?",
  ),
  question(
    "projectProfile.commands.build",
    "What exact build command should run from the project root?",
  ),
  question(
    "projectProfile.commands.run",
    "What exact application command should run from the project root?",
  ),
  question(
    "projectProfile.paths.source",
    "Which project-relative paths contain source code?",
  ),
  question(
    "projectProfile.paths.tests",
    "Which project-relative paths contain tests?",
  ),
  question(
    "projectProfile.paths.configuration",
    "Which project-relative paths contain configuration?",
  ),
  question(
    "projectProfile.conventions.directoryLayout",
    "What directory-layout convention should phase agents preserve?",
  ),
  question(
    "projectProfile.conventions.naming",
    "What naming convention should phase agents preserve?",
  ),
  question(
    "projectProfile.conventions.implementationLanguages",
    "Which implementation languages does this project use?",
  ),
]);

/** Shape an individual interview candidate or answer into a valid profile leaf. */
export function shapeProfileLeaf(leaf) {
  if (leaf === undefined || leaf === null || leaf === "") {
    return { status: "unresolved" };
  }
  if (typeof leaf === "object") {
    if (
      leaf.status === "resolved" ||
      leaf.status === "derived" ||
      leaf.status === "not-applicable" ||
      leaf.status === "unresolved"
    ) {
      return leaf;
    }
    if (leaf.confirmed === true && leaf.value !== undefined) {
      return { status: "resolved", value: leaf.value };
    }
    if (
      (leaf.confirmed === false || leaf.confirmed === undefined) &&
      leaf.value !== undefined &&
      leaf.evidence !== undefined
    ) {
      return { status: "derived", value: leaf.value, evidence: leaf.evidence };
    }
  }
  return leaf;
}

/** Shape flat host answers for the runtime without validating or inferring them. */
export function relayProjectProfileAnswers(answers) {
  return {
    commands: {
      test: shapeProfileLeaf(answers?.["projectProfile.commands.test"]),
      lint: shapeProfileLeaf(answers?.["projectProfile.commands.lint"]),
      build: shapeProfileLeaf(answers?.["projectProfile.commands.build"]),
      run: shapeProfileLeaf(answers?.["projectProfile.commands.run"]),
    },
    paths: {
      source: shapeProfileLeaf(answers?.["projectProfile.paths.source"]),
      tests: shapeProfileLeaf(answers?.["projectProfile.paths.tests"]),
      configuration: shapeProfileLeaf(
        answers?.["projectProfile.paths.configuration"],
      ),
    },
    conventions: {
      directoryLayout: shapeProfileLeaf(
        answers?.["projectProfile.conventions.directoryLayout"],
      ),
      naming: shapeProfileLeaf(answers?.["projectProfile.conventions.naming"]),
      implementationLanguages: shapeProfileLeaf(
        answers?.["projectProfile.conventions.implementationLanguages"],
      ),
    },
  };
}
