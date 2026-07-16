# Runtime Run State Machine And Transactional Session Store V1

- Status: done
- Outcome: completed
- Roadmap item: 02

## Trigger

The user explicitly requested continuation with roadmap item 02 after item 01 completed. The run started on `develop` at `2f20627`, synchronized with `origin/develop`. The worktree already contained the user-owned rewritten `LOOP_PLAN.md` and `LOOP_TASK.md` plus untracked `CONTEXT.md` and `docs/adr/`; those starting changes are preserved and are not owned by this pass.

## Product stage and context

The Pi Agent-backed Runtime Harness V0 is complete, but `AgentSession` currently exposes only a host message-persistence callback. The product has no explicit durable Runtime Run identity, state machine, immutable Run Configuration Snapshot, ordered Run Journal, transactional Session Store seam, or stale-writer protection. Item 02 establishes that Host-neutral foundation without migrating Desktop or introducing Server persistence.

## Evidence reviewed

- `AGENTS.md`, `README.md`, `package.json`, `LOOP_TASK.md`, `LOOP_PLAN.md`, and `CONTEXT.md`.
- Accepted ADR 0001, current capability map, and the latest three kaizen logs.
- Current runtime package entrypoints, README, `AgentSession`, `AgentRuntime`, execution policy, event projector, immutable Agent Project snapshot, and focused tests.
- Current git state and the completed item-01 evidence at commit `2f20627`.

## External market scan

Access date: 2026-07-16.

Primary sources:

- https://docs.langchain.com/oss/javascript/langgraph/persistence
- https://docs.temporal.io/temporal
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html

LangGraph documents durable thread-scoped checkpoints; Temporal documents durable execution reconstructed from Event History; DynamoDB documents version-number optimistic locking that rejects writes when the persisted version changed. Together they establish the relevant table stakes: durable execution needs an explicit identity, recoverable ordered history, and conditional writes rather than last-write-wins mutation. The true local gap is a small Host-neutral seam that expresses those semantics without adopting another framework's workflow engine or persistence model. Uncertainty is limited to future production-adapter details because item 02 intentionally ships only the contract and in-memory reference adapter.

## Capability-map freshness

- `Agent Definition And Runtime`: `confirmed` on 2026-07-16 from current source and item-01 validation; item 02 will extend its boundary with Runtime Run and Session Store semantics.
- `Tool Step Orchestration`: `confirmed` on 2026-07-16; item 02 records control-plane state only and must not change Pi tool execution.
- No UI capability is touched. CEF and product-design audit are not applicable.

## Product north-star metric

- Name: deterministic Runtime Run transition and stale-writer rejection coverage.
- Why it matters: Desktop and Server cannot safely share one Runtime Harness until Run identity, waits, terminal states, history order, and concurrent ownership are explicit and testable.
- Baseline: zero explicit durable Runtime Run state or CAS fixtures; current message persistence has no expected-version token or ordered transition journal.
- V1 target: focused tests cover all nine declared states, every legal transition family, illegal and terminal transition rejection, stable Run identity, atomic Session snapshot + configuration + journal persistence, immutable configuration, deterministic journal order, and stale/concurrent writer rejection.
- Measurement: focused Bun fixtures through the same public harness seam used by callers, plus runtime/full tests, TypeScript, lint, browser-safe bundle, and diff review.
- Guardrails: no Desktop migration, Server adapter, filesystem/database persistence, external-effect retry, exactly-once claim, compaction, approval policy, UI change, Pi loop duplication, packaging, signing, notarization, or release command.

## Candidate product opportunities

1. Main recommendation: add a dedicated cross-environment Runtime Harness entrypoint with a deep Session Store interface and in-memory reference adapter that owns transitions, immutable configuration, journal sequencing, CAS, and atomic rollback.
2. Alternative: wire the new model directly into Desktop Threads now; defer because that is roadmap item 03 and would combine capabilities.
3. Alternative: expose raw snapshot CRUD and let each Host manage transitions, journal sequence, and CAS; reject because it is a shallow interface that duplicates correctness logic across Desktop, Server, and tests.

## Main recommendation

Create `@llm-space/runtime/harness` as the Host-neutral seam. Its interface stays small—load a stored Session and commit one expected-version mutation batch—while the reference adapter hides lifecycle validation, single-active-Run rules, configuration immutability, append-only sequencing, atomic rollback, and compare-and-swap conflicts. This unblocks item 03 without prematurely integrating any Host.

## V1 capability definition

A Host can start a Runtime Run with a stable caller-owned ID and immutable configuration, move it through declared legal states across multiple transactions, inspect a versioned Session snapshot and ordered journal, supersede an active Run before starting a branch, and receive typed errors for illegal transitions, invariant violations, stale versions, or concurrent writers.

The Session snapshot schema is versioned independently from its monotonically increasing CAS version. A commit atomically persists the snapshot, any new immutable Run Configuration Snapshot, and all generated journal entries. Configuration identity covers the Agent snapshot, model/reasoning, execution mode, starting context, and tool configuration fingerprints already named by the roadmap/ADR.

