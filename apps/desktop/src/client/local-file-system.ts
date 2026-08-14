import type {
  FileNode,
  FileSystem,
  Thread,
  ThreadStorage,
} from "@llm-space/core";
import { normalizeThreadForPath } from "@llm-space/ui/lib/thread-file";

import type { RuntimeId } from "@/shared/runtime";

import { revealNativeFile } from "./native-files";
import { workspaceClient } from "./runtime-rpc-clients";

/**
 * Client-side `FileSystem` + `ThreadStorage` that talks to the bun side over
 * Electrobun RPC (the `fs*` requests), the desktop counterpart to the web
 * {@link LocalFileSystemClient} that POSTs to `/api/fs/local/*`. Each method
 * issues a request and rejects with the bun handler's error on failure.
 */
export class LocalFileSystemClient implements FileSystem, ThreadStorage {
  constructor(private readonly _runtimeId?: RuntimeId) {}
  ls(path: string): Promise<FileNode[]> {
    return workspaceClient.list(this._runtimeId, path);
  }

  async mkdir(path: string): Promise<void> {
    await workspaceClient.createDirectory(this._runtimeId, path);
  }

  async cp(src: string, dest: string): Promise<void> {
    await workspaceClient.copy(this._runtimeId, src, dest);
  }

  async mv(src: string, dest: string): Promise<void> {
    await workspaceClient.move(this._runtimeId, src, dest);
  }

  async rm(path: string): Promise<void> {
    await workspaceClient.remove(this._runtimeId, path);
  }

  async read(path: string): Promise<Thread> {
    const thread = await workspaceClient.readThread(this._runtimeId, path);
    return normalizeThreadForPath(thread, path);
  }

  async write(path: string, thread: Thread): Promise<void> {
    await workspaceClient.writeThread(
      this._runtimeId,
      path,
      normalizeThreadForPath(thread, path)
    );
  }

  /** Reveal a file/directory in the OS file manager (Finder/Explorer). */
  async reveal(path: string): Promise<void> {
    const absolutePath = await workspaceClient.resolvePath(this._runtimeId, path);
    await revealNativeFile(absolutePath);
  }

  /** Resolve a workspace-relative path to its absolute on-disk path. */
  async realpath(path: string): Promise<string> {
    return workspaceClient.resolvePath(this._runtimeId, path);
  }
}

export function createFileSystemClient(
  runtimeId?: RuntimeId
): LocalFileSystemClient {
  return new LocalFileSystemClient(runtimeId);
}

/** Shared client instance using the bun-side default runtime. */
export const localFs = createFileSystemClient();
