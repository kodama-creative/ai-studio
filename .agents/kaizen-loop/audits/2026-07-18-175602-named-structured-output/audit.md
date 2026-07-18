# Named Structured Output Contracts V1 Audit

## Audit scope

- Surface: real LLM Space Electrobun CEF renderer with an isolated temporary
  `LLM_SPACE_HOME` and Agent Project.
- Flow: select an authored output contract, inspect its schema, read the
  completed typed value, and inspect the same value in Run History.
- Viewports: 1280×800 and CDP-emulated 900×700.
- Mode: combined UX and accessibility audit using current-run screenshots,
  DOM semantics, layout measurements, and console capture.

## User goal and accessibility target

Choose a named output without seeing framework-tool mechanics, understand the
contract before running, and recover the identical typed result from the
message flow and durable Run History. Selection, schema, copy, collapse, and
history controls must remain labeled and keyboard-focusable without document
overflow.

## Steps and evidence

1. **Select a contract — healthy.** `01-selected-1280x800.png` shows `Output`
   between `Tools` and `Variables`, with `Text`, `contact-card`, and `decision`
   available through the native combobox. Standalone Threads omit this row.
2. **Inspect the authored schema — healthy.** `02-schema-1280x800.png` shows
   the selected contract description and read-only pretty TypeBox schema next
   to the selector. The source-owned name is clear without exposing the
   reserved execution tool.
3. **Verify compact schema reflow — healthy.** `03-schema-900x700.png` keeps
   the popover within the Thread surface and readable at compact width.
   Document and body scroll width both remained exactly 900 CSS pixels.
4. **Read the completed value — healthy.** `04-result-900x700.png` shows one
   generic `Structured output · contact-card` card under the assistant message,
   including the schema fingerprint, pretty JSON, Copy, and Collapse. The
   internal `final_output` tool name is absent from visible text and the normal
   tool-call UI.
5. **Inspect the durable result — healthy.** `05-run-trace-1280x800.png` shows
   Run History reusing the same card with the same contract name, fingerprint,
   and JSON value above the saved prompt and transcript.
6. **Inspect history at compact width — acceptable.**
   `06-run-trace-900x700.png` keeps both the live result and Run History result
   visible with no document overflow. The three-pane debugging layout is
   intentionally dense: labels truncate and long JSON scrolls within its card,
   while Back, previous/next, close, copy, and collapse remain reachable.
7. **Recover from a terminal contract failure — healthy.**
   `07-failure-card-1280x800.png` shows the latest durable
   `structured_output_missing` terminal as a stable card after the assistant
   message, using direct recovery copy and no Retry action. DOM inspection
   confirms the copy is a polite status and `final_output` remains hidden.

## Strengths

- The selector follows the existing compact Thread configuration language and
  makes plain text an explicit default instead of silently changing behavior.
- Read-only schema detail gives authors confidence before inference without
  turning the Thread into a schema editor or generated form builder.
- One result-card vocabulary spans live messages and durable Run History.
- Contract name plus fingerprint makes provenance visible while pretty JSON
  keeps the primary value readable.
- Native combobox/button semantics, descriptive accessible names, and
  focusable controls cover the tested keyboard path.

## UX and accessibility risks

- Compact Run History leaves limited horizontal space for large JSON values;
  cards contain their own horizontal scrolling and the page does not overflow,
  but a future focused inspector could improve prolonged narrow-window review.
- Fingerprints are intentionally shortened in the card. The full durable value
  is available in data and tests, while a future provenance detail could expose
  the full hash without crowding the primary result.
- Screenshots and DOM inspection cannot establish every contrast ratio,
  screen-reader announcement, or clipboard permission outcome. No full WCAG
  compliance claim is made.

## Verification notes and outcome

- `final_output` did not appear in rendered body text.
- The missing-result terminal rendered the exact stable failure copy in a
  semantic `role="status"` region without offering automatic retry.
- Both live and historical cards exposed semantic Copy and Collapse buttons;
  selector, schema, history, navigation, and close controls had native button
  or combobox semantics and were keyboard-focusable.
- Body and document scroll widths equaled viewport width at 1280 and 900 CSS
  pixels.
- Final console capture contained only Vite connection and React development
  information, with no application errors.
- The isolated environment had no configured model, so the UI used a small
  persisted successful result fixture. Deterministic Pi/Runtime/Server tests
  separately prove generation, exact validation, terminal persistence, and
  replay; live provider variability is not claimed.

Outcome: pass. No critical UX, visual, responsive, or accessibility finding
blocks roadmap item 15.
