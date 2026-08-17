## Introduction

A workbench for prompt and agent development — build, trace, debug, evaluate, and manage, all in one place. It ships as a native **desktop app** (Electrobun), not a website.

## Tooling

**mise is the task front door** — `mise tasks ls` lists every entry point; task bodies forward to package.json scripts, the implementation layer. **bun** is the package manager and JS runtime (fuzzy-pinned in `mise.toml`, exact version + checksums locked in `mise.lock` — regenerate with `mise lock` when bumping). Do not use npm/pnpm/yarn.

| Task                                   | Command                                                                                   | Notes                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Set up a fresh clone                   | `mise run setup`                                                                          | installs the locked toolchain (`mise install`) + JS deps (`bun install`)                                                                         |
| Install deps                           | `bun install`                                                                             | from repo root                                                                                                                                   |
| Run desktop app                        | `mise run dev`                                                                            | → `cd apps/desktop && bun run dev:hmr` (Vite HMR on :5173 + `vite build && electrobun dev`; restart to pick up bun main-process changes)         |
| Run desktop app with CEF/CDP debugging | `mise run dev:cef`                                                                        | → `cd apps/desktop && bun run dev:cef`; exposes CDP on `127.0.0.1:9333` by default                                                               |
| Run the web site (landing + viewer)    | `mise run dev:web`                                                                        | → `bun --filter @llm-space/web dev` (Vite on :5175). Landing at `/llm-space/`, viewer at `/llm-space/#/shared/<connectorId>/threads/<threadId>`  |
| Build (canary)                         | `mise run build:canary`                                                                   | → `vite build && electrobun build --env=canary` in `apps/desktop`                                                                                |
| Build (stable)                         | `mise run build:stable`                                                                   | → `vite build && electrobun build --env=stable` in `apps/desktop`                                                                                |
| Build the web site                     | `mise run build:web`                                                                      | → `bun --filter @llm-space/web build` (static, `base=/llm-space/`, out to `apps/web/dist`). CI + the Pages workflow run this                     |
| Local packaging / update test          | `mise run pack` · `pack:perf` · `pack:adhoc` · `pack:signed` · `pack:feed` + `feed:serve` | env combinations over `build:canary` (skip signing / CEF Performance edition / ad-hoc sign / local update feed on :8321); defined in `mise.toml` |
| Cut a release                          | `mise run release` / `mise run release:canary`                                            | → `bun scripts/release.ts`; see "Releases & auto-update"                                                                                         |
| Test                                   | `mise run test`                                                                           | runs the complete Bun test suite from the repository root                                                                                        |
| Lint                                   | `mise run lint` / `mise run lint:fix`                                                     | `lint` = `eslint .` (read-only), `lint:fix` = `eslint --fix .`; flat config at repo root                                                         |
| Typecheck                              | `mise run typecheck`                                                                      | `tsc --noEmit` over the root plus each workspace-specific project; React/DOM workspaces use their own DOM tsconfigs.                             |
| Add a dependency                       | `bun add <pkg>`                                                                           | run inside the target package (`apps/desktop` or `packages/core`)                                                                                |
| Add a shadcn/ui component              | `bunx --bun shadcn@latest add <component>`                                                | run inside `packages/ui` (the shared design system now lives there, not `apps/desktop`)                                                          |
| Run a script from root                 | `bun --filter <pkg> <script>`                                                             | e.g. `bun --filter @llm-space/desktop start`                                                                                                     |

Bun's built-in test runner discovers the repository's `*.test.ts` files through `mise run test`. CI (`.github/workflows/ci.yml`) runs tests + lint + typecheck + a production `vite build` + workflow-YAML validation on PRs and pushes to main. The last two exist because both failure modes are invisible until a release tag is pushed, and then take the release down with them: a renderer bundle that outgrows the runner's V8 heap (`build:view` sets `--max-old-space-size=4096`; the default ~2 GB stopped being enough at 14701 modules) and a malformed workflow file. Keep the renderer bundle in mind — if `vite build` starts OOMing again, raise the ceiling in `build:view` or cut the bundle down, and don't discover it at release time.

