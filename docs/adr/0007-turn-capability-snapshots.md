---
status: accepted
---

# Resolve Eve-shaped capabilities into immutable Turn snapshots

LLM Space will use Eve-shaped `defineDynamic({ events: { "turn.started":
... } })` authoring for dynamic models and tools. Resolution happens once for
each external Turn from Host-verified context and, outside manual debugging, a
read-only view of Session state. A Turn never changes capabilities between
Pi's internal model/tool steps.

`agent.ts` keeps Eve's model shape: a dynamic model has a required static
`fallback`, and may return a model selector or `{ model, modelOptions }`.
Resolver failure or `null` uses the fallback. Public `modelOptions` normalize
to an allowlisted Pi stream-option subset: `temperature`, `maxTokens`,
`reasoning`, `thinkingBudgets`, `transport`, `cacheRetention`, `timeoutMs`,
`websocketConnectTimeoutMs`, `maxRetries`, and `maxRetryDelayMs`. Credentials,
headers, environment values, Session ids, metadata, signals, callbacks, and
unknown/provider-specific options remain Host-owned and never enter source or
snapshots.

Tool files may export Eve-shaped dynamic resolvers returning one `defineTool`,
a bare-name map of `defineTool` entries, or `null`. A dynamic tool may replace
an authored tool by name; two dynamic contributions claiming the same name are
an error. One resolver failure removes only its contribution. Dynamic execute
functions must be inline so compilation can assign a stable step identity and
capture JSON closure values. The durable snapshot stores definitions, step
identities, and closure values, never executable source. Restart reconstructs
the callback from the same artifact without re-running the resolver; missing
steps, unserializable closures, or artifact drift fail closed. Approval remains
item 19 and is not an item-14 tool field.

Connections remain Eve-compatible static compiled definitions. Item 14 does
not add dynamic connection authoring or activation. A Turn snapshot records
only logical connection provenance and the remote tools actually exposed to
the model. URL values, auth, headers, and environment values remain outside the
snapshot. Advanced discovery refresh and schema-drift handling remain item 23.

Every Host must provide an immutable, serializable
`AgentCapabilityPolicy`; there is no implicit allow-all policy. Policy grants
compiled contribution identities, model/reasoning choices, and safe option
bounds. By default, Turn requests may override resolver choices only within the
compiled source authority and Host policy. Desktop Direct and Desktop Sandbox
may mark an explicit Project Thread model override as Host-authoritative: this
permits its model, reasoning, and safe model options to differ from Agent source
while still requiring the same Host-policy and intrinsic-value validation.
Local Server and ordinary Runtime callers retain the authored-authority
intersection. Policy or request violations fail before Pi runs. A selected
unavailable model or connection discovery failure also fails before Pi. Pi's
existing context normalization is the only allowed `maxTokens` adjustment; all
other invalid or unsupported values fail rather than clamp.

The snapshot's `modelOptions.maxTokens` is the effective Turn-level configured
cap after authored values, resolver output, an explicit Thread override, and
Host policy intersect. Pi may reduce that cap against the changing model
context at each provider call; this provider-call calculation is not a Turn
capability mutation and Runtime does not persist a competing provider clamp.

Instructions and capabilities resolve from one frozen Turn view and commit
atomically through Session Store CAS. The capability snapshot contains the
Agent fingerprint, policy and request fingerprints, effective model/reasoning,
tool definition and provenance fingerprints, static connection tool surface,
normalized safe model options, and its own integrity fingerprint. The journal
records only Turn id plus fingerprint. Details never enter transcript, Pi
events, or streamed protocol messages.

Manual debugging still records this snapshot but exposes no state scope and
keeps every tool deferred. A persisted snapshot is immutable for the Turn. If
current Host policy no longer authorizes it at continuation time, Runtime does
not re-resolve or downgrade it; the Run fails with `hostPolicyChanged` and a
new Turn or branch is required.

## Consequences

Compiled authored resolver/contribution identity is the default source
authority; no separate `maximum` authoring API is introduced. An explicit
Desktop Thread override transfers model-configuration choice to the Host but
does not weaken Host policy or grant tool authority. Dynamic code discovery,
runtime plugin
installation, arbitrary path loading, permission escalation, dynamic
connections, approval, Sandbox, advanced MCP lifecycle, Trace UI, and
automatic provider/tool retry remain out of scope.
