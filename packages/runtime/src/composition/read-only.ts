import type { LeaseResource } from "../domain/locks/index.js";
import type {
  DurableFileSystem,
  FileSystem,
  Ids,
  Locks,
  RuntimePorts,
} from "../ports/index.js";

/**
 * A boundary that changes durable state was called where nothing may change.
 *
 * The primitive is carried on the error because a preview that writes needs to
 * report which write it attempted. "Something wrote" sends a reader through
 * the whole decision path; "writeSynced wrote" sends them to one line.
 */
export class ReadOnlyViolation extends Error {
  public constructor(public readonly primitive: string) {
    super("Read-only runtime boundary was asked to change state");
    this.name = "ReadOnlyViolation";
  }
}

function refuse(primitive: string): never {
  throw new ReadOnlyViolation(primitive);
}

/**
 * Refuse the way an asynchronous boundary is expected to fail.
 *
 * These primitives are declared to return a promise, and a caller is entitled
 * to attach `.catch()` without awaiting first. Throwing synchronously from a
 * function typed as asynchronous would escape that handler.
 */
function refuseAsync(primitive: string): Promise<never> {
  return Promise.reject(new ReadOnlyViolation(primitive));
}

function readOnlyDurableFileSystem(
  inner: DurableFileSystem,
): DurableFileSystem {
  return Object.freeze({
    inspect: (path: string) => inner.inspect(path),
    list: (path: string) => inner.list(path),
    readText: (path: string) => inner.readText(path),
    createDirectory: () => refuseAsync("createDirectory"),
    createDirectoryExclusive: () => refuseAsync("createDirectoryExclusive"),
    writeSynced: () => refuseAsync("writeSynced"),
    replaceFile: () => refuseAsync("replaceFile"),
    linkFileExclusive: () => refuseAsync("linkFileExclusive"),
    renameDirectoryExclusive: () => refuseAsync("renameDirectoryExclusive"),
    removeFile: () => refuseAsync("removeFile"),
    removeEmptyDirectory: () => refuseAsync("removeEmptyDirectory"),
    // Syncing a directory changes no content, but nothing a preview computes
    // is ever waiting to be made durable, so a call here means a write it does
    // not know about already happened.
    syncDirectory: () => refuseAsync("syncDirectory"),
  });
}

function readOnlyFileSystem(inner: FileSystem): FileSystem {
  return Object.freeze({
    read: (path: string) => inner.read(path),
    list: (path: string) => inner.list(path),
    stat: (path: string) => inner.stat(path),
    write: () => refuseAsync("write"),
    remove: () => refuseAsync("remove"),
    makeDirectory: () => refuseAsync("makeDirectory"),
  });
}

function readOnlyLocks(inner: Locks): Locks {
  return Object.freeze({
    inspect: (resource: LeaseResource) => inner.inspect(resource),
    acquire: () => refuseAsync("acquire"),
    renew: () => refuseAsync("renew"),
    release: () => refuseAsync("release"),
    takeover: () => refuseAsync("takeover"),
  });
}

function readOnlyIds(): Ids {
  // Consuming an identifier for a preview advances a sequence the real apply
  // then skips, so the preview would describe an operation the commit never
  // produces under that name.
  return Object.freeze({ next: () => refuse("next") });
}

/**
 * The same ports with every state-changing boundary replaced by a refusal.
 *
 * The surface is enumerated rather than proxied. A proxy refusing whatever is
 * missing from an allow list would silently start refusing a read primitive
 * added later; an explicit record stops compiling instead, which is the
 * failure a person can act on.
 */
export function readOnlyPorts(ports: RuntimePorts): RuntimePorts {
  return Object.freeze({
    clock: ports.clock,
    ids: readOnlyIds(),
    digests: ports.digests,
    durableFileSystem: readOnlyDurableFileSystem(ports.durableFileSystem),
    fileSystem: readOnlyFileSystem(ports.fileSystem),
    git: ports.git,
    locks: readOnlyLocks(ports.locks),
    modelRouting: ports.modelRouting,
    environment: ports.environment,
    output: ports.output,
    // Reading a piped document changes nothing, and a preview that could not
    // read its own input would describe a decision made without it.
    standardInput: ports.standardInput,
    targetInspector: ports.targetInspector,
    // Every workspace method is an observation already.
    workspace: ports.workspace,
  });
}
