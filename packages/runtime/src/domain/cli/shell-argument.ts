const SAFE_SHELL_ARGUMENT = /^[A-Za-z0-9_./:@=-]+$/u;

/** Render one literal POSIX shell argument without evaluating its contents. */
export function shellArgument(value: string): string {
  return SAFE_SHELL_ARGUMENT.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}
