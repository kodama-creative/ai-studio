"use client";

import { uuid } from "@llm-space/core";
import {
  LOCAL_STORAGE_KEYS,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "@llm-space/ui/lib/local-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { createPlaygroundClient } from "@/client/playground-client";

import { pruneInvalidRestoredTabs } from "./restored-tab-pruning";

/** One open UI Thread backed exclusively by a durable Studio Playground. */
export interface PlaygroundTab {
  readonly id: string;
  readonly type: "playground";
  readonly playgroundId: string;
  readonly title: string;
  readonly paneId: string;
  readonly refreshNonce?: number;
}

export type AppTab = PlaygroundTab;

interface PersistedPlaygroundTab {
  readonly type: "playground";
  readonly playgroundId: string;
  readonly title?: string;
}

const PERSISTED_PLAYGROUND_TABS_SCHEMA = z.array(
  z.object({
    type: z.literal("playground"),
    playgroundId: z.string(),
    title: z.string().optional(),
  })
);

export function tabLabel(tab: AppTab): string {
  return tab.title;
}

export interface ThreadTabs {
  readonly tabs: AppTab[];
  readonly activeId: string | null;
  readonly openPlayground: (playgroundId: string, title: string) => void;
  readonly close: (id: string) => void;
  readonly closeOthers: (keep: string) => void;
  readonly closeAll: () => void;
  readonly reorder: (from: number, to: number) => void;
  readonly activate: (id: string) => void;
  readonly activateNext: () => void;
  readonly activatePrevious: () => void;
  readonly refresh: (id: string) => void;
  readonly handlePlaygroundTitleChange: (
    playgroundId: string,
    title: string
  ) => void;
  readonly reopenClosed: () => void;
}

function _tabId(playgroundId: string): string {
  return `playground:${playgroundId}`;
}

function _createTab(playgroundId: string, title: string): PlaygroundTab {
  return {
    id: _tabId(playgroundId),
    type: "playground",
    playgroundId,
    title,
    paneId: `playground-pane:${uuid()}`,
  };
}

function _persistable(tab: AppTab): PersistedPlaygroundTab {
  return {
    type: "playground",
    playgroundId: tab.playgroundId,
    title: tab.title,
  };
}

function _fromPersisted(tab: PersistedPlaygroundTab): PlaygroundTab {
  return _createTab(tab.playgroundId, tab.title?.trim() || "Playground");
}

function _dedupe(tabs: AppTab[]): AppTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

function _loadPersistedTabs(): AppTab[] {
  try {
    const raw = readLocalStorage(LOCAL_STORAGE_KEYS.openAppTabs);
    if (raw === null) return [];
    return _dedupe(
      PERSISTED_PLAYGROUND_TABS_SCHEMA.parse(JSON.parse(raw)).map(
        _fromPersisted
      )
    );
  } catch {
    // Old file-backed Thread tabs are intentionally not parsed or migrated.
    return [];
  }
}

function _loadActive(tabs: AppTab[]): string | null {
  const active = readLocalStorage(LOCAL_STORAGE_KEYS.activeTab);
  return active !== null && tabs.some((tab) => tab.id === active)
    ? active
    : (tabs[0]?.id ?? null);
}

async function _exists(tab: AppTab): Promise<boolean> {
  try {
    return (await createPlaygroundClient().load(tab.playgroundId)) !== undefined;
  } catch {
    return false;
  }
}

export function useThreadTabs(
  options: { canPruneRestoredTab?: (tab: AppTab) => boolean } = {}
): ThreadTabs {
  const restored = useRef<AppTab[] | null>(null);
  restored.current ??= _loadPersistedTabs();
  const [tabs, setTabs] = useState<AppTab[]>(restored.current);
  const [activeId, setActiveId] = useState<string | null>(() =>
    _loadActive(restored.current ?? [])
  );
  const tabsRef = useRef(tabs);
  const closedStack = useRef<PersistedPlaygroundTab[][]>([]);

  useEffect(() => {
    tabsRef.current = tabs;
    writeLocalStorage(
      LOCAL_STORAGE_KEYS.openAppTabs,
      JSON.stringify(tabs.map(_persistable))
    );
  }, [tabs]);
  useEffect(() => {
    if (activeId === null) removeLocalStorage(LOCAL_STORAGE_KEYS.activeTab);
    else writeLocalStorage(LOCAL_STORAGE_KEYS.activeTab, activeId);
  }, [activeId]);

  useEffect(() => {
    const initial = tabsRef.current;
    if (initial.length === 0) return;
    let cancelled = false;
    void Promise.all(
      initial.map(async (tab) => ((await _exists(tab)) ? tab : null))
    ).then((checked) => {
      if (cancelled) return;
      const invalid = checked.flatMap((tab, index) =>
        tab === null && initial[index] ? [initial[index]] : []
      );
      setTabs((current) => {
        const next = pruneInvalidRestoredTabs(
          current,
          invalid,
          options.canPruneRestoredTab ?? (() => true)
        );
        if (next === current || next.length === current.length) return current;
        setActiveId((currentActive) =>
          currentActive !== null && next.some((tab) => tab.id === currentActive)
            ? currentActive
            : (next[0]?.id ?? null)
        );
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validate only the tabs restored on mount
  }, []);

  const pushClosed = useCallback((closed: AppTab[]) => {
    if (closed.length > 0) closedStack.current.push(closed.map(_persistable));
  }, []);

  const openPlayground = useCallback((playgroundId: string, title: string) => {
    const id = _tabId(playgroundId);
    setTabs((current) => {
      const existing = current.find((tab) => tab.id === id);
      return existing === undefined
        ? [...current, _createTab(playgroundId, title)]
        : current.map((tab) => (tab.id === id ? { ...tab, title } : tab));
    });
    setActiveId(id);
  }, []);

  const activate = useCallback((id: string) => setActiveId(id), []);
  const activateSibling = useCallback((offset: 1 | -1) => {
    setActiveId((current) => {
      const list = tabsRef.current;
      if (list.length === 0) return null;
      const index = list.findIndex((tab) => tab.id === current);
      const nextIndex =
        index === -1
          ? offset === 1
            ? 0
            : list.length - 1
          : (index + offset + list.length) % list.length;
      return list[nextIndex]?.id ?? null;
    });
  }, []);

  const close = useCallback(
    (id: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id);
        if (index === -1) return current;
        const closed = current[index];
        const next = current.filter((tab) => tab.id !== id);
        if (closed !== undefined) pushClosed([closed]);
        setActiveId((active) =>
          active === id
            ? (next[index - 1]?.id ?? next[index]?.id ?? null)
            : active
        );
        return next;
      });
    },
    [pushClosed]
  );

  const closeOthers = useCallback(
    (keep: string) => {
      setTabs((current) => {
        if (!current.some((tab) => tab.id === keep)) return current;
        pushClosed(current.filter((tab) => tab.id !== keep));
        return current.filter((tab) => tab.id === keep);
      });
      setActiveId(keep);
    },
    [pushClosed]
  );

  const closeAll = useCallback(() => {
    pushClosed(tabsRef.current);
    setTabs([]);
    setActiveId(null);
  }, [pushClosed]);

  const reorder = useCallback((from: number, to: number) => {
    setTabs((current) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= current.length ||
        to >= current.length
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1) as [AppTab];
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const refresh = useCallback((id: string) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === id
          ? { ...tab, refreshNonce: (tab.refreshNonce ?? 0) + 1 }
          : tab
      )
    );
  }, []);

  const handlePlaygroundTitleChange = useCallback(
    (playgroundId: string, title: string) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.playgroundId === playgroundId ? { ...tab, title } : tab
        )
      );
    },
    []
  );

  const reopenClosed = useCallback(async () => {
    const group = closedStack.current.pop();
    if (group === undefined) return;
    const candidates = group.map(_fromPersisted);
    const alive = (
      await Promise.all(
        candidates.map(async (tab) => ((await _exists(tab)) ? tab : null))
      )
    ).filter((tab): tab is AppTab => tab !== null);
    if (alive.length === 0) return;
    setTabs((current) => _dedupe([...current, ...alive]));
    setActiveId(alive.at(-1)?.id ?? null);
  }, []);

  return {
    tabs,
    activeId,
    openPlayground,
    close,
    closeOthers,
    closeAll,
    reorder,
    activate,
    activateNext: () => activateSibling(1),
    activatePrevious: () => activateSibling(-1),
    refresh,
    handlePlaygroundTitleChange,
    reopenClosed,
  };
}
