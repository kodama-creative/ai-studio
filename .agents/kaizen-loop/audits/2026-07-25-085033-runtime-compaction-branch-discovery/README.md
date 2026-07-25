# Runtime compaction and branch UX discovery audit

- Date: 2026-07-25
- Mode: combined UX and accessibility discovery audit
- Product surface: Desktop Thread Run History, Run Inspector, and checkpoint restore
- Capture: real Electrobun CEF renderer over the Bun RPC bridge
- Runtime data: isolated temporary `LLM_SPACE_HOME` under the system temporary directory

## Flow

1. `01-current-run-history.png` — open one Thread whose two saved checkpoints
   belong to the same Runtime Run. The panel correctly groups both checkpoints,
   exposes Inspect/Restore/Compare, and reports the current Runtime state and
   checkpoint count. The group is still a flat newest-first list with a
   truncated opaque Run id; there is no branch label, parent/child relation,
   active checkpoint, or compaction boundary.
2. `02-current-run-inspector.png` — inspect the newest checkpoint without
   mutating the working Thread. The inspector preserves the complete visible
   prompt/messages and offers previous/next navigation. Navigation is temporal
   (`1 of 2`), not structural, so it cannot explain where two alternatives
   diverged.
3. `03-current-restored-checkpoint.png` — restore the older checkpoint in the
   same Thread. The editor correctly changes to the older content and the
   action stays undoable, but the panel does not mark the restored checkpoint
   or explain that the next Run will fork. The visual emphasis remains on the
   newest checkpoint, which can imply the opposite of the current working
   boundary.

## Strengths

- Run History is already discoverable from the Thread header and uses one
  stable Runtime Run grouping rather than presenting every checkpoint as an
  unrelated result.
- Inspect is non-mutating; Restore stays in the same Thread and preserves the
  existing Runtime Session and Run History.
- Icon actions have descriptive accessible labels, and the inspected
  checkpoint remains readable in the narrow side panel.
- The 1280×800 viewport, document, and body dimensions match exactly; no page
  overflow or application console error was observed.

## Highest-impact gaps

1. A user cannot see branch lineage, the current branch, or the checkpoint that
   will become the next execution boundary.
2. Restore changes the working transcript without a persistent `Working from`
   indicator; the newest-card animation can misidentify the active boundary.
3. Runtime stores Run state but no parent Run/checkpoint identity, branch
   labels, immutable message tree, or compaction record. Desktop Run History is
   capped at 20 full snapshots, so it cannot be the complete long-Session
   audit history promised by item 20.
4. The entire visible transcript is sent as model context; there is no durable
   summary boundary or inspectable record of which messages a summary replaced.
5. Text at the Run group level is very small and heavily truncated. A future
   tree must provide full accessible names, current/selected state, and standard
   keyboard navigation rather than relying on color or short ids.

## Evidence limits

- This fixture has two deterministic checkpoints and no paid model call. It
  proves the current inspect/restore semantics, not context-window exhaustion.
- Discovery captured 1280×800 only. A future implementation audit must cover
  1280×800 and 900×700, keyboard traversal, screen-reader state announcements,
  compaction progress/failure, restart, and a multi-branch fixture.
- Screenshot evidence cannot establish full WCAG compliance.
