# Inspectable Compiled Agent Artifact V1

- Status: done
- Outcome: completed
- Roadmap item: 05

## Trigger

The user requested continuation according to the accepted roadmap after items
01-04 completed. This pass started on `develop` at `5ad6854`, synchronized with
`origin/develop`, with a clean worktree. It owns only item-05 changes and stops
before item 06.

## Product stage and context

The trusted runtime compiler already discovers portable Agent source without
executing it, bundles and imports authored modules after trust, and returns an
immutable `AgentProjectSnapshot` with one opaque aggregate fingerprint. That
fingerprint is sufficient for hot reload but is not inspectable by source,
dependency, capability, schema, runtime, or environment-requirement category,
and it includes absolute paths. The Runtime Harness now needs a deterministic
Agent identity before Local Server work can safely consume one compiled Agent.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADR 0001, current
  git status/history, package scripts/exports, and Runtime README.
- The current capability map and item-02, item-03, and item-04 kaizen logs.
- Project discovery, trusted module bundling, compiler normalization,
  immutable snapshot copying, runtime consumption, focused compiler tests, and
  the canonical `apps/example-agent` fixture.
- Current Bun `1.3.14`, the committed text lockfile, and the existing bundled
  dependency hot-reload fixtures.

## External market scan

Access date: 2026-07-16.

Primary sources:

- https://github.com/opencontainers/image-spec/blob/main/descriptor.md
- https://slsa.dev/spec/v1.2/provenance
- https://bun.com/docs/pm/lockfile

OCI content descriptors define collision-resistant digests as content
identifiers and require SHA-256 support; SLSA provenance separates produced
subjects from declared and resolved build inputs; Bun documents `bun.lock` as
the committed text lockfile for repeatable dependency resolution. The relevant
table stakes are canonical content hashing, explicit input/dependency
inspection, and separation of build identity from runtime state. The true
local gap is narrower than OCI packaging, signing, provenance attestations, or
an SBOM: the existing in-memory compiled snapshot needs deterministic,
inspectable fingerprint sections. SLSA does not prescribe this product's Agent
capability taxonomy, so the local six-category roadmap contract remains the
authority.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed on 2026-07-16 from the trusted
  compiler, immutable snapshot, hot-reload tests, and item-01 through item-04
  acceptance evidence. Its visible gap is an inspectable deterministic
  compiled artifact identity.
- `Agent Project Activation`: confirmed on 2026-07-16 from the canonical
  example project, manifest confinement, and Desktop project activation
  evidence. Item 05 changes no trust, persistence, or UI behavior.
- `Runtime Recovery And Replay`: confirmed on 2026-07-16; item 05 supplies a
  stronger artifact identity but does not change Run or Session semantics.
- No rendered surface changes. Product-design audit and Electrobun CEF are not
  applicable.

## Product north-star metric

- Name: deterministic canonical Agent artifact completion without source
  repair.
- Why it matters: future Desktop, Local Server, and deployment profiles need to
  agree on exactly which compiled Agent they are running without depending on
  mutable source paths or live Session data.
- Baseline: canonical projects compile, snapshots are immutable, and one opaque
  fingerprint changes on source or bundled dependency edits, but absolute
  paths participate and the six required categories cannot be inspected.
- V1 target: two unchanged builds, including equivalent project copies at
  different absolute paths, produce identical overall and per-category
  fingerprints; the canonical example produces all six required sections with
  no manual source repair.
- Measurement: focused public compiler fixtures for determinism, category
  inspection, isolated changes, immutability, and secret exclusion; canonical
  example coverage; full Bun tests, all TypeScript projects, lint,
  browser-safe bundle, renderer-only Vite build, and final Standards/Spec
  review.
- Guardrails: preserve current compiler/runtime behavior and hot reload; no
  credentials, Sessions, Threads, Eval results, Server, container, cloud,
  signing, provenance service, SBOM product, packaging, or release commands.

## Candidate product opportunities

1. Main recommendation: deepen the existing immutable compiled snapshot with
   a versioned artifact descriptor containing canonical SHA-256 sections for
   source, bundled dependencies, capabilities, schemas, runtime, and
   environment requirements.
2. Alternative: introduce a separate serialized artifact file and loader now;
   defer because persistence/distribution format and migrations belong to
   later roadmap decisions and are unnecessary to satisfy item 05.
3. Alternative: generate a full SBOM plus signed SLSA provenance; defer because
   signing, attestation policy, deployment, and supply-chain distribution are
   explicitly outside this V1.

## Main recommendation

Keep `loadAgentProject()` and the trusted compiler as the only build path.
Attach one immutable, plain-data artifact descriptor to its existing snapshot.
Fingerprint portable source by logical path, bundled inputs separately from
entry source, compiled capability and TypeBox schema identities, the versioned
runtime contract, and the minimum Bun environment requirement. Hash canonical
sorted representations and keep raw credentials, callback results, Session
state, and host data out of the descriptor.

## V1 capability definition

A trusted Host can compile a canonical Agent Project once and inspect stable
logical entry IDs plus SHA-256 identities for all six required categories. The
overall artifact identity is derived only from the versioned descriptor, not
the absolute checkout path. Existing executable tools/connections and runtime
snapshots remain the consumption surface and remain immutable.

Explicit non-goals: artifact files or registries, source migration, SBOM,
signing/attestation, credential discovery, environment-variable declarations,
Session/Thread/Eval capture, Server protocol, OCI/container/cloud deployment,
or changes to trust and permission policy.

Stop conditions: stop if correctness requires a new artifact persistence
owner/format, credential or permission model, source schema, migration policy,
runtime loading architecture, or deployment decision beyond the accepted
roadmap and ADR.

