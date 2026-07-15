const PENDING_SOURCES = new Map<string, string>();
const SOURCE_LISTENERS = new Map<string, Set<(path: string) => void>>();

export function requestExternalProjectSource(
  projectId: string,
  path: string
): void {
  PENDING_SOURCES.set(projectId, path);
  for (const listener of SOURCE_LISTENERS.get(projectId) ?? []) { listener(path); }
}

export function subscribeExternalProjectSource(
  projectId: string,
  listener: (path: string) => void
): () => void {
  const projectListeners = SOURCE_LISTENERS.get(projectId) ?? new Set();
  projectListeners.add(listener);
  SOURCE_LISTENERS.set(projectId, projectListeners);
  const pending = PENDING_SOURCES.get(projectId);
  if (pending) { queueMicrotask(() => { listener(pending); }); }
  return () => {
    projectListeners.delete(listener);
    if (projectListeners.size === 0) { SOURCE_LISTENERS.delete(projectId); }
  };
}

export function consumeExternalProjectSource(
  projectId: string,
  path: string
): void {
  if (PENDING_SOURCES.get(projectId) === path) {
    PENDING_SOURCES.delete(projectId);
  }
}