GUI commits (VS Code, Fork) failing with `bun: command not found`: husky hooks need bun on PATH — add `export PATH="$HOME/.local/share/mise/shims:$PATH"` to `~/.config/husky/init.sh` (husky's documented fix for version managers).

Shared dependency versions live in the root `package.json` `catalog` (referenced as `"catalog:"`) — bump them there, not per-package. The catalog currently pins `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `react`, `react-dom`, and `typebox`.

### Electrobun page debugging

When you need to inspect or debug the real desktop renderer, use the project
skill at `./.agents/skills/electrobun-cdp-debug/SKILL.md`. Do **not** mock
`electrobun.rpc` in a browser.

Start with `mise run dev:cef`; normal `mise run dev` keeps the native WebView
renderer and does not expose CDP.

When CEF/CDP verification needs an isolated app data root, put runtime sandbox
data in the system temporary directory by default, not under `.agents/` or the
repo:

```sh
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/llm-space-XXXXXX")"
LLM_SPACE_HOME="$TMP_ROOT" mise run dev:cef
```

Only keep durable evidence in the repo, such as audit screenshots, notes, logs,
and small redacted JSON snippets. Do not commit or leave routine `workspace/`,
`settings/`, caches, or generated app data under `.agents/kaizen-loop/` unless a
fixture is intentionally preserved for review and the reason is documented.

## Architecture

Bun-workspace monorepo. Workspaces are `packages/*`, `apps/*`, and the runnable
`examples/basic-agent` tracer-bullet example (the static site lives at
`apps/web`).

- **`@llm-space/agent`** (`packages/agent`) — code-first Agent definition surfaces plus filesystem discovery/loading. The loader returns a serializable manifest alongside executable module namespaces. `agent/skills/index.ts` is the optional collection-level `defineVariable()` slot; without it the runtime provides `available_skills`. Skill summaries enter instructions only through an explicit variable reference, while the host automatically freezes the agent-scoped `load_skill` tool and resolved Skill set into each Pi operation binding.
- **`@llm-space/pi-runtime`** (`packages/pi-runtime`) — the durable Pi Session execution kernel. It owns the Bun-native, `pi_`-prefixed SQLite `SessionRepo`, immutable LLM Space operation bindings, direct one-turn Pi model execution, sequential local tools, debugger Step/Continue, and durable tool-approval recovery. `DurablePiRuntime` is its only public execution facade. Pi `AgentMessage` is canonical; Playground and Project Experiment execution use this runtime as their only transcript and execution-state authority.
- **`@llm-space/runtime`** (`packages/runtime`) — Bun-local host capability implementations: Models, MCP, network/search settings, Skill discovery, traces, and the frozen built-in `ToolRegistry`. It is not a session/execution runtime and exposes no aggregate `RuntimeClient`; Desktop composes these capability managers directly, while all agent execution remains in `@llm-space/pi-runtime`.
- **`@llm-space/acp`** (`packages/acp`) — the isolated official ACP v2 Draft edge pinned to `@agentclientprotocol/sdk@1.3.0`. It projects committed Pi log identities into replay-safe ACP updates and hosts the standard session lifecycle plus capability-negotiated `_llm-space.dev/session/{snapshot,step,continue}` methods. Pi Runtime never depends on ACP. ACP exists only at the CLI/external protocol edge; Desktop does not use ACP.
- **`@llm-space/app`** (`packages/app`) — reusable Pi-backed end-application layer. It owns Session and Task product metadata plus durable command receipts; transcript, operation state, branch, leaf, outcome, and usage come from Pi Session entries. Its Bun-only `@llm-space/app/server` entry exposes `createAgent()`, which accepts `projectRoot`, host-owned `dataRoot`, Pi `Models`, and explicit runtime services, then composes Loader + Pi Runtime + App tables in one SQLite database.
- **`@llm-space/studio`** (`packages/studio`) — Studio product metadata over Pi Session. It owns ordinary `Playground`/`AgentSpec` and Project Experiment metadata, dirty editable Drafts, ordered Pi operation references, evaluations, durable debugger command receipts, and Studio event projection. Transcript, active operation, lane, leaf, outcome, and usage are read from Pi Session. Draft admission clears the Draft after Pi commits the operation. Pi, immutable runtime bindings, and Studio tables share one physical SQLite database with separate table ownership. Its Bun-only `@llm-space/studio/server` entry owns Project source browsing/watch, Git revision binding, Agent loading, Pi runtime composition, and SQLite; Desktop exposes it only through namespaced Electrobun RPC.
- **`@llm-space/cli`** (`packages/cli`) — terminal composition root. `llm-space dev` opens the installed Studio, `llm-space exec` executes one Pi operation and prints one schema-v2 JSON document, and `llm-space acp` exposes the same App/Pi runtime over official ACP v2 NDJSON stdio. No SSH transport, HTTP/WS Agent server, or second execution loop ships.
- **`@llm-space/example-basic-agent`** (`examples/basic-agent`) — author-only tracer bullet containing `defineAgent`, instructions, and tools. Host composition, storage, models, and streaming come from Studio/App/CLI rather than project-local `local-host.ts` or `run.ts` files.
- **`@llm-space/core`** (`packages/core`) — domain library, **no build step**; its TypeScript is consumed directly via the `exports` map. Entrypoints:
  - `.` → re-exports the internal `client`, `parsers`, `types`, and `utils` directories (all browser-safe).
  - `./client` — browser-safe pieces: the `streamThread()` client (`client/api`), the `reduceMessages()` streaming reducer (`client/reducer`), and the `AgentTransport` interface (`client/transport`).
  - `./thread` — headless, framework-neutral thread semantics shared by both runtime contexts: run history + evaluation scoring (`thread/history`, `thread/run-history-utils`, `thread/run-evaluation-utils`), prompt variables + display resolution (`thread/prompt-variables`, `thread/prompt-variable-display`) and Jinja2 template rendering (`thread/template-render` — `{% if %}`/`{% for %}`/filters plus the `@include("path")` macro, depth/count capped by `MAX_INCLUDE_DEPTH`/`MAX_INCLUDE_COUNT`; `TEMPLATE_MARKER_RE` gates whether text is rendered as a template at all), usage aggregation + formatting (`thread/usage`, `thread/token-usage`), and tool-call status (`thread/tool-call-status`). Pure thread-domain logic (no React/DOM) belongs here — **not** in the `@llm-space/ui` thread-playground, whose helpers should stay presentational.
  - `./server` — Node/Bun-only implementations: `streamAgent()` (`server/agent/stream`), filesystem paths (`server/paths` — `getLlmSpaceHomePath()`, `getSettingsDir()`), blob helpers, and window-state persistence (`server/window-state`).
  - `./types` — `Thread`/`Message`/`ModelConfig`/`Tool`/`ModelProviderGroup`, the network/search settings shapes shared across the RPC boundary (`types/network`, `types/search`), and the converters to/from the `@earendil-works/pi-*` formats.
- **`@llm-space/ui`** (`packages/ui`) — the shared React design system + **Thread Playground**, **no build step** (consumed as TS via the `exports` map), and **Electrobun-free** so both the desktop renderer and the static web app render the same UI. Holds: shadcn primitives (`./ui/*`), `cn` + pure helpers (`./lib/*`), design tokens (`./styles/globals.css`, Tailwind v4), app-level components (`./components/*` — thread-playground, model-provider, code-editor, tooltip, confirm-dialog, markdown, preview-dialog, …), and the **`HostServices` seam** (`./host`). Internal files use **relative imports** (never `@/`, which the desktop bundler would hijack); `exports` uses a `.tsx` wildcard for `./components/*` plus explicit entries for the `thread-playground` barrel, `examples/prompts` (a `.ts` subpath), and `code-editor` (both tsc and Vite must resolve them). shadcn `ui/` is ESLint-ignored (`packages/ui/src/ui/**`); add components with a `packages/ui/components.json`.
  - **The `HostServices` seam** (`packages/ui/src/host/`) is how the playground stays decoupled: host-specific helper generation (`auxiliaryGeneration`), local tool execution, `skills`/`mcp`/`builtinTools`/`paths` clients, navigation actions, and the `presentational` flag are injected via `HostServicesProvider` + `useHostServices()`. Product execution is a separate `ExternalThreadExecutionRuntime` supplied by the owning Playground or Studio adapter; Desktop implements both seams with direct namespaced Electrobun RPC clients. Model access is independently injected through `ModelClient`; the non-React `ModelCatalogController` owns runtime epochs, stale-response suppression, ordered per-client mutations, and refresh lifecycle, while `ModelProvider` only adapts its external store to React Context. **Desktop** supplies the real implementations in `apps/desktop/src/host/host-services.tsx`; **web** supplies display-only no-op stubs. Never import `@/client`/`@/commands`/`electrobun` from inside `packages/ui`.
- **`@llm-space/desktop`** (`apps/desktop`) — the Electrobun app. Its default window catalogs durable Playgrounds plus known Agent Projects; selecting a Project opens its separate Project/Experiment IDE window. Built with Vite (React 19) for the renderer and `electrobun` for the shell. Two runtime contexts bridged by a single typed RPC channel:
  - **bun main process** (`src/bun/`) — owns the native window, menu, filesystem, model config, and agent streaming.
  - **webview renderer** (`src/app`, `src/components`, `src/mainview`) — the React UI. The Thread Playground and design system now live in `@llm-space/ui`; the renderer imports them and provides the desktop `HostServices`/`ModelClient`.
- **`@llm-space/web`** (`apps/web/`) — the **static site**: the marketing **landing page** at `/llm-space/` and a **display-only shared-thread viewer** at `/llm-space/#/shared/<connectorId>/threads/<threadId>` (reads a thread through a `ThreadConnector` from `@llm-space/core/storage` — the gist connector uses `GistThreadReader.readShared` for the thread + author/description/filename meta — and renders `@llm-space/ui`'s `ThreadPlayground` read-only with a stub `HostServices`, `presentational: true`). **Routing is `HashRouter`** (react-router) so deep links resolve on Pages at HTTP 200 with no `404.html` fallback; the site is **dark-only** (theme pinned in `main.tsx`). The desktop "Open in LLM Space" deep link mirrors the route as `llm-space://shared/<connectorId>/threads/<threadId>`. No Electrobun, no backend. `base: "/llm-space/"`; CodeMirror is **not** deduped in `apps/web/vite.config.ts` (no direct dep — one copy already resolves through the package). The landing page is **vendored** under `apps/web/src/landing/` (self-contained, its own single-quote style — ESLint-ignored, still typechecked); its extra CSS is additive in `apps/web/src/landing/index.css` (the shadcn tokens live in `@llm-space/ui/styles/globals.css`; the near-black bg is scoped to the landing root). **Deploy:** `.github/workflows/pages.yml` builds `apps/web/` on push to `main` and publishes via `actions/deploy-pages` (repo Pages Source is **GitHub Actions**). CI (`ci.yml`) also builds `apps/web/` so PRs catch breakage.

### The RPC bridge

`src/shared/rpc.ts` (`DesktopRPCType`) is only the Electrobun transport envelope: one namespaced request, stream subscribe/unsubscribe messages, namespace events, and `executeCommand`. Business methods are never flattened into that contract. Each feature owns a shared `RpcNamespace` interface, a Bun `RpcServer` class, and a renderer `createRpcClient()` client with exact request/response/stream/event types. Namespace manifests explicitly enumerate every request, stream, and event; the client exposes only those declared members so JavaScript reflection protocols can never become accidental RPC calls.

Native shell capabilities follow the same ownership rule under `bun/native/`: Window, Native Dialogs/import, Native Files, App Directories, and Shell each have a feature module; RPC features have separate shared contracts, server classes, renderer client factories, and `RpcContribution` owners. Do not recreate the previous `native-applications`, `native-module`, `native-rpc`, `native-rpc-servers`, `native-files` client aggregation, or a catch-all native contribution/module.

The window-scoped `WindowApplication` is constructed before its native
`BrowserWindow`, attached exactly once immediately after native construction,
and owns maximize/fullscreen/zoom/reload behavior plus Window events. Its
contribution only maps Commands/RPC onto that interface. Do not pass delayed
`getWindow()` callbacks through DI, resolve applications from native event
callbacks, or bind raw BrowserWindow/RPC values without an actual consumer.

Every native window owns one `RpcRegistry`. Window-scoped feature classes implement the same-name `RpcContribution` symbol + interface and register their server classes during `RpcRegistry.onStart()`. A named `ContributionProvider<RpcContribution>` takes one frozen snapshot after all window modules are bound; duplicate namespaces and late registration fail. The Registry owns request dispatch, stream abort, event subscriptions, and reverse-order registration cleanup. `createMainWindowRPC()` only forwards the Electrobun envelope to that Registry and never constructs business services.

Bundled window composition is explicit in the production composition root.
`desktop-app.ts` owns the ordered Common/Main/Project module sets and
injects one scope-configuration function through `DesktopWindowFactory` into
`DesktopWindowRuntime`. The runtime invokes it once before freezing the
Command/RPC contribution snapshots and must not import business feature modules
directly. Do not recreate distributed process-level window feature
multi-bindings or a catch-all `di/modules` aggregation.

Project windows keep three interfaces distinct: `projectSource.*` owns source
read/watch, `studio.*` owns Studio Thread metadata, Drafts, history,
evaluations, and events, while `thread.*` exclusively owns Run/Step/Continue,
tool approval, inspection, and cancellation. Do not recombine source and Thread
methods into a catch-all Project Studio client/server.

### Bun composition and bundled modules

`src/bun/app/bootstrap.ts` owns shell-environment hydration, cold-start deep-link
capture, workspace/Skill seeding, process-scope creation, and composition-failure
cleanup. It loads the production composition root only after those startup
prerequisites complete; `src/bun/index.ts` only invokes this bootstrap.

The Bun process object graph is assembled in one production composition root,
`src/bun/app/desktop-app.ts`. Process-scoped managers are constructed
there, bound and eagerly adopted once with feature-owned DI identities, and
consumed by constructor factories in feature-owned modules. Vertical feature
slices live under their named `bun/*/` directories; each owns its application
logic, DI identities/module, RPC server/contribution, and local implementation
details. `bun/rpc/` contains only the Electrobun transport bridge, while shared
Thread execution transport lives under `bun/thread/`. Do not recreate a central
business-token registry or put feature adapters back into `bun/rpc/`.
Do not recreate central `runtime-module` or catch-all `di/modules` files.

The Playground slice binds one process-owned `DesktopPlaygroundApplication`,
which directly owns Studio/Pi/SQLite/tool composition and disposal. RPC performs
the transport naming projection; do not add a second pass-through Playground
facade or duplicate host/application token. Likewise, a DI token backed by one
concrete application class does not need an empty `*Application` interface plus
an `*ApplicationImpl` class; implement the shared request contract directly.
Orchestrating cross-cutting capabilities such as Models, Auxiliary Generation,
and Thread Sharing keep separate application and `*-rpc-feature.ts` modules.
Transport-only features such as Analytics, GitHub Account, Updates, and
Reminders adapt their existing manager/state owner directly in the RPC feature.
`GitHubAuthManager` and `UpdaterService` own their process events; Reminders
state is one process-owned `RemindersState` with serialized file access, never
module-level mutable state. Do not add a second process singleton merely to
mirror RPC methods. Every feature still owns one shared RPC contract and
renderer client;
do not merge them into generic `application-services`, `application-rpc-servers`,
`application-rpc`, or `application-rpc-clients` aggregations. Bun feature
modules must not export import-time manager instances or let application classes
reach through a service locator.

Feature `ContainerModule` factories resolve constructor dependencies through
Inversify `ResolutionContext`; they do not call `DesktopWindowScope.get(...)`.
`DesktopWindowRuntime` resolves the window-scoped `WindowApplication` once as a
lifecycle root before starting the Registries; that resolution lets the scope's
disposable tracker adopt it without passing the scope into the feature module.

Each native window has a child Inversify scope. Feature modules bind window
contribution classes with `toService(...)`; one class may implement both
`CommandContribution` and `RpcContribution` without creating two instances.
`DesktopWindowRuntime` is the deep lifecycle module around that scope: it
applies the composition-root-provided window module configuration, freezes and
starts both Registries, owns the Electrobun bridge, attaches the eventual
native window, and disposes transports before closing the window. The child
container remains the instance and lifecycle isolation boundary; callers must
not reproduce that sequence. Concrete internal application classes use their
constructors as DI identities; typed symbols are reserved for external values
and actual interface seams and remain owned by the relevant feature.
`DesktopWindowFactory` owns Main/Project native creation around that runtime,
including Studio resolution, immutable Project identity, window-state binding,
command routing, and failed-scope cleanup; window managers consume the factory
instead of reconstructing those steps.
External process resources which are not DI disposables register with
`DesktopLifecycle` immediately after construction. The same LIFO module owns
both process-resource cleanup and the top-level Desktop shutdown transaction;
it cleans each stack once in reverse ownership order and continues after
individual failures. The startup wrapper always stops the process scope if
composition fails. Do not defer cleanup registration until the end of startup.
Cold-start URL capture is the deliberate import-time exception:
`bootstrap.ts` loads `deep-link/launch.ts` immediately after shell hydration and
before longer seed/composition imports. The launch adapter buffers Electrobun
URLs in a `DeepLinkInbox`; `DesktopLaunchController` atomically connects to that
inbox, routes buffered/live Main and Studio links, owns reopen behavior, and
disconnects before window teardown. The top-level `DesktopLifecycle` stack owns
the idempotent stop order (launch routing → Project windows → process scope).
Keep these state machines out of `desktop-app.ts`; the composition root
only injects their platform adapters.
The named generic `ContributionProvider<T>` keeps both Registries independent
from Inversify. Registries start once before the Electrobun bridge and native
window are created, reject late registration, then dispose registrations before
the window scope disposes contribution instances. Application classes never
implement Desktop contribution interfaces and never access the container.

`DesktopHost` (`src/bun/host/desktop-host.ts`) is the lifecycle boundary for
trusted, bundled modules. Modules register synchronously before RPC/window
creation, the contribution registry then freezes for the process lifetime, and
cleanup runs in reverse order on a best-effort basis. Startup errors include
the module id. Electrobun quit uses a two-phase handshake so asynchronous host,
MCP, and analytics cleanup finishes before the process exits.

V1 exposes one internal extension seam: `ToolContribution` through
`ToolRegistry` (`packages/runtime/src/tools/tool-registry.ts`). Contributions
have stable unique ids and tool names; registration snapshots and freezes tool definitions.
The bundled built-in-tools module is the reference implementation. This is not
a public plugin SDK: dynamic loading, manifests, permissions, runtime
enable/disable, renderer contributions, and third-party compatibility remain
out of scope.

### Data flow (the core loop)

Main-window and Project execution is `Playground/Experiment metadata + Pi Session`: UI action → Zustand external execution adapter → namespaced Electrobun `thread.*` RPC → Playground/Studio application → `DurablePiRuntime` → Pi Session. The UI refreshes committed transcript from Pi message entries; Studio stores only Drafts, product metadata, operation ordering/references, evaluations, and command receipts. UI “Thread” means the selected lane/leaf projection, not a persistence authority. Stateless helper generation uses the separate `auxiliaryGeneration.*` RPC and never creates a Pi Session.

Desktop is local-only and communicates with its Bun process through namespaced Electrobun RPC. Remote Runtime, SSH, the headless server, and the previous Plugin system do not ship. Skills are host-discovered prompt variables/tools; they are not a Pi subsystem. The only current extension seam is the frozen bundled `ToolContribution` registry described above.

### Thread store

Each open thread owns its own Zustand store (`stores/thread-store.ts`), created per-tab via `createThreadStore()` and supplied through `ThreadStoreContext` — there is **no global store**. Read it with `useThreadStore(selector)` and `useThreadStoreActions()`. State holds the `thread`, `streamingMessage`, `status`, `runHistory`, and `changeHistory`; `run()` drives a streaming turn. Undo/redo lives in `stores/thread-history.ts`: snapshots are thread _references_ (copy-on-write shares unchanged substructure, so undo is an O(1) pointer move), capped by count and a retained-image-bytes budget.

### Persistence

State is **persisted to disk** under the llm-space root (`~/.llm-space` by default; override with `LLM_SPACE_HOME`):

- `studio/studio.sqlite` — local main-window Playgrounds. Pi owns `pi_*`, immutable bindings use `llm_space_runtime_bindings`, and Studio owns `studio_*`; no `engine_*` tables are created.
- `studio/projects/<project-id>/studio.sqlite` — code-first Agent Project Experiments with the same Pi/binding/Studio table ownership. The path is user application data, never written under project source.
- `workspace/` — local filesystem capabilities used by tools and generated projects; it is not a Playground transcript store.
- `settings/` — `models.json` (configured providers, owned by `ModelManager`), `window.json` (frame/zoom/maximized), `reminders.json` (`featureRemindersSeen` ids + GitHub-star reminder state, owned by process-scoped `RemindersState`), and `updates.json` (update mode + per-edition bundle hashes, owned by `UpdaterService` through `UpdatesState`).
- Old local JSON Threads are not migrated or reopened. Import accepts the versioned LLM Space Thread Snapshot envelope and creates a new Playground/Pi Session.

### Releases & auto-update

The app version has a **single source of truth: `apps/desktop/package.json`** — `electrobun.config.ts` imports it, and release CI fails if the pushed tag doesn't match. Cut releases with `mise run release` (stable) or `mise run release:canary`; the script (`scripts/release.ts`) runs `commit-and-tag-version` (conventional-commits-driven version bump + commit + `v*` tag, config in `.versionrc.json`) and pushes atomically. Automated changelog generation is off (`skip.changelog`) — the `CHANGELOG.md` at the repo root is **hand-curated** (Keep a Changelog format), so before cutting a stable release, add a `## [x.y.z]` section for it. CI builds each versioned release's GitHub notes by extracting that version's `CHANGELOG.md` section (no `--generate-notes`, which would dump commits/authors) and appending the install blurb; prereleases with no changelog entry (canary) fall back to install-only notes. The tag triggers `.github/workflows/release.yml`: build → codesign/notarize (canary/stable only; needs the `MACOS_*`/`ASC_*` signing secrets, mapped to electrobun's `ELECTROBUN_*` env vars in the workflow) → smoke test → upload. Artifacts land in two GitHub releases: the rolling `updates` release is the machine-readable update feed (`release.baseUrl` points at it; **never delete its `.patch` files** — old installs chain through them), and a versioned release carries the DMG for humans. In-app auto-update lives in `bun/updates/` (background check → silent download → "restart to update" toast via the namespaced Updates event); the dev channel never updates.

Before any release, run `mise run lint` from the repository root and require a
clean exit with **zero warnings and zero errors**. The lint script enforces this
with `--max-warnings 0`; never release from a revision that fails this check.

If `@earendil-works/pi-ai` is still at version `0.83.0` when preparing a
release, check the npm registry for a newer official version and verify whether
upstream has fixed Responses tool-call ID replay for non-OpenAI providers. Do
not ship the local dependency patch without checking first. If an official
release contains the fix, upgrade the dependency and remove the local patch
before releasing.

**Two editions ship from every tag.** The regular one drives the system WebView; the **Performance** edition embeds Chromium (CEF). `LLM_SPACE_DESKTOP_RENDERER=cef` is the only switch — `electrobun.config.ts` forks the app name (`LLM Space Performance`), the identifier (`…llm-space.performance`) and the update feed off it, so the two install side by side in `/Applications` and update independently. They deliberately **share `~/.llm-space`** (`getLlmSpaceHomePath()` is name-independent), so switching editions keeps threads and settings. Two things make this work and will silently break if touched: (1) each edition needs its **own rolling update release** (`updates` / `updates-performance`) — `update.json` is named `{channel}-{os}-{arch}-update.json` with no app name, so a shared release would have them overwrite each other; hence the release workflow downloads the two editions' artifacts into **separate directories** rather than `merge-multiple` into one. (2) CEF must **not** get a `remote-debugging-port` in shipped builds — `chromiumFlags` is only set when `LLM_SPACE_DESKTOP_CDP_PORT` is explicitly passed (which `dev:cef` does, and CI never does); an always-on CDP port would let any local process drive the renderer. Build the Performance edition locally with `mise run pack:perf`.

Releases ship for **macOS arm64 + x64** (so four build jobs per tag: 2 arches × 2 editions). Intel builds need `apps/desktop/scripts/fix-x64-headerpad.ts` (wired as the `postBuild`/`postWrap` hooks): electrobun's darwin-x64 core binaries have no Mach-O headerpad, so signing them corrupts `__text` and the app segfaults on launch (electrobun#485). The hook frees 16 bytes of load-command room before signing and no-ops everywhere else; delete it when upstream fixes #485. It deliberately scans only the top level of `Contents/MacOS/`, which does **not** cover the binaries CEF adds (the `Chromium Embedded Framework.framework` and the five `Contents/Frameworks/bun Helper*.app` helpers, whose executable is electrobun's `process_helper`). That is correct, and was verified against the real darwin-x64 core rather than assumed: the CEF framework ships pre-signed (adhoc, linker-signed), and x64 `process_helper` — although unsigned like `extractor`/`launcher` — already has headerpad ≥ 16, so `codesign` can append `LC_CODE_SIGNATURE` without corrupting it. Running the hook against the x64 core reports `process_helper — ok` while `extractor`/`launcher` come back `fixed`. Don't widen the hook's scan on a hunch; re-run that check instead.

