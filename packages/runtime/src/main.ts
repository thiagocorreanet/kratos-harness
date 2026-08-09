// Evaluating schema composition compiles its one production registry. Project
// discovery imports and reuses the same module-owned instance.
import "./composition/schema.js";

import { runCli } from "./cli.js";

process.exitCode = await runCli(process.argv.slice(2));
