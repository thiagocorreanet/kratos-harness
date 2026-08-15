// Rewrites the reported interpreter version before the entry point loads, so
// the shipped preflight can be exercised against an old Node without needing
// one installed.
Object.defineProperty(process.versions, "node", {
  value: process.env.KRATOS_TEST_NODE_VERSION ?? "18.20.0",
  configurable: true,
});