### The command layer

Every cross-boundary user action (menus, context menus, toolbar buttons, shortcuts) is a `Command` — a namespaced `type` discriminant (`playground.create`, `window.toggleMaximized`, `updates.check`) plus typed `args` — defined in `src/shared/commands.ts`. Read/event capabilities such as window context and fullscreen state remain namespaced RPC. `COMMAND_META` tags each command with a target of `"webview"` or `"bun"`; the single `executeCommand` RPC message is only a transport envelope. On the Bun side, every window owns one `CommandRegistry`. Feature classes implement the same-name `CommandContribution` symbol + interface and register one typed handler per command during `onStart()`; duplicate ownership and late registration fail. Unclaimed renderer commands are forwarded through the window's `CommandSink`. On the renderer side, the state-owning UI module registers its handlers through `CommandProvider`. The native menu maps shell action ids into commands. DI symbols use `desktopToken(namespace, name)` so every service identity has an explicit namespace.

Command results are intentionally ignored, but both Bun and renderer registries contain synchronous throws and rejected handler promises at the dispatch seam. Features needing user-visible completion or error state publish it through their own typed RPC events. Agent Project open/pick is command-only; its RPC namespace exposes the catalog read plus `changed` and `openFailed` events.

Interactive Thread editor execution (`run`, `step`, `continue`, tool approval,
and cancellation) is the deliberate exception: these actions belong to the
injected `ExternalThreadExecutionRuntime`, which calls the product-scoped
`thread.*` RPC namespace directly and returns execution updates to the editor.
They are not shell/menu commands and must retain the selected
Playground/Experiment target on every request.