Explicit non-goals: Desktop/Thread migration, Server repository, filesystem or database adapter, process recovery, cursor replay, external operation retry/idempotency, exactly-once behavior, distributed leases, compaction, approvals, general workflow DSL, or UI.

Stop conditions: stop if the contract requires a new data owner, persistence technology, distributed lock, security/permission rule, recovery guarantee, or integration change beyond the accepted roadmap and ADR.

## Acceptance and audit plan

- Focused tests exercise the public `@llm-space/runtime/harness` seam, every state, legal/illegal transitions, stable identity, ordered journal, immutable configuration, atomic rollback, stale writer, and simultaneous writer behavior.
- Run runtime TypeScript and focused lint first, then the full Bun suite, all package TypeScript projects, repository lint, browser-target runtime bundle, and renderer-only Vite build.
- Review the final diff for shallow interfaces, duplicate state logic, incorrect transition authority, mutable return values, journal gaps, and boundary creep.
- Product-design audit and CEF are not applicable because the item has no rendered product surface.

## Implementation plan and approval status

1. Add the `@llm-space/runtime/harness` export and a small public interface for Run state, Session records, mutation batches, and typed errors.
2. Implement legal transitions as one pure state-machine module.
3. Implement an in-memory Session Store adapter that applies mutation batches on isolated copies and publishes only after full validation.
4. Add the complete focused state/CAS/atomicity fixture matrix through the public seam.
5. Document the seam, verify all gates, review, then update capability/roadmap/task evidence only if `Done when` is fully demonstrated.

Approval status: approved by the user's explicit request to continue item 02 and by the existing roadmap/ADR implementation boundary.

## `$grill-me` requirements discussion

Not invoked. `LOOP_TASK.md` limits it to a newly discovered branch in the design tree. The target user/job, state vocabulary, persistence authority, V1 boundary, non-goals, acceptance matrix, and stop conditions are already explicit in `LOOP_PLAN.md`, `CONTEXT.md`, and ADR 0001. No new architecture, security, permission, persistence-technology, or data-ownership choice has appeared.

## Work performed

- Added the browser-safe `@llm-space/runtime/harness` package entrypoint without widening the authored root or Node host entrypoints.
- Added the explicit nine-state Runtime Run model and one legal-transition authority with typed illegal-transition errors.
- Added a small `SessionStore` interface with `load()` and expected-version `commit()` plus typed CAS and invariant failures.
- Added the in-memory reference adapter. It isolates each mutation batch, enforces one active Run, persists stable Run/configuration identity, sequences journal entries, deep-snapshots and freezes records, and publishes only after every mutation validates.
- Added focused public-seam fixtures for the full transition matrix, model/tool/wait continuity, completion, atomic supersede-and-branch, immutable configuration, rollback, illegal/terminal transitions, stale versions, and simultaneous writers.
- Documented the new entrypoint and intentionally did not integrate AgentSession, Desktop Threads, or Server persistence.

## Verification and product-design audit results

- Focused Runtime Run/Session Store suite: 7 pass, 0 fail, 106 assertions.
- Full Bun suite: 143 pass, 0 fail, 476 assertions.
- TypeScript: runtime, core, CLI, example Agent, and Desktop all passed with `tsc --noEmit`.
- Focused ESLint and repository-wide `bun run lint:check`: passed.
- Browser-safe harness entrypoint bundle: passed, producing an 8.35 KB temporary bundle outside the repository.
- Renderer-only `bun run vite build`: passed. The existing large-chunk advisory remains non-failing and unrelated.
- `git diff --check`: passed during final review.
- Product-design audit and CEF are not applicable because item 02 changes no UI, interaction, navigation, or rendered product behavior.
- No Electrobun packaging, DMG, patch-feed, signing, notarization, canary/stable build, pack, or release command was run.

## Review

The final review found no state authority duplicated across callers: transition legality lives in one module and transactional invariants live in the reference adapter behind the two-method Session Store interface. The interface gives future Desktop/Server adapters useful leverage while keeping persistence technology out of the contract. Stored inputs and outputs are deeply snapshotted/frozen; old configurations and journal entries cannot be changed; failed batches leave version, active Run, configuration, and journal untouched; and simultaneous writers cannot both publish the same expected version. AgentSession/Pi execution is unchanged. Remaining risks are explicit roadmap gaps: the in-memory adapter is not process-durable, no Host consumes the seam yet, and recovery/replay/external-operation uncertainty remain items 03/04/18 rather than hidden V1 claims.

## Follow-up product bets

1. Main next roadmap bet: item 03, adapt standalone and Agent Project Desktop Threads to this Session Store seam while preserving settled-step behavior.
2. Later alternative: item 04 safe-boundary recovery and authorized ordered replay after the Desktop integration proves the Host adapter.
3. Deferred alternative: a Server/database adapter; it remains out of scope until the Local Server spine reaches its declared item.

## Outcome

Completed. Roadmap item 02 satisfies its `Done when` clause and shared execution rules. The north-star target is met: all nine states and the complete legal-transition matrix are deterministic, one stable Run identity crosses model/tool/wait boundaries, and snapshot/configuration/journal atomicity plus stale/concurrent writer rejection are proven through the public seam. This bounded pass ends before item 03.
