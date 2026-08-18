import { Thread } from "../threads/thread";

/**
 * A fully-resolved address of one concrete Thread file/version inside a
 * backend. Returned by storage publishers and by
 * {@link ReadableThreadStorage.resolveLatest}; passed back to
 * {@link ReadableThreadStorage.read}. Treat it as an opaque token — callers
 * pass it around rather than constructing or parsing its parts.
 */
export interface ThreadLocator {
  /**
   * Storage-scoped resource id — a gist id, or (for a local backend) a path.
   */
  id: string;

  /**
   * The concrete file within the resource, e.g. "browser-use-evolving-01.json".
   */
  filename?: string;

  /**
   * Resolved version; populated only by versioned backends (a gist commit
   * SHA). Undefined for single-version backends.
   */
  version?: string;
}

/**
 * Read side of single-Thread storage, addressed by an opaque resource id.
 *
 * Reading is two steps: resolve an id to the {@link ThreadLocator} of its
 * current latest version (version + filename), then read that locator into a
 * Thread. Non-versioned backends simply leave {@link ThreadLocator.version}
 * undefined. Serialization is handled inside the implementation; callers only
 * ever see a Thread.
 */
export interface ReadableThreadStorage {
  /**
   * Resolve a resource id to the locator of its latest version.
   */
  resolveLatest(id: string): Promise<ThreadLocator>;

  /**
   * Read and parse the Thread at a fully-resolved locator.
   */
  read(locator: ThreadLocator): Promise<Thread>;
}

/**
 * A {@link ReadableThreadStorage} whose backend keeps a full version history
 * (e.g. gist revisions). Currently just a marker distinguishing versioned
 * backends from single-version ones; version-listing is a future extension.
 */
export interface VersionedThreadStorage extends ReadableThreadStorage {
  // listVersions(id: string): Promise<ThreadVersion[]>;  // deferred
}
