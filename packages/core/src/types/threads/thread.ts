import { type Static, Type } from "typebox";

import {
  LockedSandboxAttachmentMessageIds,
  ThreadSandboxAttachments
} from "./sandbox-attachment";
import { Message, ModelUsage } from "../messages";
import { ModelConfig } from "../models";
import { normalizeTools, Tool } from "../tools";

export const ThreadCurrentDateVariableFormat = Type.Union([
  Type.Literal("readable-date"),
  Type.Literal("iso-date"),
  Type.Literal("local-date-time")
]);
export type ThreadCurrentDateVariableFormat = Static<
  typeof ThreadCurrentDateVariableFormat
>;

export const ThreadSkillsVariableFormat = Type.Union([
  Type.Literal("xml"),
  Type.Literal("markdown-list")
]);
export type ThreadSkillsVariableFormat = Static<
  typeof ThreadSkillsVariableFormat
>;

export const ThreadCurrentDateVariable = Type.Object({
  type: Type.Literal("currentDate"),
  format: ThreadCurrentDateVariableFormat
});
export type ThreadCurrentDateVariable = Static<
  typeof ThreadCurrentDateVariable
>;

export const ThreadSkillsVariable = Type.Object({
  type: Type.Literal("skills"),
  skillNames: Type.Array(Type.String()),
  format: ThreadSkillsVariableFormat,
  indent: Type.Number()
});
export type ThreadSkillsVariable = Static<typeof ThreadSkillsVariable>;

export const ThreadVariable = Type.Union([
  ThreadCurrentDateVariable,
  ThreadSkillsVariable
]);
export type ThreadVariable = Static<typeof ThreadVariable>;

export const ThreadVariables = Type.Record(Type.String(), ThreadVariable);
export type ThreadVariables = Static<typeof ThreadVariables>;

/**
 * Custom-variable value set. The desktop app only writes the `default` bucket.
 */
export const ThreadVariableVariants = Type.Object({
  active: Type.String(),
  variants: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.String())
  )
});
export type ThreadVariableVariants = Static<typeof ThreadVariableVariants>;

/**
 * Per-context runtime snapshot data. Prompt variable values are keyed by a
 * stable prompt place (for example `systemPrompt`, `message:<id>:text`, or a
 * tool result key) so old conversation prefixes keep using the value they were
 * first run with.
 */
export const ThreadContextSnapshot = Type.Object({
  variables: Type.Optional(
    Type.Record(Type.String(), Type.Record(Type.String(), Type.String()))
  )
});
export type ThreadContextSnapshot = Static<typeof ThreadContextSnapshot>;

/**
 * The context of a thread, including the system prompt, messages, and tools.
 */
export const ThreadContext = Type.Object({
  /**
   * The system prompt of the thread.
   */
  systemPrompt: Type.Optional(Type.String()),

  /**
   * The tools of the thread.
   */
  tools: Type.Optional(Type.Array(Tool)),

  /**
   * Built-in prompt variables keyed by their placeholder name.
   */
  variables: Type.Optional(ThreadVariables),

  /**
   * Custom-variable values keyed by the built-in `default` bucket.
   */
  variableVariants: Type.Optional(ThreadVariableVariants),

  /**
   * Runtime snapshot values captured while running the thread.
   */
  snapshot: Type.Optional(ThreadContextSnapshot),

  /**
   * The messages of the thread.
   */
  messages: Type.Optional(Type.Array(Message))
});
export type ThreadContext = Static<typeof ThreadContext>;

export const ThreadAgentRuntimeProvenance = Type.Object({
  projectId: Type.String(),
  snapshot: Type.String(),
  definitionFingerprint: Type.String(),
  modelSource: Type.Union([
    Type.Literal("agent"),
    Type.Literal("threadOverride")
  ])
});
export type ThreadAgentRuntimeProvenance = Static<
  typeof ThreadAgentRuntimeProvenance
>;

export const ThreadRuntimeProfile = Type.Union([
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("desktopDirect")
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("desktopSandbox")
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("localServer"),
    artifactFingerprint: Type.String(),
    serverSessionId: Type.Optional(Type.String())
  })
]);
export type ThreadRuntimeProfile = Static<typeof ThreadRuntimeProfile>;

