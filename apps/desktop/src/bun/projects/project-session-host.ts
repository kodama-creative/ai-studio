import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { loadAgent } from "@llm-space/agent/loader";
import {
  createHarness,
  type AgentSession,
  type ModelTurnEngine,
  type PreparedAgent,
  type SessionEventCursor,
} from "@llm-space/harness";
import { createFileSessionStorage } from "@llm-space/harness/storage/file";

import type {
  AgentProjectView,
  HarnessSessionTransport,
  ProjectThread,
  ProjectThreadSession,
} from "../../shared/agent-project";

import type { AgentProject } from "./agent-project";
import { getFileErrorCode, writePrivateJson } from "./project-file-utils";
import { ProjectSandbox } from "./project-sandbox";

export interface CreateProjectSessionHostOptions {
  readonly project: AgentProject;
  readonly engine: ModelTurnEngine;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface ProjectSessionHost extends HarnessSessionTransport {
  readonly project: AgentProjectView;
}

export async function createProjectSessionHost(
  options: CreateProjectSessionHostOptions
): Promise<ProjectSessionHost> {
  const generation = await loadAgent({ startPath: options.project.rootPath });
  const storage = createFileSessionStorage(options.project.harnessStateRoot);
  const harness = createHarness({
    commandQueue: storage.commandQueue,
    engine: options.engine,
    repository: storage.repository,
    eventLog: storage.eventLog,
    getSandbox: () =>
      Promise.resolve(new ProjectSandbox(options.project.rootPath)),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
  });
  const agent = await harness.prepare(generation);
  return new ProjectSessionHostImpl(options.project, agent, options.clock ?? Date.now);
}

class ProjectSessionHostImpl implements ProjectSessionHost {
  readonly project: AgentProjectView;
  private readonly _sessions = new Map<string, AgentSession>();

  constructor(
    private readonly _project: AgentProject,
    private readonly _agent: PreparedAgent,
    private readonly _clock: () => number
  ) {
    this.project = {
      id: _project.id,
      name: _project.name,
      rootPath: _project.rootPath,
      agentRoot: _project.agentRoot,
      agentId: _agent.agentId,
      generationId: _agent.generationId,
    };
  }

  async listThreads(): Promise<readonly ProjectThread[]> {
    let names: string[];
    try {
      names = await readdir(this._project.threadRoot);
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const threads = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this._readThreadFile(join(this._project.threadRoot, name)))
    );
    return threads.toSorted(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
  }

  async createThread(
    input: { readonly title?: string } = {}
  ): Promise<ProjectThreadSession> {
    const session = await this._agent.createSession();
    const now = this._clock();
    const thread: ProjectThread = {
      id: `thread_${crypto.randomUUID().replaceAll("-", "")}`,
      title: input.title?.trim() || "New Thread",
      sessionId: session.id,
      agentId: this._agent.agentId,
      createdAt: now,
      updatedAt: now,
    };
    await this._writeThread(thread);
    this._sessions.set(session.id, session);
    return { thread, snapshot: await session.snapshot() };
  }

  async attachThread(threadId: string): Promise<ProjectThreadSession> {
    const thread = await this._thread(threadId);
    let session: AgentSession;
    try {
      session = await this._session(thread.sessionId);
    } catch (error) {
      const message = _errorMessage(error);
      if (message.includes(" belongs to ") && message.includes(", not ")) {
        throw new Error(
          "The agent changed after this thread was created. Start a new thread to use the current agent generation.",
          { cause: error }
        );
      }
      throw error;
    }
    return { thread, snapshot: await session.snapshot() };
  }

  async send(sessionId: string, message: string) {
    if (message.trim().length === 0) throw new Error("Message must not be empty.");
    const session = await this._session(sessionId);
    const receipt = await session.submit({ message });
    const thread = (await this.listThreads()).find(
      (candidate) => candidate.sessionId === sessionId
    );
    if (thread !== undefined) {
      await this._writeThread({
        ...thread,
        title:
          thread.title === "New Thread" ? _threadTitle(message) : thread.title,
        updatedAt: this._clock(),
      });
    }
    return receipt;
  }

  async cancel(sessionId: string): Promise<void> {
    await (await this._session(sessionId)).cancel();
  }

  async snapshot(sessionId: string) {
    return (await this._session(sessionId)).snapshot();
  }

  async *events(sessionId: string, cursor: SessionEventCursor = {}) {
    const session = await this._session(sessionId);
    yield* session.events({ ...cursor, follow: cursor.follow ?? true });
  }

  private async _session(sessionId: string): Promise<AgentSession> {
    const active = this._sessions.get(sessionId);
    if (active !== undefined) return active;
    const ownsSession = (await this.listThreads()).some(
      (thread) => thread.sessionId === sessionId
    );
    if (!ownsSession) {
      throw new Error(`Session "${sessionId}" does not belong to this project.`);
    }
    const session = await this._agent.attachSession(sessionId);
    if (session === undefined) throw new Error(`Session "${sessionId}" was not found.`);
    this._sessions.set(sessionId, session);
    return session;
  }

  private async _thread(threadId: string): Promise<ProjectThread> {
    const thread = (await this.listThreads()).find(
      (candidate) => candidate.id === threadId
    );
    if (thread === undefined) throw new Error(`Thread "${threadId}" was not found.`);
    return thread;
  }

  private async _writeThread(thread: ProjectThread): Promise<void> {
    const destination = join(this._project.threadRoot, `${thread.id}.json`);
    await writePrivateJson(destination, thread);
  }

  private async _readThreadFile(path: string): Promise<ProjectThread> {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!_isProjectThread(value)) {
      throw new Error(`Invalid project thread descriptor in "${path}".`);
    }
    if (value.agentId !== this._agent.agentId) {
      throw new Error(
        `Thread "${value.id}" belongs to agent "${value.agentId}", not "${this._agent.agentId}".`
      );
    }
    return value;
  }
}

function _isProjectThread(value: unknown): value is ProjectThread {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.agentId === "string" &&
    typeof item.createdAt === "number" &&
    Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt)
  );
}

function _threadTitle(message: string): string {
  const normalized = message.trim().replaceAll(/\s+/gu, " ");
  return normalized.length <= 48 ? normalized : `${normalized.slice(0, 47)}…`;
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