### App layout (`apps/desktop/src`)

- `mainview/` — the Vite entry: `index.html` + `main.tsx` mounting `<App>`.
- `app/` — `index.tsx` resolves the native window context; `layout.tsx` owns visual/query providers; `desktop-window-providers.tsx` is the shared Main/Project renderer composition root (`CommandProvider` → `DesktopHostProvider` → `ModelProvider`); `page.tsx` exports `MainWindowPage` and owns only Main-window composition. Main-window Playground application behavior lives under `app/playground/`: `PlaygroundWorkspaceController` owns the restartable durable catalog, pane-projection merging, blank/example creation, dynamic seed resolution, versioned snapshot import, and tab opening; sidebar presentation must consume its snapshot rather than keep an independent list query. `app/tabs/` owns Main tab identity, local persistence, restoration validation, close/reopen ordering, and deferred pruning after pane activity settles behind `MainTabsController`'s snapshot + intent interface; the Playground RPC client and pane-activity tracker are injected at composition. Project behavior lives under `app/project/`: `AgentProjectCatalogController` owns the Main-window known-Project subscription-before-read lifecycle and stale-response suppression; `ProjectWorkspaceController` is the Project-window renderer owner for tabs and the cross-Thread/source selection epoch, composing the internal `ProjectThreadsController` (Thread collection/open concurrency, event cursors, stream cancellation, history/evaluation state) and `ProjectSourceController` (authoritative source watch plus open-file refresh) behind one restartable snapshot interface. The Bun `ProjectWindowManager` owns process-wide Project catalog mutations and emits their authoritative change event, including opens initiated by deep links and restore paths; renderer-command adapters must not synthesize catalog changes themselves. Account behavior lives under `app/account/`: `GithubAuthController` and `GithubAuthProvider` own initial-read/live-event precedence, subscription lifecycle, error reporting, and login/logout commands. `app/onboarding/` owns the open-session epoch, provider discovery precedence, and serialized provider-add mutation; onboarding presentation renders its snapshot and owns analytics/navigation intent. `app/thread-sharing/` owns dialog target epochs plus auth/publish stale-result suppression; presentation owns only transient form, clipboard, and visual state and must clean that state on every close path. `app/reminders/` owns best-effort passive reminder state; `app/updates/` owns the passive update channel and Main-window update provider; `app/window/` owns native-window projections: `FullScreenController` subscribes before its initial RPC read, keeps live events authoritative, and contains restart/cleanup failures; `app/lifecycle/` contains shared renderer teardown policy. Settings application behavior lives under `app/settings/`: `McpSettingsController` owns MCP selection, Draft conversion, debounced persistence, test/cancel/disconnect operations, and stale RPC suppression; `SkillsSettingsController` owns skill-folder selection, native folder/reveal operations, mutation ordering, optimistic skill toggles, and stale RPC suppression; `SettingsFormController` owns restartable reads, ordered writes, local Drafts, and latest-intent rollback. Models Settings is the local feature under `app/settings/models/`; its React presentation is colocated under `components/settings/models/`. `runSettingsMutation` adapts other fallible async mutations to void UI events. Do not move RPC lifecycle, mutation ordering, rollback, or stale-result suppression back into presentation state/effects.
  - `ModelsSettingsController` adapts the shared `ModelCatalogController` projection and mutation ports, and owns provider selection/fallback, Add/Remove admission, and the lifecycle of `AddProviderController`, `ProviderMetadataController`, `ProviderProfilesController`, and the focused `ProviderProfileController`. The custom chat/image model editor controllers live beside that aggregate and suppress results after close or retarget. `models-page.tsx` is the React adapter; provider search/filter/dialog state stays in presentation.
