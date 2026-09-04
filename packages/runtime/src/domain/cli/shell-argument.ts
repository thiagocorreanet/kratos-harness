import { validatePublicText } from "../result/index.js";

const SAFE_SHELL_ARGUMENT = /^[A-Za-z0-9_./:@=-]+$/u;

/** Render one literal POSIX shell argument without evaluating its contents. */
export function shellArgument(value: string): string {
  return SAFE_SHELL_ARGUMENT.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Render exact argv for a POSIX shell without evaluating argument contents. */
export function renderPosixCommand(argv: readonly string[]): string {
  return argv.map(shellArgument).join(" ");
}

/** Render exact argv for PowerShell using literal single-quoted arguments. */
export function renderPowerShellCommand(argv: readonly string[]): string {
  return `& ${argv.map((value) => `'${value.replaceAll("'", "''")}'`).join(" ")}`;
}

/**
 * Canonical shell-neutral authority followed by copyable shell displays.
 *
 * The exact argv is rendered whenever it can be published. It often cannot:
 * the result contract refuses to publish an absolute path, and `--root` holds
 * one whenever the operator passed one, so echoing the argv verbatim made the
 * whole preview unpublishable -- which is how the human preview failed as an
 * internal error while `--json`, which never renders these lines, succeeded.
 *
 * A value that cannot be published is named instead of printed. The operator
 * still sees which flags to repeat, and the one value withheld is the one they
 * typed themselves and therefore already have.
 */
export function renderApplyInstructions(argv: readonly string[]): string[] {
  const exact = instructionLines(argv);
  return exact.every(isPublishable)
    ? exact
    : instructionLines(withheldArgv(argv));
}

function instructionLines(argv: readonly string[]): string[] {
  const posix = renderPosixCommand(argv);
  return [
    `Apply argv: ${JSON.stringify(argv)}`,
    `Apply command (POSIX): ${posix}`,
    `Apply command (PowerShell): ${renderPowerShellCommand(argv)}`,
    // Compatibility for existing parsers; Apply argv is authoritative.
    `Apply command: ${posix}`,
  ];
}

/**
 * The same argv with each unpublishable value replaced by what it stands for.
 *
 * The flag ahead of the value names it, so the placeholder can say which of
 * the operator's own arguments to put back rather than leaving a blank.
 */
function withheldArgv(argv: readonly string[]): readonly string[] {
  return argv.map((value, index) => {
    if (isPublishable(value)) return value;
    const flag = argv[index - 1];
    return flag?.startsWith("--") === true
      ? `<the ${flag} value you passed>`
      : "<value withheld>";
  });
}

function isPublishable(text: string): boolean {
  try {
    validatePublicText(text);
    return true;
  } catch {
    return false;
  }
}
