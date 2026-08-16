import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const budgets = JSON.parse(
  await readFile(join(root, "quality/performance-budgets.json"), "utf8"),
);
const targets = [
  ["runtimeSourceBytes", "packages/runtime/src"],
  ["contractSchemaBytes", "schemas"],
];

async function bytes(directory) {
  const { readdir, stat } = await import("node:fs/promises");
  let total = 0;
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory()
      ? await bytes(path)
      : (await stat(join(root, path))).size;
  }
  return total;
}

for (const [name, directory] of targets) {
  const observed = await bytes(directory);
  const maximum = budgets[name];
  if (!Number.isSafeInteger(maximum) || observed > maximum) {
    throw new Error(
      `${name} exceeded: ${String(observed)} > ${String(maximum)}`,
    );
  }
  process.stdout.write(`${name}: ${String(observed)} / ${String(maximum)}\n`);
}