export const ThreadServerRunLineage = Type.Object({
  profile: Type.Literal("localServer"),
  artifactFingerprint: Type.String(),
  sessionId: Type.String(),
  runId: Type.String()
});
export type ThreadServerRunLineage = Static<typeof ThreadServerRunLineage>;

export const ThreadOutputContractSnapshot = Type.Object({
  name: Type.String(),
  schemaFingerprint: Type.String()
});
export type ThreadOutputContractSnapshot = Static<
  typeof ThreadOutputContractSnapshot
>;

export const ThreadStructuredOutput = Type.Object({
  contract: Type.String(),
  schemaFingerprint: Type.String(),
  value: Type.Unknown()
});
export type ThreadStructuredOutput = Static<typeof ThreadStructuredOutput>;

export const ThreadStructuredOutputFailure = Type.Object({
  contract: Type.String(),
  schemaFingerprint: Type.String(),
  code: Type.Union([
    Type.Literal("structured_output_invalid"),
    Type.Literal("structured_output_missing"),
    Type.Literal("structured_output_too_large")
  ])
});
export type ThreadStructuredOutputFailure = Static<
  typeof ThreadStructuredOutputFailure
>;

const THREAD_FIELDS = {
  /**
   * The title of the thread.
   */
  title: Type.Optional(Type.String()),

  /**
   * The model configuration of the thread. Optional — a thread may be created
   * without a model; the UI resolves a fallback (first available model) for
   * display/running and only persists a model once the user picks one.
   */
  model: Type.Optional(ModelConfig),

  /** Source-declared output name selected for the next Agent Project Turn. */
  outputContract: Type.Optional(Type.String()),

  /** Effective Agent runtime identity and model provenance for saved runs. */
  agentRuntime: Type.Optional(ThreadAgentRuntimeProvenance),

  /** Host-owned staged Turn inputs, keyed outside the message transcript. */
  sandboxAttachments: Type.Optional(ThreadSandboxAttachments),

  /** Message ids whose Host-approved Sandbox descriptors can no longer change. */
  lockedSandboxAttachmentMessageIds: Type.Optional(
    LockedSandboxAttachmentMessageIds
  ),

  /**
   * The context of the thread, including the system prompt, messages, and tools.
   */
  context: Type.Optional(ThreadContext)
};

/**
 * A completed-run snapshot of a thread. It intentionally excludes run and
 * evaluation metadata so persisted run history cannot recursively contain
 * itself or pin mutable evaluation definitions.
 */
export const ThreadSnapshot = Type.Object(THREAD_FIELDS);
export type ThreadSnapshot = Static<typeof ThreadSnapshot>;

export const ThreadRuntimeRunState = Type.Union([
  Type.Literal("runningModel"),
  Type.Literal("runningTools"),
  Type.Literal("waitingForToolResults"),
  Type.Literal("waitingForContinue"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("superseded"),
  Type.Literal("outcomeUnknown")
]);
export type ThreadRuntimeRunState = Static<typeof ThreadRuntimeRunState>;

/** Runtime Harness identity attached to one settled debugging checkpoint. */
export const ThreadRuntimeCheckpoint = Type.Object({
  runId: Type.String(),
  state: ThreadRuntimeRunState,
  checkpointOrder: Type.Integer({ minimum: 1 }),
  continuationFingerprint: Type.String(),

  /** Non-secret Local Server authority attached to a projected checkpoint. */
  server: Type.Optional(ThreadServerRunLineage),
  outputContract: Type.Optional(ThreadOutputContractSnapshot)
});
export type ThreadRuntimeCheckpoint = Static<typeof ThreadRuntimeCheckpoint>;

/**
 * A completed run in a thread's durable debug timeline.
 */
export const ThreadRunSnapshot = Type.Object({
  /**
   * Stable ID for referencing this run from evaluation records. Older files may
   * not have one; the desktop store backfills a deterministic ID on load.
   */
  id: Type.Optional(Type.String()),

  /**
   * Thread state captured when the run completed.
   */
  thread: ThreadSnapshot,

  /**
   * Provider-reported token usage produced by this completed run only.
   *
   * Older run snapshots do not have this field; clients can fall back to
   * summing the snapshot when they need a best-effort display for old files.
   */
  usage: Type.Optional(ModelUsage),

  /** Stable Runtime Run grouping and settled-boundary identity. */
  runtime: Type.Optional(ThreadRuntimeCheckpoint),

  /** Runtime-validated terminal JSON value, when a contract was selected. */
  structuredOutput: Type.Optional(ThreadStructuredOutput),
  structuredOutputFailure: Type.Optional(ThreadStructuredOutputFailure),

  /**
   * Epoch milliseconds (`Date.now()`) when the run completed.
   */
  timestamp: Type.Number()
});
export type ThreadRunSnapshot = Static<typeof ThreadRunSnapshot>;

/** One ordered dimension in a reusable manual evaluation rubric. */
export const ThreadEvaluationCriterion = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String())
});
export type ThreadEvaluationCriterion = Static<
  typeof ThreadEvaluationCriterion
