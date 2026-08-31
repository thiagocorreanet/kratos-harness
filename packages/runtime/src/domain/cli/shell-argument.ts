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

/** Canonical shell-neutral authority followed by copyable shell displays. */
export function renderApplyInstructions(argv: readonly string[]): string[] {
  const posix = renderPosixCommand(argv);
  return [
    `Apply argv: ${JSON.stringify(argv)}`,
    `Apply command (POSIX): ${posix}`,
    `Apply command (PowerShell): ${renderPowerShellCommand(argv)}`,
    // Compatibility for existing parsers; Apply argv is authoritative.
    `Apply command: ${posix}`,
  ];
}