- `bun/` — main-process code: `app/` (process/window composition, menu, window-state), vertical `playgrounds/`, `projects/`, `native/`, `models/`, `auxiliary-generation/`, and `thread-sharing/` feature slices, `rpc/` for transport infrastructure and manager/state adapters, `di/`, `host/`, `auth/` (`GitHubAuthManager` — OAuth Device Flow + `settings/auth.json`), `fs/` (truly shared trash/reveal primitives only), `updates/`, `reminders/` (one-time feature reminders + GitHub-star reminder, persisted to `settings/reminders.json`; reminder definitions ship in code at `shared/feature-reminders.ts` — append to `FEATURE_REMINDERS`, never reorder or reuse an `id`), `env/hydrate` (loads login-shell env — API keys/PATH — before anything reads `process.env`), and `workspace/seed`.
  - Model mutations cross the renderer seam as user intents. In particular, Ark image-model enablement and custom-model CRUD are applied atomically by `ModelManager` through `ModelsApplication`; a custom-provider model upsert also owns the provider API-mode update in the same persisted intent. Renderer code must not read a configuration snapshot, construct a replacement config, or split one user intent across multiple RPC mutations.

> **GitHub calls go through the proxy.** GitHub auth (`bun/auth/`) and any future gist calls run from the **bun process** using the global `fetch`, which `NetworkSettingsManager` (`bun/network/`) routes through the user's configured proxy by writing `HTTP(S)_PROXY` onto `process.env`. Just call `fetch` — never add a bypassing custom dispatcher, or corporate/proxied users' GitHub requests will fail.

