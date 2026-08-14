import { Readable } from "node:stream";

import { createRuntime } from "@mestre-yoda/runtime/composition";
import { pipedInput } from "@mestre-yoda/runtime/infra/fake";
import { nodeStandardInput } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

function stream(
  chunks: readonly string[],
  isTTY = false,
): Readable & { isTTY?: boolean } {
  return Object.assign(Readable.from(chunks), { isTTY });
}

describe("the standard input port", () => {
  it("reads a piped document", async () => {
    const input = nodeStandardInput(stream(['{ "hosts": ', '["claude"] }']));

    expect(await input.read()).toBe('{ "hosts": ["claude"] }');
  });

  it("reports nothing piped rather than an empty document", async () => {
    // A caller using `--answers` is the ordinary case, not a failure, and a
    // redirect from an empty source is that same caller. A document that is
    // present but blank fails validation, which is a different answer with a
    // different reason.
    expect(await nodeStandardInput(stream([])).read()).toBeNull();
  });

  it("does not read an interactive terminal", async () => {
    // Reading a TTY would hang the process waiting for a person who was never
    // asked for anything.
    const terminal = stream(['{ "never": "read" }'], true);

    expect(await nodeStandardInput(terminal).read()).toBeNull();
  });

  it("reads once and reports nothing on a second read", async () => {
    const input = nodeStandardInput(stream(["one shot"]));

    expect(await input.read()).toBe("one shot");
    expect(await input.read()).toBeNull();
  });

  it("takes the text as data in the fake", async () => {
    expect(await pipedInput('{ "hosts": ["codex"] }').read()).toBe(
      '{ "hosts": ["codex"] }',
    );
    expect(await pipedInput(null).read()).toBeNull();
  });

  it("is composed with every other port", async () => {
    const ports = createRuntime({ standardInput: pipedInput("composed") });

    expect(await ports.standardInput.read()).toBe("composed");
  });
});
