# Thread Promotion Contract Decision

- Status: done
- Outcome: replanned
- Roadmap item: 10

## Context

Item 10 was blocked because Desktop Thread variables, tools, transcript/run
state, and manual evaluations did not have one truthful portable Agent source
mapping. The owner resumed the required one-question-at-a-time decision session
after the initial bounded pass stopped before implementation.

## Evidence

- Rechecked the current Thread variable and tool schemas, Project-tool source
  identities, Desktop MCP transports, Runtime authored definitions, Runtime
  Session ownership, evaluation schema, roadmap dependencies, and clean scoped
  git state.
- Researched Eve's current primary documentation and source at fixed commit
  `f7c69b1a2ad044a6ba89db7bb6241c469d3ef101`; the evidence is recorded in
  `.agents/research/2026-07-17-eve-state-integration.md`.
- Confirmed that Eve is useful as a separation model—source declaration,
  Session-owned live state, and Turn-scoped resolution—but supplies no
  compatible Thread-promotion source format and must not become a dependency.

## Accepted contract

- Promotion is a compiler-like, preview-first, atomic operation. Every field is
  materialized, intentionally excluded, or blocking before any write.
- Agent Variables, trusted Turn context, durable Session State, transcript, and
  external long-term memory remain distinct. Live Thread snapshots and Session
  state never migrate.
- Project tools reuse matching source and its local dependency closure. Missing
  function implementations require an AI draft from the Thread model, user
  review/edit, successful Runtime compile/load, and explicit publication
  confirmation; fake/TODO implementations cannot pass.
- Filesystem/bash tools and stdio MCP execute only through Sandbox. There is no
  Desktop Direct, Local Server, process-spawn, or direct Host filesystem
  fallback when Sandbox is required.
- Agent-, tool-, and connection-local environment requirements aggregate with
  exact duplicate merging and conflict failure. Environment references never
  copy values; exact literal values are visible and potentially sensitive
  values require explicit confirmation.
- Conversation examples have no current executable consumer and are removed
  from item 10 rather than defining a premature fixture protocol. Item 29 owns
  portable Eval cases.
- Selected evaluation rubric names, criteria, and descriptions may become
  non-executable `agent/evaluation-intent.md`; scores, verdicts, notes, Runs,
  and evaluation history remain in the original Thread.
- Publication creates a fresh empty Project Thread and Session identity. The
  original Thread remains independent.
- Desktop uses a temporary Analyze -> Resolve -> Review & Publish preview tab
  with the complete target file tree, exact diff, confirmations, diagnostics,
  destination, progress, and rollback-safe publication.

## Roadmap consequence

ADR 0006 records the accepted architecture. Item 10 now depends on items 12,
13, 16, and 17 in addition to item 09, so it is not dependency-ready. The next
bounded roadmap pass should select item 12, the lowest numbered unchecked item
whose dependencies are complete. Item 10 remains unchecked and no product code
or Loopany configuration changed in this decision session.
