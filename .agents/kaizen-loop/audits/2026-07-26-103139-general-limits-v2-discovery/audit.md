# General Limits V2 discovery audit

- Date: 2026-07-26
- Product: real Electrobun CEF renderer at 1280×800
- Data root: isolated system temporary directory

## Current surface

`01-current-thread-no-general-limits.png` shows the ordinary Thread editor. DOM
inspection found no cost, model-call, tool-call, duration, concurrency,
schedule, or generic limit text. Viewport, document, and body dimensions were
all 1280×800. The console contained only Vite and React development messages.

## Blocking packaged-runtime finding

`02-agent-project-bundle-regression.png` shows the checked-in example Agent as
`invalid` in both workspace discovery and an explicit Bun RPC open. The RPC
error is:

```text
Cannot find module .../Contents/Resources/app/bun/validate-authored-source.ts
```

The packaged app contains `Resources/app/bun/index.js` and the native addon,
not the Runtime compiler's TypeScript source tree. The current bundle compiler
derives `create-bundled-agent-project.ts`, `validate-authored-source.ts`, and
`transform-dynamic-tool-source.ts` from `import.meta.url`; bundling rebases that
URL beside `index.js`. Source-level compiler tests therefore miss the actual
Electrobun resource boundary.

This blocks Agent Project activation and prevents honest General Limits UI or
end-to-end verification. The Desktop process and ports were stopped after the
audit; no repository-local runtime data was retained.
