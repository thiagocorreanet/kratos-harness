import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensions = new Set([".md", ".mjs", ".ts", ".yml", ".yaml"]);
const excludedRoots = ["compatibility/", "dist/", "node_modules/"];
const excludedFiles = new Set([
  "KRATOS_BACKLOG.md",
  // The detector necessarily contains the words it rejects.
  "scripts/check-english.mjs",
]);
// Whole words that unambiguously indicate Portuguese prose. Accented fixture
// data remains legal because Unicode path/content handling is a runtime
// requirement, not documentation language.
const PortugueseProse =
  /\b(?:agora|arquitetura|atual|código|comando|deve|evidência|fechada|implementação|migração|objetivo|porque|projeto|requisito|usuário)\b/giu;

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(root, path).split("\\").join("/");
    if (entry.isDirectory()) {
      if (!excludedRoots.some((prefix) => name.startsWith(prefix))) {
        found.push(...(await files(path)));
      }
    } else if (extensions.has(extname(entry.name)) && !excludedFiles.has(name)) {
      found.push(path);
    }
  }
  return found;
}

const failures = [];
for (const path of await files(root)) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(PortugueseProse)) {
    const line = source.slice(0, match.index).split("\n").length;
    failures.push(`${relative(root, path)}:${String(line)}:${match[0]}`);
  }
}
if (failures.length !== 0) {
  throw new Error(`English-only check failed:\n${failures.join("\n")}`);
}
process.stdout.write("English-only source check passed.\n");
