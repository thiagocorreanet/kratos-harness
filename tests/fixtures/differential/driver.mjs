import { mkdir, writeFile } from "node:fs/promises";

const mode = process.argv[2] ?? "equal";

if (mode === "equal") {
  process.stdout.write("equal\n");
} else if (mode === "normalize") {
  process.stdout.write(`${process.cwd()}\r\n`);
} else if (mode === "unexpected-file") {
  await writeFile("unexpected.txt", "unexpected\n", "utf8");
} else if (mode === "timeout") {
  await writeFile("partial.txt", "before timeout\n", "utf8");
  globalThis.setInterval(() => {}, 1_000);
} else if (mode === "output-limit") {
  process.stdout.write("abcdefghijklmnopqrstuvwxyz");
  globalThis.setInterval(() => {}, 1_000);
} else if (mode === "crash") {
  process.kill(process.pid, "SIGABRT");
} else if (mode === "partial-mutation") {
  await writeFile("partial.txt", "before failure\n", "utf8");
  process.exitCode = 1;
} else if (mode === "ignore-stdin") {
  process.stdout.write("ignored\n");
} else if (mode === "git-create") {
  await mkdir(".git", { recursive: true });
  await writeFile(".git/HEAD", "ref: refs/heads/main\n", "utf8");
} else if (mode === "state") {
  await mkdir(".brain", { recursive: true });
  await writeFile(
    ".brain/state.json",
    `${JSON.stringify({
      home: process.env.HOME,
      temporary: process.env.TMPDIR,
      leakedSecret: process.env.KRATOS_TEST_SECRET ?? null,
    })}\n`,
    "utf8",
  );
} else {
  process.stderr.write("unknown synthetic mode\n");
  process.exitCode = 2;
}