- `client/` — renderer-side namespaced RPC adapter factories. Each feature owns its client file, and the renderer composition/application/presentation owner creates and retains the adapter for its own lifetime. Do not export import-time client instances or introduce cross-feature client aggregations.
- `host/` — `host-services.tsx`: the desktop `HostServices` + `ModelClient` impls (`DesktopHostProvider`, `createElectrobunModelClient`) feeding the shared `@llm-space/ui` playground.
- `shared/` — code used by both contexts: the Electrobun envelope, commands, and one `*-rpc.ts` contract per feature.
- `components/` — desktop-only presentation: `thread-tabs/`, `settings/`, `command-palette.tsx`, `onboard-dialog.tsx`, `feature-reminder-dialog.tsx` (the "what's new" reminder popup), and account/update/github widgets. Application providers, RPC lifecycle, mutation ordering, and teardown policy belong under `app/`, not here. **The Thread Playground, model-provider, code-editor, shadcn `ui/`, and design tokens moved to `@llm-space/ui`** — import them from there, not from `@/components`.
  - `components/thread-tabs/` owns only generic tab chrome and pane mounting; it receives a `renderPane` adapter. Main tab persistence/restoration lives under `app/tabs/`; the Pi-backed Playground pane, refresh acknowledgement, and run-lifecycle ownership live under `app/playground/` and are composed by `PageWorkspace`.
