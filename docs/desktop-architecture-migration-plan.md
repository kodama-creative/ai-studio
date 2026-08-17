# Desktop architecture migration plan

> Status: ready for implementation planning
> Depends on: [`desktop-architecture-redesign.md`](./desktop-architecture-redesign.md)

This plan migrates one complete vertical chain at a time. A migrated feature
must never call both old and new paths. Temporary compatibility code may exist
during local editing, but it must be gone from the feature's cutover commit.

## Global rules

- Preserve all user-visible behavior and persisted data.
- Change Bun, shared RPC, renderer, and tests for one feature atomically.
- Prefer replacement to layering; delete tests of removed shallow wrappers once
  the deep module interface has equivalent behavior coverage.
- Every commit passes its focused tests and typecheck. Every phase closes with
  full test, lint, and typecheck.
- Do not move unrelated files or reformat untouched code.
- No release is cut until full lint reports zero warnings and errors.

## Phase 0: architecture contract and baseline

### Work

- Land the architecture design, migration plan, and Theia research notes.
- Record the current full test/lint/typecheck/build results.
- Add a short inventory that assigns every current Desktop class to keep,
  deepen, rename, merge, or delete.
- Add dependency-rule tests or ESLint restrictions without changing runtime
  behavior.

### Exit criteria

- Architecture documents are reviewed.
- Baseline failures, if any, are recorded and separated from migration work.
- No product code behavior changed.

## Phase 1: Inversify and lifecycle primitives

### Work

- Enable the TypeScript decorator configuration required by Inversify 8.
- Add `reflect-metadata` only if the chosen explicit-`@inject()` compilation
  path proves it is required by the real Bun and Vite builds.
- Introduce feature-owned Symbol/interface conventions.
- Introduce typed `Event<T>`/`Emitter<T>` with listener-failure isolation and
  Disposable subscriptions.
- Add raw-container deactivation tests for parent/child behavior,
  `@preDestroy()`, `onDeactivation`, `toService()`, and `@multiInject()`.

### Exit criteria

- A fixture class resolves with explicit constructor injection in Bun tests and
  the renderer production build.
- Multi-binding order and alias identity are verified.
- `unbindAllAsync()` releases only local child bindings in tests.

## Phase 2: Desktop root Application

### Work

- Replace dynamic manual construction of long-lived process classes with
  decorated class bindings.
- Introduce the explicit Desktop process module list.
- Make `DesktopApp` the sole resolved root.
- Move platform quit/reopen wiring into the bootstrap runner/adapter so it can
  coordinate `DesktopApp.stop()` followed by root `unbindAllAsync()` without
  injecting Container into the Application.
- Rename `DesktopLaunchController` to `DesktopLaunchService` and replace stable
  option callbacks with injected interfaces.
- Keep current startup readiness and failure rollback behavior.

### Exit criteria

- Bootstrap resolves only `DesktopApp`.
- `DesktopApp` contains no `Container`, module load, or service location.
- Startup failure at every phase stops already-started process resources once.

## Phase 3: renderer root and renderer-only CommandRegistry

### Work

- Introduce `bootstrapRenderer()` and `RendererApplication`.
- Perform WindowContext lookup before container creation using the one shared
  RPC transport.
- Move renderer lifecycle Contributions into native `@multiInject()`.
- Move React mount/unmount outside DI composition but inside the renderer
  application runner.
- Make renderer `CommandRegistry` the only command registry.
- Forward native menu commands to the target renderer and delete Bun command
  dispatch after all current command handlers are migrated.

### Exit criteria

- React StrictMode remount does not restart Controllers or remote Service
  proxies.
- Menus, shortcuts, palette, and toolbar reach the same renderer Registry.
- Bun owns no CommandRegistry instance.

## Phase 4: Window tracer bullet

Use `window.*` as the first complete path because it exercises child-container
creation, native attach, RPC, renderer events, Commands, and disposal.

### Work

- Introduce `WindowContainerFactory`.
- Introduce `MainWindowApplication`, `ProjectWindowApplication`,
  `NativeWindowFactory`, and attach-once `NativeWindowService`.
- Replace `DesktopProcessContainer`/`DesktopWindowScope` for the tracer path
  with raw child containers.
- Bind the renderer `WindowService` proxy directly from the namespace manifest.
- Migrate fullscreen/zoom/reload handlers to renderer Commands calling the
  remote Window Service where appropriate.
- Verify native close triggers Application stop, then child unbind.

### Exit criteria

- Main and two Project child containers can coexist without contribution or
  WindowContext leakage.
- Closing one Project deactivates only that Project's instances.
- Main close/reopen creates a fresh Main child container.
- No late BrowserWindow binding exists.

## Phase 5: Models tracer for process Service and events

### Work

- Rename/deepen `ModelsApplication` into `ModelsService`.
- Replace `createModelsClient()` with a renderer proxy binding.
- Replace pass-through `ModelsRpcServer` with one `ModelsRpcContribution`.
- Convert process model change fan-out to feature-owned typed events and map it
  to RPC events per window.
- Migrate model catalog and settings Controllers to injected Services rather
  than option callbacks.
- Audit the `ModelsSettingsController` cluster with the deletion test; move
  independent editors into session containers.

### Exit criteria

