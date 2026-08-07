import { runCli } from "./cli.js";

process.exitCode = runCli(
  process.argv.slice(2),
  (text) => {
    process.stdout.write(text);
  },
  (text) => {
    process.stderr.write(text);
  },
);