- Design tokens live in `@llm-space/ui/styles/globals.css` (Tailwind v4 + OKLch), imported once by `app/layout.tsx`. The app is dark-themed.

### Web site (GitHub Pages) — how it publishes

The site at **`deer-flow.github.io/llm-space/`** (landing page + shared-thread viewer) is the `@llm-space/web` app (`apps/web/`). Publishing is **fully automated via GitHub Actions** — there is no manual deploy step:

- **`.github/workflows/pages.yml`** runs on every push to `main` (and `workflow_dispatch`): `bun --filter @llm-space/web build` → `actions/upload-pages-artifact` (`apps/web/dist`) → `actions/deploy-pages`. So **merging to `main` publishes the site** — nothing else to do.
- **One-time repo setting (already done once):** Settings → Pages → **Source = "GitHub Actions"**. If Pages ever reverts to "Deploy from a branch", the workflow's `deploy-pages` step fails until it's set back.
- `apps/web/` uses `base: "/llm-space/"`; absolute asset refs in JSX must go through `import.meta.env.BASE_URL`. No `.nojekyll` is needed (the Actions artifact bypasses Jekyll).
- CI (`ci.yml`) also runs `build:web` on PRs, so a Vite break is caught before it reaches Pages.

### Static assets (images, etc.)