## Acceptance and audit plan

- Prove repeated and cross-root deterministic builds, frozen artifact data,
  six populated/inspectable sections, and overall identity stability.
- Prove dependency-only, capability, and schema fixtures affect the expected
  sections without losing existing hot reload.
- Prove artifact descriptor JSON contains no callback-resolved credential,
  Session, Thread, or Eval payload.
- Run focused tests/TypeScript/lint, then full Bun tests, all package
  TypeScript checks, repository lint, browser-target runtime bundle,
  renderer-only Vite build, `git diff --check`, and two-axis diff review.
- Product-design audit and CEF are not applicable because there is no UI or
  interaction change.

## Implementation plan and approval status

1. Add the versioned plain-data artifact descriptor and canonical hashing
   helpers beside the existing Agent snapshot.
2. Extend trusted module compilation to report deterministic bundled-input
   fingerprints without exposing absolute paths or resolved credentials.
3. Have the existing compiler assemble all six sections and derive the legacy
   snapshot fingerprint from the artifact descriptor.
4. Add focused compiler and canonical example fixtures, document the contract,
   then complete all non-packaging verification and review.
5. Update capability/roadmap/task evidence only after the Done-when contract is
   proven, then commit and push only owned item-05 files.

Approval status: approved by the user's explicit request to continue according
to the roadmap and by the pre-approved item-05 boundary in `LOOP_TASK.md`.

## `$grill-me` requirements discussion

Not invoked. `LOOP_TASK.md` limits it to a newly discovered design-tree branch.
The user/job, six required categories, current compiler ownership, immutable
snapshot boundary, V1 non-goals, acceptance criteria, and stop conditions are
already fixed by the roadmap and current implementation evidence. No new
architecture, security, permission, persistence, or data-ownership decision
has appeared.

## Work performed

- Added a versioned plain-data artifact descriptor to trusted compiled Agent
  snapshots. It exposes six sorted SHA-256 sections and makes the existing
  snapshot fingerprint the descriptor's overall content identity.
- Captured every file-namespace Bun bundler input once through `onLoad` and
  supplied those exact buffers to both compilation and artifact hashing.
  Logical project/package IDs replace absolute paths, and a self-editing source
  fixture proves the executable and descriptor cannot observe different entry
  bytes.
- Separated portable entry source from bundled dependency fingerprints. Local
  imported helpers identify as project-relative dependencies, retain existing
  hot reload, and change the dependency/overall identity without changing the
  source, capability, schema, runtime, or environment sections.
- Fingerprinted compiled Agent/instruction/tool/connection/skill capabilities
  and local tool input/output schemas. The compiled tool snapshot now retains
  its optional authored output schema for inspection and validation remains
  unchanged.
- Fingerprinted the exact Bun compiler, exact resolved Pi/MCP/TypeBox package
  versions, every non-test production TypeScript source under the runtime
  package, and the minimum Bun environment requirement.
- Kept synthetic standalone runtime snapshots artifact-optional while the
  trusted compiler returns `CompiledAgentProjectSnapshot` with a required
  artifact. This avoids manufacturing an Agent Project artifact for ordinary
  Threads.
- Extended the canonical example contract and runtime documentation. The
  descriptor contains logical IDs and hashes only; credentials, callback
  results, URLs, Sessions, Thread history, and Eval results are absent.

## Verification and product-design audit results

- Focused compiler plus canonical example acceptance: 18 tests, 83 assertions,
  0 failures. Coverage includes six-category inspection, repeated/cross-root
  equality, deep freezing, dependency-only drift, capability/schema isolation,
  same-byte self-edit behavior, hot reload, and credential/URL exclusion.
- Full repository suite: 171 tests, 603 assertions, 0 failures across 39 files.
- TypeScript passed for runtime, core, CLI, example Agent, and Desktop.
- Touched-file ESLint and repository-wide `bun run lint:check` passed.
- Browser-target root runtime and Runtime Harness bundles passed at 1.62 KB
  and 22.48 KB. Renderer-only `bun run vite build` passed; its existing large
  chunk advisory remains non-failing and unrelated.
- `git diff --check` passed. Product-design audit and Electrobun CEF are not
  applicable because no UI, interaction, navigation, or rendered state changed.
- No Electrobun packaging, DMG, patch-feed, signing, notarization,
  canary/stable build, pack, release validation, or release command was run.

## Review

The initial Standards and Spec reviews both found the same consistency risk:
entry/dependency files were reread after Bun compilation, so a concurrent edit
could make immutable metadata describe different bytes than the executable.
The source-snapshot plugin now owns one captured buffer per actual bundler
input and supplies it to both consumers; the self-edit fixture proves the fix.

The Spec review also found that catalog ranges and package version `0.1.0`
were not a complete runtime identity. Runtime fingerprints now include exact
resolved dependency versions and all non-test production runtime source
content in addition to exact Bun. Final Standards and Spec re-reviews report
no remaining findings. There is no scope creep into artifact persistence,
credentials, Server, container, cloud, signing, or attestations.

## Follow-up product bets

1. Item 06 Local Server consumption of one compiled artifact.
2. Item 09 canonical template and capability presets against the same build
   contract.
3. Item 11 explicit source/artifact migrations only after a real schema
   evolution exists.

## Outcome

Completed. Roadmap item 05 satisfies its `Done when`: canonical projects build
without manual source repair into immutable inspectable descriptors containing
source, dependency, capability, schema, runtime, and environment-requirement
fingerprints. The north-star target is met across repeated and equivalent
cross-root builds, and the artifact identity remains coupled to the exact
compiled inputs. This bounded pass stops before item 06.
