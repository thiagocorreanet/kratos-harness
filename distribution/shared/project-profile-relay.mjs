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

/** Shape flat host answers for the runtime without validating or inferring them. */
export function relayProjectProfileAnswers(answers) {
  return {
    commands: {
      test: answers["projectProfile.commands.test"],
      lint: answers["projectProfile.commands.lint"],
      build: answers["projectProfile.commands.build"],
      run: answers["projectProfile.commands.run"],
    },
    paths: {
      source: answers["projectProfile.paths.source"],
      tests: answers["projectProfile.paths.tests"],
      configuration: answers["projectProfile.paths.configuration"],
    },
    conventions: {
      directoryLayout: answers["projectProfile.conventions.directoryLayout"],
      naming: answers["projectProfile.conventions.naming"],
      implementationLanguages:
        answers["projectProfile.conventions.implementationLanguages"],
    },
  };
}