There are two kinds of assets, and they land in different places:

- **Imported assets** — `import logo from "./logo.svg"`. Vite hashes these into `dist/assets`, which `electrobun.config.ts` already copies to `views/mainview/assets`. No config change needed.
- **Public assets referenced by absolute path** — e.g. `<img src="/images/onboard.png">`. These live under **`src/mainview/public/`** (Vite's `root` is `src/mainview`, so `public/images/onboard.png` is served at `/images/onboard.png`). Vite copies `public/` verbatim into `dist/`, but a **packaged build only copies what `electrobun.config.ts` `build.copy` lists** — so any new top-level public folder must be added there, or it 404s in the built app. Today `build.copy` maps `dist/images` → `views/mainview/images`; if you add, say, `public/fonts/`, add a `"dist/fonts": "views/mainview/fonts"` entry too.

Prefer dropping new images into the existing `src/mainview/public/images/` folder so no config edit is required.

## Conventions

- **TypeScript**: strict, ESNext, `moduleResolution: bundler`. In `apps/desktop`, `@/*` maps to `./src/*`.
- **Layering**: `@llm-space/core` splits browser-safe code (`./client`, `./thread`, `./types`, root `.`) from Node/Bun-only server implementations (`./server`). The desktop **bun process** consumes `@llm-space/core/server`; the **renderer** consumes the client/types entrypoints and reaches the bun process over RPC (never imports `./server`).

### Naming

- **File names** are **kebab-case** for every `.ts`/`.tsx` file, including component files (e.g. `tool-call-list-item.tsx`, `model-provider.tsx`). No PascalCase or camelCase filenames. One primary component/export per file, named after the file.
- **Identifiers**:
  - React components, classes, types, and interfaces are **PascalCase** (`ThreadPlayground`, `ModelManager`, `Command`, `ModelConfig`).
  - Functions, variables, and hooks are **camelCase** (`createMainWindowRPC`, `useMainTabs`). Command discriminants are namespaced camelCase segments (`playground.create`, `tabs.close`).
  - Module-level constants are **UPPER_SNAKE_CASE** (`DOCS_URL`, `ZOOM_STEP`, `COMMAND_META`, `BUILTIN_PROVIDERS`).
- **Leading underscore for what's private**:
  - Module-private (non-exported) functions: `_foo()`.
  - Private class members: `_config`, `_models`, `_loadConfig()` (see `ModelManager`).
  - When a wrapper re-exports a primitive under the same name, alias the primitive with a leading underscore to avoid the collision (`import { Tooltip as _Tooltip } from "./ui/tooltip"` in `components/tooltip.tsx`).

### UI elements

- **`ui/`** is generated shadcn/ui — **don't hand-edit** (also ESLint-ignored). Add components with `bunx --bun shadcn@latest add <component>`.
- Prefer the **app-level wrappers** in `components/` over the raw shadcn primitives. In particular, **Tooltips must use `@/components/tooltip`** (`<Tooltip content={...}>…</Tooltip>`) — do **not** import `Tooltip`/`TooltipTrigger`/`TooltipContent` from `ui/tooltip` directly. The only direct use of the primitive is `TooltipProvider`, wired once in `app/layout.tsx`.
- **Confirmations**: gate destructive or irreversible actions (delete a file, remove a provider) behind `ConfirmDialog` from `@/components/confirm-dialog` — don't fire them straight from a click.
- **Empty states**: every list or collection view must define an intentional empty state. Prefer the shared `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, and `EmptyContent` primitives from `@llm-space/ui/ui/empty` over ad hoc centered text or blank space. Include a concise explanation and, when useful, the primary action that helps the user populate or recover the list; also handle filtered/search results that contain no matches.
- **Menus and commands**: every cross-boundary action is a `Command` (`shared/commands.ts`); its `type` is `<namespace>.<camelCaseAction>`. Labels in `COMMAND_META`, native menus (`bun/app/menu.ts`), context menus, dropdown menus, and similar menu-like surfaces are **Title Case** ("Add New Method", "New Playground", "Close Tab"). Route cross-boundary dispatch through `executeCommand`; register Bun handlers from the owning application module.
- **General UI copy**: ordinary buttons, headings, helper text, empty states, dialogs, and other non-menu labels use sentence case ("Add new method", "Start from example", "No tools yet").

### Performance

**Weigh render performance on every change.** This UI streams events and re-renders hot lists (messages, tool calls), so:

- Wrap components that re-render often or sit in a list in `memo()`. The house pattern is `export const Foo = memo(_Foo)` — the underscore-prefixed inner holds the implementation (see `MessageListItem`, `ThinkingView`, `CodeEditor`).
- Keep memo effective: stabilize props with `useMemo`/`useCallback` and read the store through narrow `useThreadStore(selector)` slices so a component only re-renders on the state it uses.
- Don't reach for `memo()` reflexively on cheap, rarely-rendered components — add it where a profile or the render path shows it pays off.

### Formatting

- **Prettier**: 2-space indent, double quotes, semicolons, es5 trailing commas, tailwind class sorting (`prettier-plugin-tailwindcss`). Import ordering is enforced by `eslint-plugin-import-x`.
