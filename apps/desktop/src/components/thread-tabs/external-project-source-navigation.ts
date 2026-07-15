const pendingSources = new Map<string, string>();
const listeners = new Map<string, Set<(path: string) => void>>();

export function requestExternalProjectSource(
  projectId: string,
  path: string
): void {
  pendingSources.set(projectId, path);
  for (const listener of listeners.get(projectId) ?? []) listener(path);
}

export function subscribeExternalProjectSource(
  projectId: string,
  listener: (path: string) => void
): () => void {
  const projectListeners = listeners.get(projectId) ?? new Set();
  projectListeners.add(listener);
  listeners.set(projectId, projectListeners);
  const pending = pendingSources.get(projectId);
  if (pending) queueMicrotask(() => listener(pending));
  return () => {
    projectListeners.delete(listener);
    if (projectListeners.size === 0) listeners.delete(projectId);
  };
}

export function consumeExternalProjectSource(
  projectId: string,
  path: string
): void {
  if (pendingSources.get(projectId) === path) pendingSources.delete(projectId);
}
