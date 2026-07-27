# Agent Project Debug Workbench V1 audit

- Date: 2026-07-27
- Runtime: real Electrobun CEF renderer through Bun RPC
- Viewports: 1280×800 and 900×700
- Result: no critical/high UX, visual, or accessibility blocker

## Evidence

- `01-ready-artifact-1280x800.png` — Ready state, fixed external-editor entry,
  read-only source tree, and secret-safe compiled artifact summary.
- `02-invalid-diagnostic-1280x800.png` — watcher-driven Invalid state,
  path-specific compiler diagnostic, and external-editor repair action.
- `03-ready-artifact-900x700.png` — responsive single-column artifact summary
  at the narrow acceptance viewport.

## Checks

- Source display has no Save, dirty, overwrite, conflict, add, rename, or
  delete affordance.
- Project/file editor actions are visible and diagnostic repair remains
  actionable when the required file does not yet exist.
- Ready, Building, and Invalid states remain distinguishable without relying
  on color alone.
- Artifact cards disclose model, limits, environment names/requirement kinds,
  Sandbox shape, and capability provenance without secret values.
- Document, body, and the internal workbench scroller have no horizontal
  overflow at either viewport.
- Console capture contains only Vite connection and React development messages;
  no application error or warning was observed.
- Opening/importing source does not create or select a Thread. A final isolated
  regression created one Thread explicitly, changed source through
  Invalid→Ready, and retained exactly that one Thread.

## Deferred polish

- The 900×700 single-column summary is intentionally denser than 1280×800.
- Extracting the inspector from the combined Project tab module can improve
  maintainability without changing the V1 workflow.
