# LLM Space

LLM Space is a workbench for developing, inspecting, and evaluating agents through editable Threads and portable Agent Projects.

## Language

**Desktop Thread**:
An editable, durable conversation used as the fast interactive surface for developing and debugging agent behavior in the desktop app.
_Avoid_: Harness session, agent run

**Settled step debugging**:
A Desktop Thread debugging mode in which a model turn ends durably at tool calls so their results may be supplied or edited later, after which inference continues without an additional user message.
_Avoid_: suspended run, pending approval, single-step execution

**Runtime Harness**:
The host-neutral execution boundary that coordinates durable agent sessions, debugging controls, and lifecycle policy while leaving provider-and-tool iteration to the runtime foundation.
_Avoid_: Pi AgentHarness, custom ReAct loop, Desktop loop

**Session Store**:
The Host-provided durable authority for a Runtime Session; Desktop Threads and Server repositories are different implementations of this same boundary.
_Avoid_: Pi Agent state, Pi Session, in-memory transcript

**Runtime Run**:
One logically continuous execution inside a Runtime Session, spanning model turns, tool steps, and durable waits until a terminal outcome is reached.
_Avoid_: stream request, provider call, model turn

**Run Journal**:
The ordered durable history of a Runtime Run's state transitions and externally observable execution events.
_Avoid_: Thread transcript, debug log, Pi event buffer

**Superseded Run**:
A terminal Runtime Run whose execution context was replaced by a later Thread edit or branch and therefore cannot be continued.
_Avoid_: cancelled run, edited run, resumed run

**Execution Mode**:
A Runtime Run policy that chooses which model-or-tool boundary becomes a durable wait; it does not select a different execution engine or create a new Run.
_Avoid_: runner, loop implementation, Run type

**Outcome-unknown Run**:
A terminal Runtime Run interrupted after an external operation may have started but before its outcome was durably recorded; it must not be replayed automatically.
_Avoid_: failed run, retryable run, cancelled run

**Run Configuration Snapshot**:
The immutable identity of the Agent artifact and execution-affecting configuration under which a Runtime Run proceeds.
_Avoid_: current project files, live settings, mutable defaults

**Agent Artifact**:
The immutable compiled identity of one Agent Project's source, dependencies, capabilities, schemas, runtime, and environment requirements; executable callbacks belong to its trusted compiled snapshot.
_Avoid_: source checkout, OCI image, container bundle

**Agent Deployment Image**:
A project-specific OCI image containing one Agent Artifact and the protected Bun Server; its OCI digest identifies the complete deployment while the Agent fingerprint retains execution lineage.
_Avoid_: serialized Agent Artifact, generic Runtime image, source image

**Agent Environment Requirement**:
A source-owned declaration that names required or optional runtime configuration or secret input without containing its value.
_Avoid_: credential, environment value, secret store

**OCI Runtime Profile**:
The fixed non-root network, environment, storage, health, and shutdown contract under which an Agent Deployment Image runs.
_Avoid_: Thread Runtime Profile, cloud target, deployment control plane

**Run Checkpoint**:
A durable debugging snapshot captured when a Runtime Run reaches a wait or terminal boundary; several checkpoints may belong to one Run.
_Avoid_: Runtime Run, new run, autosave

**Runtime Profile**:
The Thread-scoped choice of execution authority and location. It becomes immutable once the first Run starts; choosing a different profile always creates a new empty Thread rather than migrating transcript or Runtime authority.
_Avoid_: transport toggle, execution mode, per-run target

**Local Server Thread**:
An Agent Project Desktop Thread bound to one immutable compiled artifact and Server Session. The Server owns transcript and Runtime Run identity; Desktop keeps a constrained draft and non-secret inspection projection.
_Avoid_: Desktop Runtime Session, remote Server profile, migrated Thread

**Server Run Lineage**:
The non-secret artifact fingerprint, Server Session ID, and authoritative Server Run ID attached to a projected Run checkpoint for inspection.
_Avoid_: continuation credential, bearer key, canonical Trace