>;

/** A reusable, thread-owned manual evaluation rubric definition. */
export const ThreadEvaluationRubric = Type.Object({
  id: Type.String(),
  name: Type.String(),
  criteria: Type.Array(ThreadEvaluationCriterion, {
    minItems: 2,
    maxItems: 6
  }),
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: Type.Number(),
  updatedAt: Type.Number()
});
export type ThreadEvaluationRubric = Static<typeof ThreadEvaluationRubric>;

/** Immutable rubric structure copied into a saved evaluation. */
export const ThreadEvaluationRubricSnapshot = Type.Object({
  id: Type.String(),
  name: Type.String(),
  criteria: Type.Array(ThreadEvaluationCriterion, {
    minItems: 2,
    maxItems: 6
  }),
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
});
export type ThreadEvaluationRubricSnapshot = Static<
  typeof ThreadEvaluationRubricSnapshot
>;

/** A single criterion score for one run. Higher is better. */
export const ThreadEvaluationCriterionScore = Type.Object({
  criterionId: Type.String(),
  score: Type.Integer({ minimum: 1, maximum: 5 })
});
export type ThreadEvaluationCriterionScore = Static<
  typeof ThreadEvaluationCriterionScore
>;

/** All criterion scores assigned to one stable run ID. */
export const ThreadEvaluationRunScores = Type.Object({
  runId: Type.String(),
  scores: Type.Array(ThreadEvaluationCriterionScore, {
    minItems: 2,
    maxItems: 6
  })
});
export type ThreadEvaluationRunScores = Static<
  typeof ThreadEvaluationRunScores
>;

export const ThreadEvaluationVerdict = Type.Union([
  Type.Literal("leftBetter"),
  Type.Literal("rightBetter"),
  Type.Literal("tie"),
  Type.Literal("pass"),
  Type.Literal("fail")
]);
export type ThreadEvaluationVerdict = Static<typeof ThreadEvaluationVerdict>;

/**
 * A manual evaluation verdict comparing two durable run snapshots.
 */
const THREAD_EVALUATION_FIELDS = {
  /**
   * Stable ID for updating this evaluation record.
   */
  id: Type.String(),

  /**
   * The run shown on the left side of the comparison.
   */
  leftRunId: Type.String(),

  /**
   * The run shown on the right side of the comparison.
   */
  rightRunId: Type.String(),

  /**
   * User's verdict for this comparison.
   */
  verdict: ThreadEvaluationVerdict,

  /**
   * Optional human note explaining the decision.
   */
  note: Type.Optional(Type.String()),

  /**
   * Epoch milliseconds when the evaluation was created.
   */
  createdAt: Type.Number(),

  /**
   * Epoch milliseconds when the evaluation was last updated.
   */
  updatedAt: Type.Number()
};

const ThreadLegacyEvaluation = Type.Object({
  ...THREAD_EVALUATION_FIELDS,
  rubric: Type.Optional(Type.Never()),
  runScores: Type.Optional(Type.Never())
});

const ThreadStructuredEvaluation = Type.Object({
  ...THREAD_EVALUATION_FIELDS,

  /** Immutable rubric structure used by this evaluation. */
  rubric: ThreadEvaluationRubricSnapshot,

  /** Complete per-run criterion scores for `rubric`, keyed by stable run ID. */
  runScores: Type.Array(ThreadEvaluationRunScores, {
    minItems: 2,
    maxItems: 2
  })
});

