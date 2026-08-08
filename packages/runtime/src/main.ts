import { runCli } from "./cli.js";
import { createSchemaRegistry } from "./composition/schema.js";

// Compile the embedded catalog when the packaged process starts. This makes a
// broken schema or unresolved reference a package-integrity failure even while
// the public CLI exposes only orientation commands.
createSchemaRegistry();
process.exitCode = await runCli(process.argv.slice(2));
