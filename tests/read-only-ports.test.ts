import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readOnlyPorts,
  ReadOnlyViolation,
} from "@mestre-yoda/runtime/composition";
import {
  nodeClock,
  nodeDurableFileSystem,
  nodeEnvironment,
  nodeFileSystem,
  nodeIds,
  nodeOutput,
  sha256Digests,
} from "@mestre-yoda/runtime/infra/node";
import type { RuntimePorts } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

async function temporaryProject<T>(
  body: (ports: RuntimePorts, root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "yoda-read-only-"));
  try {
    await mkdir(join(root, ".brain"), { recursive: true });
    await writeFile(join(root, ".brain/state.json"), "state", "utf8");
    const ports: RuntimePorts = {
      clock: nodeClock(),
      ids: nodeIds(),
      digests: sha256Digests(),
      durableFileSystem: nodeDurableFileSystem(root),
      fileSystem: nodeFileSystem(root),
      git: { observe: () => Promise.reject(new Error("unused")) },
      locks: {
        inspect: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        renew: () => Promise.reject(new Error("unused")),
        release: () => Promise.reject(new Error("unused")),
        takeover: () => Promise.reject(new Error("unused")),
      },
      environment: nodeEnvironment(),
      output: nodeOutput(),
    };
    return await body(ports, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

/** Call a port method by name with placeholder arguments. */
function call(
  target: Record<string, unknown>,
  method: string,
): Promise<unknown> {
  const value = target[method];
  if (typeof value !== "function") {
    throw new Error(`Port has no method ${method}`);
  }
  return (value as (...args: unknown[]) => Promise<unknown>).call(
    target,
    ".brain/candidate",
    ".brain/other",
  );
}

describe("read-only runtime ports", () => {
  it.each([
    "createDirectory",
    "createDirectoryExclusive",
    "writeSynced",
    "replaceFile",
    "linkFileExclusive",
    "renameDirectoryExclusive",
    "removeFile",
    "removeEmptyDirectory",
    "syncDirectory",
  ])("refuses the durable primitive %s", async (primitive) => {
    await temporaryProject(async (ports) => {
      const guarded = readOnlyPorts(ports);

      // The refusal names the primitive, so a preview that writes reports
      // which write it attempted rather than only that it attempted one.
      await expect(
        call(
          guarded.durableFileSystem as unknown as Record<string, unknown>,
          primitive,
        ),
      ).rejects.toMatchObject({ primitive });
    });
  });

  it.each(["write", "remove", "makeDirectory"])(
    "refuses the project filesystem primitive %s",
    async (primitive) => {
      await temporaryProject(async (ports) => {
        await expect(
          call(
            readOnlyPorts(ports).fileSystem as unknown as Record<
              string,
              unknown
            >,
            primitive,
          ),
        ).rejects.toBeInstanceOf(ReadOnlyViolation);
      });
    },
  );

  it.each(["acquire", "renew", "release", "takeover"])(
    "refuses the lease operation %s",
    async (operation) => {
      await temporaryProject(async (ports) => {
        await expect(
          call(
            readOnlyPorts(ports).locks as unknown as Record<string, unknown>,
            operation,
          ),
        ).rejects.toBeInstanceOf(ReadOnlyViolation);
      });
    },
  );

  it("refuses to consume an identifier", async () => {
    await temporaryProject((ports) => {
      // Taking one for a preview advances a sequence the real apply then
      // skips, which makes the preview and the commit disagree on identity.
      expect(() => readOnlyPorts(ports).ids.next()).toThrow(ReadOnlyViolation);
      return Promise.resolve();
    });
  });

  it("passes durable reads through unchanged", async () => {
    await temporaryProject(async (ports, root) => {
      const guarded = readOnlyPorts(ports);

      expect(await guarded.durableFileSystem.inspect(".brain")).toEqual(
        await ports.durableFileSystem.inspect(".brain"),
      );
      expect(await guarded.durableFileSystem.list(".brain")).toEqual([
        "state.json",
      ]);
      expect(
        await guarded.durableFileSystem.readText(".brain/state.json"),
      ).toBe("state");
      expect(await guarded.fileSystem.read(".brain/state.json")).toBe("state");
      expect(await guarded.fileSystem.stat(".brain/state.json")).toEqual(
        await ports.fileSystem.stat(".brain/state.json"),
      );
      expect(await guarded.fileSystem.list(".brain")).toEqual(["state.json"]);
      expect(root).toContain("yoda-read-only-");
    });
  });

  it("keeps the boundaries a preview may legitimately use", async () => {
    await temporaryProject((ports) => {
      const guarded = readOnlyPorts(ports);

      expect(guarded.clock.now()).toBeInstanceOf(Date);
      expect(guarded.digests.sha256("value")).toBe(
        ports.digests.sha256("value"),
      );
      expect(guarded.environment.workingDirectory()).toBe(
        ports.environment.workingDirectory(),
      );
      expect(guarded.git).toBe(ports.git);
      expect(guarded.output).toBe(ports.output);
      return Promise.resolve();
    });
  });
});
