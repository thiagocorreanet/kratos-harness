import { planOf } from "@mestre-yoda/runtime/domain/effects";
import { applyPlan, createRuntime } from "@mestre-yoda/runtime/composition";
import {
  fixedClock,
  memoryFileSystem,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

describe("composition root", () => {
  it("uses Node implementations when nothing is overridden", () => {
    const ports = createRuntime();

    expect(ports.environment.workingDirectory()).toBe(process.cwd());
    expect(Number.isNaN(ports.clock.now().getTime())).toBe(false);
  });

  it("replaces exactly the overridden ports and nothing else", () => {
    const clock = fixedClock("2026-08-07T00:00:00.000Z");
    const ports = createRuntime({ clock });

    expect(ports.clock).toBe(clock);
    // An override must not quietly swap its neighbours for fakes.
    expect(ports.environment.workingDirectory()).toBe(process.cwd());
  });

  it("exposes every port named by the contract", () => {
    expect(Object.keys(createRuntime()).sort()).toEqual([
      "clock",
      "environment",
      "fileSystem",
      "git",
      "ids",
      "locks",
      "output",
    ]);
  });
});

describe("effect plan application", () => {
  function fakeRuntime() {
    const output = recordingOutput();
    const fileSystem = memoryFileSystem();
    return {
      output,
      fileSystem,
      ports: createRuntime({
        clock: fixedClock("2026-08-07T00:00:00.000Z"),
        ids: sequentialIds(),
        fileSystem,
        output,
      }),
    };
  }

  it("applies effects in declared order", async () => {
    const { fileSystem, ports } = fakeRuntime();

    await applyPlan(
      planOf(
        { kind: "write_file", path: "a.txt", content: "first" },
        { kind: "write_file", path: "a.txt", content: "second" },
      ),
      ports,
    );

    expect(await fileSystem.read("a.txt")).toBe("second");
  });

  it("performs every effect kind", async () => {
    const { fileSystem, output, ports } = fakeRuntime();

    await applyPlan(
      planOf(
        { kind: "create_directory", path: ".brain" },
        { kind: "write_file", path: ".brain/state.json", content: "{}" },
        { kind: "write_file", path: ".brain/scratch.json", content: "{}" },
        { kind: "delete_file", path: ".brain/scratch.json" },
        { kind: "append_event", event: "started" },
        { kind: "emit", channel: "structured", text: "{}\n" },
        { kind: "emit", channel: "human", text: "ok\n" },
      ),
      ports,
    );

    expect(await fileSystem.read(".brain/state.json")).toBe("{}");
    expect(await fileSystem.stat(".brain/scratch.json")).toBeNull();
    expect(await fileSystem.read(".brain/events.jsonl")).toBe("started\n");
    expect(output.structured_).toEqual(["{}\n"]);
    expect(output.human_).toEqual(["ok\n"]);
  });

  it("produces byte-identical output across two fixed runs", async () => {
    const run = async (): Promise<string> => {
      const { output, ports } = fakeRuntime();
      await applyPlan(
        planOf(
          { kind: "create_directory", path: ".brain" },
          { kind: "append_event", event: ports.ids.next() },
          {
            kind: "emit",
            channel: "structured",
            text: ports.clock.now().toISOString(),
          },
          { kind: "emit", channel: "structured", text: ports.ids.next() },
        ),
        ports,
      );
      return output.structured_.join("|");
    };

    // Determinism is the whole reason the clock and ids are ports at all.
    expect(await run()).toBe(await run());
  });

  it("stops at the first failing effect without applying later ones", async () => {
    const { fileSystem, ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf(
          { kind: "write_file", path: "before.txt", content: "written" },
          { kind: "write_file", path: "../escape.txt", content: "x" },
          { kind: "write_file", path: "after.txt", content: "x" },
        ),
        ports,
      ),
    ).rejects.toThrow("escapes the project");

    expect(await fileSystem.read("before.txt")).toBe("written");
    // A refused effect must not be stepped over; RUN-05 owns making the
    // already-applied prefix roll back.
    expect(await fileSystem.stat("after.txt")).toBeNull();
  });
});
