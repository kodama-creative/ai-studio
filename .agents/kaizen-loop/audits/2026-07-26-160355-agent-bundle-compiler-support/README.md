# Packaged Agent bundle compiler support acceptance

Real `bun run dev:cef` acceptance used an isolated system-temporary
`LLM_SPACE_HOME` and the checked-in `apps/example-agent`.

- Electrobun copied only the native addon, `index.js`, and the generated
  support module/sidecar into `Resources/app/bun/`.
- The renderer's actual `externalAgentProjects` client opened the checked-in
  project through Electrobun RPC as `ready` with one default Thread.
- Build exposed all checked-in Agent sources and the default Thread reused the
  shared Playground with its model, reasoning, tools, variables, and prompt.
- Bun persisted a closed Agent bundle plus artifact descriptor. After a full
  Desktop stop/start, project inspection and Thread read restored the same
  artifact fingerprint.
- 1280×800 and 900×700 DOM measurements matched viewport/body/root dimensions;
  the application console contained no errors.

The isolated automatic first-workspace seed also appeared in the inventory and
remained `invalid` because its old `get-weather.ts` still default-exports a bare
tool object. That independent seed migration was not part of this compiler
prerequisite and was not used as the acceptance project.