- One process Models Service serves Main and Project windows.
- Event subscription-before-read behavior is race tested.
- Closing one renderer/window releases only its event subscriptions.
- No Models feature Client factory or pass-through RPC Server remains.

## Phase 6: global capabilities

Migrate one feature per atomic commit:

1. Analytics and Reminders;
2. GitHub Auth and Thread Sharing;
3. Updater;
4. Network and Search settings;
5. Skills and MCP;
6. app directories, dialogs, files, prompts, shell, and built-in tools;
7. auxiliary generation.

For each feature:

- create/deepen one Bun Service;
- bind one renderer remote Service proxy per namespace;
- use direct injection for required collaborators;
- use typed events only for post-commit fan-out;
- remove mechanical Client/RpcServer/Application wrappers;
- replace callback-heavy option bags with injected interfaces;
- migrate focused tests to the deep Service or Controller interface.

### Exit criteria

- Every migrated namespace has one Service contract and one RpcContribution.
- No migrated feature imports from the old top-level `client/`.
- Process event sources have no renderer callback ownership.

## Phase 7: Playground lifetime

### Work

- Bind one concrete, root-owned `DesktopPlaygroundApplication` that directly
  owns Studio/Pi/SQLite/tool composition and cleanup.
- Migrate Playground and Thread RPC Contributions atomically while keeping
  their distinct namespace responsibilities.
- Bind new proxies into Main renderer.
- Replace navigation/notification callbacks in workspace Controllers with
  injected Services.
- Preserve the per-Thread Zustand execution seam.

### Exit criteria

- Closing Main does not dispose Playground SQLite, catalog, or active Runs.
- Reopened Main reconnects to the same Playground Application and durable state.
- No duplicate Playground application token, interface/implementation pair, or
  pass-through facade exists.
- No duplicate Thread execution path exists.

## Phase 8: Project container

### Work

- Bind immutable `ProjectWindowInput` before resolving the Project Application.
- Move source, Studio, watchers, and Project Thread runtime into the Project
  child container.
- Make construction synchronous; perform all source/SQLite/Studio work from
  explicit start methods.
- Retain separate `projectSource.*`, `studio.*`, and `thread.*` Service
  contracts.
- Migrate `ProjectWorkspaceController` as the renderer aggregate that enforces
  source/thread/tab selection invariants.
- Remove project-specific staged late binding and `getAsync()` composition.

### Exit criteria

- Project Application does not create its native window until ProjectService
  is ready.
- Startup failure closes opened resources and unbinds the child once.
- Project close cancels watchers, streams, Studio, and source resources.
- Main and other Projects remain operational.

## Phase 9: renderer session containers

### Work

- Introduce explicit child-container creation functions and one root
  Application for Settings, Onboarding, Custom Model Editor, and Image Model
  Editor sessions.
- Replace `RendererScope` and nested Scope Providers with raw child containers
  and read-only DI Providers.
- Bind session targets as immutable Symbol/interface values.
- Move draft, mutation ordering, rollback, and cancellation into session
  Controllers.
- Keep ordinary dialogs and visual state outside DI.

### Exit criteria

- Opening a new session starts with no stale target, draft, or request state.
- Closing a session stops its Application and unbinds only its child container.
- Parent renderer Services remain alive and reusable.

## Phase 10: structural cleanup

### Work

- Move runtime files to `bun/`, `app/`, and `shared/` vertical feature
  directories.
- Delete the top-level `client/`; keep `app/` as the renderer application layer.
- Delete custom Scope wrappers, token factories, ContributionProvider, Bun
  CommandRegistry, old aggregations, and compatibility adapters.
- Remove old tests whose interface no longer exists; retain or rewrite every
  behavioral assertion at the new deep module seam.
- Tighten import-boundary lint rules after paths stabilize.
- Update `AGENTS.md` architecture documentation to the implemented result, not
  the transitional structure.

### Exit criteria

- Searches find no old Scope, token factory, Client factory, Bun Command
  Registry, or pass-through RPC Server pattern.
- No new/old dual path or fallback remains.
- Architecture mapping inventory has no unresolved class.

## Phase 11: full verification

Run from the repository root:

```sh
mise run test
mise run lint
mise run typecheck
mise run build:canary
mise run build:web
```

Then run the real desktop renderer with an isolated temporary application data
root and `mise run dev:cef`. Verify:

- cold start with no deep link;
- cold start with Main and Project deep links;
- Main close and reopen while a Playground Run is active;
- two Project windows open concurrently;
- close one Project during source watch and during Thread execution;
- Settings and editor sessions open/close repeatedly;
- native menu, shortcut, palette, and toolbar command parity;
- update/auth/model events do not duplicate after window reopen;
- application quit performs one ordered shutdown.

No architecture migration is complete until these scenarios pass without
warnings, unhandled rejections, leaked subscriptions, or stale child-container
instances.

## Commit discipline

Each commit should be small enough to explain one invariant but complete enough
to keep one runtime path authoritative. A recommended commit series is:

1. contract/guardrail;
2. container/lifecycle primitive;
3. one Application root;
4. one vertical feature cutover;
5. deletion of that feature's old path;
6. focused verification.

Do not combine unrelated feature cleanup or formatting with a cutover.
