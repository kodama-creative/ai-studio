"use client";

import { memo, type ReactNode } from "react";

interface Pane {
  id: string;
}

function _Pane<T extends Pane>({
  active,
  renderPane,
  tab,
}: {
  active: boolean;
  renderPane: (tab: T, active: boolean) => ReactNode;
  tab: T;
}) {
  return renderPane(tab, active);
}

const MemoizedPane = memo(_Pane) as typeof _Pane;

export function PaneHost<T extends Pane>({
  tabs,
  activeId,
  getPaneKey,
  renderPane,
}: {
  tabs: readonly T[];
  activeId: string | null;
  getPaneKey: (tab: T) => string;
  renderPane: (tab: T, active: boolean) => ReactNode;
}) {
  return tabs.map((tab) => (
    <MemoizedPane
      key={getPaneKey(tab)}
      active={tab.id === activeId}
      renderPane={renderPane}
      tab={tab}
    />
  ));
}
