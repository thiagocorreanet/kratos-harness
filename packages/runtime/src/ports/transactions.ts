/** No-follow metadata observed for a project-relative durable path. */
export type DurableEntry =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" | "symlink" | "special" }
  | {
      readonly kind: "file";
      readonly size: number;
      readonly sha256: string;
    };

/** Narrow durable filesystem primitives driven one boundary at a time. */
export interface DurableFileSystem {
  inspect(path: string): Promise<DurableEntry>;
  list(path: string): Promise<readonly string[]>;
  readText(path: string): Promise<string>;
  createDirectory(path: string): Promise<void>;
  createDirectoryExclusive(path: string): Promise<void>;
  writeSynced(path: string, content: string): Promise<void>;
  replaceFile(stagedPath: string, targetPath: string): Promise<void>;
  linkFileExclusive(sourcePath: string, targetPath: string): Promise<void>;
  renameDirectoryExclusive(
    sourcePath: string,
    targetPath: string,
  ): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeEmptyDirectory(path: string): Promise<void>;
  /** This method alone accepts the exact `.` project-root sentinel. */
  syncDirectory(path: string): Promise<"supported" | "unsupported">;
}

/** Injected content digests, so domain code never imports a crypto runtime. */
export interface Digests {
  sha256(text: string): string;
  sha256Bytes(bytes: Uint8Array): string;
}
