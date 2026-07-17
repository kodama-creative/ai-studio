# Canonical Agent Project creation audit

## Audit scope

- Surface: LLM Space Electrobun CEF renderer.
- Flow: discover Agent Project creation, inspect default and MCP configuration,
  cancel with the keyboard, create through the real Desktop Bun RPC, and inspect
  the generated project in Build.
- Viewports: 1280×800 and 900×700.
- Capture: current-run raw CDP screenshots and DOM/console inspection.

## User goal and accessibility target

Create portable Agent source in an explicit user-owned directory, understand
the default capability composition, configure MCP only when selected, and land
in a trustworthy source-inspection state without hidden writes or layout
failure. The flow must retain native labels, predictable focus, keyboard
cancel, readable validation, and responsive reflow.

## Steps and evidence

1. **Welcome entry — healthy.** `08-welcome-final-900x700.png` shows the new
   sentence-case creation entry beside existing Thread and open-project paths.
   The updated description now names Agent Project creation without crowding or
   horizontal overflow.
2. **Canonical defaults — healthy.** `06-create-dialog-900x700.png` shows a
   focused name field, explicit user-owned-source copy, parent-folder choice,
   checked Local tool and Skill defaults, unchecked MCP, and a disabled primary
   action. The dialog fits 900×700 without document overflow.
3. **MCP configuration — healthy.** `07-mcp-dialog-900x700-scrolled.png` shows
   conditional URL and exact-tool fields, no-network reassurance, a visible
   footer after scrolling, and no page overflow. All three native checkboxes
   expose explicit accessible names in the current DOM snapshot.
4. **Generated source in Build — healthy.** `05-created-project-build.png`
   shows the real generated `agent.ts`, `instructions.md`,
   `skills/concise-response/SKILL.md`, and `tools/echo.ts` under one Build tab.
   Current DOM inspection found one CodeMirror, zero page overflow, zero visible
   alerts, and no application console errors.

## Strengths

- Entry points reuse the existing welcome, Agents sidebar, Command, and Build
  vocabulary instead of introducing another project model.
- The dialog explains portable-source ownership before any filesystem action.
- Defaults match CLI behavior, while MCP complexity stays conditional.
- Disabled primary action, explicit field help, deterministic preset cards,
  and the post-create Build surface make the result easy to inspect.
- Real filesystem evidence kept only five portable source files under the
  selected external parent; registry/trust and the default Thread remained
  under isolated `LLM_SPACE_HOME`.

## UX and accessibility risks

- The native macOS directory picker could be opened but not completed through
  the available CDP/macOS automation permissions. The same real Bun RPC was
  exercised directly from the current renderer module, and filesystem plus
  Build evidence verifies the downstream path, but picker selection remains a
  manual supplementary check.
- With MCP selected, 900×700 requires vertical dialog scrolling. The footer and
  conditional fields remain reachable and visible, so this is acceptable V1
  reflow rather than a blocker.
- Screenshot and DOM evidence confirm labels, focus, native checkbox semantics,
  Escape cancellation, and overflow, but do not establish full screen-reader
  announcements, contrast ratios, or platform-wide accessibility compliance.

## Verification notes

- Default checkbox state: Local tool checked, Skill checked, MCP unchecked.
- Initial focus: `agent-project-name`.
- Invalid kebab-case input sets `aria-invalid="true"`; the action remains
  disabled until name, parent, and conditional MCP input are valid.
- Escape closed the idle dialog through a real CDP keyboard event.
- Current console contained only Vite/React development information.
- `document.documentElement.scrollWidth - innerWidth` was `0` at both audited
  sizes.

## Outcome

Pass. No critical UX, visual, responsive, or accessibility finding blocks item
09. Native-picker completion and a full assistive-technology pass remain the
explicit evidence limits.
