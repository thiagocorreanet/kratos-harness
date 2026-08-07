import type { Workspace } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

import type { Disposable } from "./port-contracts.js";

export interface WorkspaceContractFixture extends Disposable<Workspace> {
  readonly start: string;
  readonly project: string;
  readonly principal: string;
}

export function describeWorkspaceContract(
  label: string,
  factory: () => Promise<WorkspaceContractFixture>,
): void {
  describe(`Workspace contract: ${label}`, () => {
    async function withWorkspace(
      body: (fixture: WorkspaceContractFixture) => Promise<void>,
    ): Promise<void> {
      const fixture = await factory();
      try {
        await body(fixture);
      } finally {
        await fixture.dispose();
      }
    }

    it("canonicalizes directories idempotently", async () => {
      await withWorkspace(async ({ port, project }) => {
        const first = await port.canonicalize(project, project);
        expect(first).toBe(project);
        expect(await port.canonicalize(first ?? "", project)).toBe(first);
      });
    });

    it("returns nearest-first ancestors ending at the filesystem root", async () => {
      await withWorkspace(async ({ port, start, project }) => {
        const ancestors = await port.ancestors(start);
        expect(ancestors[0]?.path).toBe(start);
        expect(ancestors.some(({ path }) => path === project)).toBe(true);
        expect(ancestors.at(-1)?.path).toBe("/");
      });
    });

    it("observes project-local marker and configuration bytes", async () => {
      await withWorkspace(async ({ port, project }) => {
        const candidate = await port.inspect(project);
        expect(candidate).toMatchObject({
          path: project,
          brain: "directory",
          configuration: {
            kind: "file",
            text: '{"stateContract":"1.0.0"}\n',
          },
        });
      });
    });

    it("locates a linked worktree and its principal root", async () => {
      await withWorkspace(async ({ port, start, project, principal }) => {
        expect(await port.locateWorktree(start)).toEqual({
          kind: project === principal ? "principal" : "linked",
          topLevel: project,
          principal,
        });
      });
    });

    it.each(["", "bad\u0000path", "bad\\path", "C:\\private"])(
      "refuses an unsafe canonicalization input %j",
      async (path) => {
        await withWorkspace(async ({ port, project }) => {
          expect(await port.canonicalize(path, project)).toBeNull();
        });
      },
    );

    it("exposes no mutation operation", async () => {
      await withWorkspace(({ port }) => {
        expect(Object.keys(port).sort()).toEqual([
          "ancestors",
          "canonicalize",
          "inspect",
          "locateWorktree",
        ]);
        return Promise.resolve();
      });
    });
  });
}