/** A legacy overall verdict or a complete structured manual evaluation. */
export const ThreadEvaluation = Type.Union([
  ThreadLegacyEvaluation,
  ThreadStructuredEvaluation
]);
export type ThreadEvaluation = Static<typeof ThreadEvaluation>;

/**
 * The definition of a thread.
 */
export const Thread = Type.Object({
  ...THREAD_FIELDS,

  /** Immutable execution authority for an Agent Project Thread. */
  runtimeProfile: Type.Optional(ThreadRuntimeProfile),

  /**
   * Recent completed runs for debugging and replay. Entries are bounded by the
   * desktop store and store de-nested thread snapshots.
   */
  runHistory: Type.Optional(Type.Array(ThreadRunSnapshot)),

  /**
   * Manual evaluations created by comparing durable run snapshots.
   */
  evaluations: Type.Optional(Type.Array(ThreadEvaluation)),

  /** Reusable manual evaluation rubrics owned by this thread. */
  evaluationRubrics: Type.Optional(Type.Array(ThreadEvaluationRubric)),

  /**
   * Host-owned Runtime Harness Session Store record. Core intentionally keeps
   * this opaque so browser-safe Thread types do not depend on the runtime
   * package; Desktop validates it through `@llm-space/runtime/harness`.
   */
  runtimeSession: Type.Optional(Type.Unknown())
});
export type Thread = Static<typeof Thread>;

export function normalizeThread(thread: Thread): Thread {
  const context = thread.context;
  const tools = context?.tools;
  const runHistory = thread.runHistory;
  let next = thread;

  const runtimeProfile = normalizeThreadRuntimeProfile(thread.runtimeProfile);
  if (thread.runtimeProfile !== undefined && runtimeProfile === undefined) {
    const { runtimeProfile: _runtimeProfile, ...withoutRuntimeProfile } = next;
    next = withoutRuntimeProfile;
  } else if (runtimeProfile && runtimeProfile !== thread.runtimeProfile) {
    next = { ...next, runtimeProfile };
  }

  if (tools) {
    const normalizedTools = normalizeTools(tools);
    if (!_sameTools(tools, normalizedTools)) {
      next = {
        ...next,
        context: { ...context, tools: normalizedTools }
      };
    }
  }

  if (runHistory) {
    let changed = false;
    const normalizedRunHistory = runHistory.map(run => {
      const normalizedThread = normalizeThread(run.thread);
      if (normalizedThread !== run.thread) {
        changed = true;
        return { ...run, thread: normalizedThread };
      }
      return run;
    });
    if (changed) {
      next = { ...next, runHistory: normalizedRunHistory };
    }
  }

  return next;
}

/** Resolve persisted Runtime Profile data, defaulting absent data to direct. */
export function getThreadRuntimeProfile(thread: Thread): ThreadRuntimeProfile {
  return normalizeThreadRuntimeProfile(thread.runtimeProfile) ?? {
    version: 1,
    type: "desktopDirect"
  };
}

/** Validate untrusted persisted profile metadata without exposing credentials. */
export function normalizeThreadRuntimeProfile(
  value: unknown
): ThreadRuntimeProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return undefined;
  }
  if (record.type === "desktopDirect") {
    return { version: 1, type: "desktopDirect" };
  }
  if (record.type === "desktopSandbox") {
    return { version: 1, type: "desktopSandbox" };
  }
  if (record.type !== "localServer") {
    return undefined;
  }
  const artifactFingerprint = _trimmedString(record.artifactFingerprint);
  const serverSessionId = record.serverSessionId === undefined
    ? undefined
    : _trimmedString(record.serverSessionId);
  if (
    !artifactFingerprint
    || (record.serverSessionId !== undefined && !serverSessionId)
  ) {
    return undefined;
  }
  return {
    version: 1,
    type: "localServer",
    artifactFingerprint,
    ...(serverSessionId ? { serverSessionId } : {})
  };
}

function _trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function _sameTools(
  left: readonly unknown[],
  right: readonly unknown[]
): boolean {
  return left.every((tool, index) => tool === right[index]);
}
