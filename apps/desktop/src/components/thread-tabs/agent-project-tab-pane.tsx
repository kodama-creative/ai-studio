import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ModelConfig } from "@llm-space/core";
import { uuid } from "@llm-space/core";
import {
  BotIcon,
  BracesIcon,
  CircleStopIcon,
  FlaskConicalIcon,
  MessageSquareCodeIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { useModels } from "@/components/model-provider";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import type {
  AgentProjectMessageView,
  AgentProjectView,
  AgentSessionKind,
  StreamAgentProjectResponsePayload,
} from "@/shared/agent-project";

function _AgentProjectTabPane({
  path,
  active,
  refreshNonce,
}: {
  path: string;
  active: boolean;
  refreshNonce: number;
}) {
  const [project, setProject] = useState<AgentProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"build" | "test">("build");
  const [selectedFile, setSelectedFile] = useState("instructions.md");
  const providers = useModels();

  const refresh = useCallback(async () => {
    try {
      const next = await electrobun.rpc?.request.agentProjectInspect({
        projectPath: path,
      });
      if (next) {
        setProject(next);
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [path]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshNonce]);

  const modelOptions = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.id}:${model.id}`,
          label: `${provider.name} / ${model.name}`,
        }))
      ),
    [providers]
  );

  const setModel = useCallback(
    async (value: string) => {
      const separator = value.indexOf(":");
      if (separator === -1) return;
      const model: ModelConfig = {
        provider: value.slice(0, separator),
        id: value.slice(separator + 1),
      };
      const next = await electrobun.rpc?.request.agentProjectSetModel({
        projectPath: path,
        model,
      });
      if (next) setProject(next);
    },
    [path]
  );

  const modelValue = project?.model
    ? `${project.model.provider}:${project.model.id}`
    : "";

  return (
    <section
      className={cn("absolute inset-0 flex flex-col", !active && "hidden")}
      aria-hidden={!active}
    >
      <header className="border-border/70 flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <BotIcon className="text-primary size-4" />
          <span className="truncate text-sm font-medium">
            {project?.name ?? path}
          </span>
          <span className="rounded border px-1.5 py-0.5 text-[10px]">
            Agent Project
          </span>
        </div>
        <div className="bg-muted ml-2 flex rounded-md p-0.5">
          <Button
            size="sm"
            variant={mode === "build" ? "secondary" : "ghost"}
            className="h-6 px-2 text-xs"
            onClick={() => setMode("build")}
          >
            <BracesIcon className="size-3" /> Build
          </Button>
          <Button
            size="sm"
            variant={mode === "test" ? "secondary" : "ghost"}
            className="h-6 px-2 text-xs"
            onClick={() => setMode("test")}
          >
            <FlaskConicalIcon className="size-3" /> Test
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label="Target model"
            className="border-input bg-background h-7 max-w-72 rounded-md border px-2 text-xs"
            value={modelValue}
            onChange={(event) => void setModel(event.target.value)}
          >
            <option value="">Automatic model</option>
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh agent project"
            onClick={() => void refresh()}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="text-destructive flex flex-1 items-center justify-center p-6 text-sm">
          {error}
        </div>
      ) : project ? (
        <ResizablePanelGroup className="min-h-0 flex-1">
          <ResizablePanel defaultSize="62%" minSize="360px">
            <main className="size-full min-w-0">
              {mode === "build" ? (
                <_BuildView
                  project={project}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                  onProjectChange={setProject}
                />
              ) : (
                <_Conversation
                  project={project}
                  kind="target"
                  onProjectChange={setProject}
                />
              )}
            </main>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="38%" minSize="300px">
            <aside className="bg-muted/15 size-full min-w-0">
              <_Conversation
                project={project}
                kind="builder"
                onProjectChange={setProject}
              />
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          Loading Agent Project…
        </div>
      )}
    </section>
  );
}

const _BuildView = memo(function _BuildView({
  project,
  selectedFile,
  onSelectFile,
  onProjectChange,
}: {
  project: AgentProjectView;
  selectedFile: string;
  onSelectFile: (path: string) => void;
  onProjectChange: (project: AgentProjectView) => void;
}) {
  const selectedPath = `${project.path}/agent/${selectedFile}`;
  return (
    <div className="grid size-full min-h-0 grid-cols-[minmax(120px,28%)_minmax(0,1fr)]">
      <div className="min-w-0 overflow-y-auto border-r">
        <div className="space-y-1 p-3">
          <p className="text-muted-foreground px-2 pb-2 text-[10px] font-medium tracking-wide uppercase">
            Agent source
          </p>
          {project.sourceFiles.map((file) => (
            <button
              key={file}
              type="button"
              className={cn(
                "focus-visible:ring-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[11px] outline-none focus-visible:ring-1",
                selectedFile === file
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => onSelectFile(file)}
            >
              <span className="truncate">{file}</span>
              {project.builder.changedFiles.includes(file) ? (
                <span className="bg-primary ml-auto size-1.5 shrink-0 rounded-full" />
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="border-border/70 flex h-9 shrink-0 items-center border-b px-3 font-mono text-[11px]">
          {selectedFile}
        </div>
        <_AgentSourceEditor
          key={selectedPath}
          path={selectedPath}
          onSaved={onProjectChange}
        />
        {project.diagnostics.length > 0 ? (
          <div className="border-destructive/30 bg-destructive/5 shrink-0 border-t p-3">
            <p className="text-destructive mb-2 text-xs font-semibold">
              Project diagnostics
            </p>
            <ul className="space-y-1 text-xs">
              {project.diagnostics.map((diagnostic) => (
                <li key={`${diagnostic.code}:${diagnostic.path}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid shrink-0 gap-3 border-t p-3 lg:grid-cols-2">
          <_CapabilityCard
            icon={<WrenchIcon className="size-3" />}
            title="Tools"
            empty="No tools yet"
            items={project.tools}
          />
          <_CapabilityCard
            icon={<SparklesIcon className="size-3" />}
            title="Skills"
            empty="No skills yet"
            items={project.skills}
          />
        </div>
        {project.builder.changedFiles.length > 0 ? (
          <section className="shrink-0 border-t p-3">
            <h3 className="mb-2 text-xs font-medium">Latest Builder changes</h3>
            <div className="flex flex-wrap gap-1.5">
              {project.builder.changedFiles.map((file) => (
                <button
                  type="button"
                  key={file}
                  className="bg-primary/10 text-primary focus-visible:ring-ring rounded px-2 py-1 font-mono text-[10px] outline-none focus-visible:ring-1"
                  onClick={() => onSelectFile(file)}
                >
                  {file}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
});

const _AgentSourceEditor = memo(function _AgentSourceEditor({
  path,
  onSaved,
}: {
  path: string;
  onSaved: (project: AgentProjectView) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void electrobun.rpc?.request
      .fsReadText({ path })
      .then(({ text }) => {
        if (!cancelled) {
          setValue(text);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const save = useCallback(
    async (next: string) => {
      setValue(next);
      try {
        await electrobun.rpc?.request.fsWriteText({ path, text: next });
        const projectPath = path.slice(0, path.indexOf("/agent/"));
        const project = await electrobun.rpc?.request.agentProjectInspect({
          projectPath,
        });
        if (project) onSaved(project);
      } catch (cause) {
        toast.error("Unable to save agent source", {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [onSaved, path]
  );

  if (error) {
    return (
      <div className="text-destructive flex min-h-0 flex-1 items-center justify-center p-4 text-xs">
        {error}
      </div>
    );
  }
  return (
    <CodeEditor
      className="min-h-40 flex-1 rounded-none border-0"
      hideBorder
      value={value}
      language={path.endsWith(".md") ? "markdown" : undefined}
      onChange={(next) => void save(next)}
    />
  );
});

function _CapabilityCard({
  icon,
  title,
  empty,
  items,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  items: { name: string; description: string }[];
}) {
  return (
    <section className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        {icon} {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.name}>
              <p className="font-mono text-xs font-medium">{item.name}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {item.description}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const _Conversation = memo(function _Conversation({
  project,
  kind,
  onProjectChange,
}: {
  project: AgentProjectView;
  kind: AgentSessionKind;
  onProjectChange: (project: AgentProjectView) => void;
}) {
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [activity, setActivity] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const listenerRef = useRef<
    ((message: StreamAgentProjectResponsePayload) => void) | null
  >(null);
  const session = project[kind];

  useEffect(
    () => () => {
      const rpc = electrobun.rpc;
      if (listenerRef.current) {
        rpc?.removeMessageListener(
          "receiveAgentProjectResponse",
          listenerRef.current
        );
      }
      if (streamIdRef.current) {
        rpc?.send.abortAgentProjectPrompt({ streamId: streamIdRef.current });
      }
    },
    []
  );

  const run = useCallback(() => {
    const text = draft.trim();
    const rpc = electrobun.rpc;
    if (!text || !rpc || running) return;
    const streamId = uuid();
    streamIdRef.current = streamId;
    setRunning(true);
    setLiveText("");
    setActivity("Starting turn…");
    const onResponse = (message: StreamAgentProjectResponsePayload) => {
      if (message.streamId !== streamId) return;
      if (message.type === "event") {
        _applyLiveEvent(message.event, setLiveText, setActivity);
      } else if (message.type === "done") {
        onProjectChange(message.project);
        setDraft("");
        setRunning(false);
        setLiveText("");
        setActivity(null);
        streamIdRef.current = null;
        rpc.removeMessageListener("receiveAgentProjectResponse", onResponse);
        listenerRef.current = null;
      } else {
        toast.error(`${kind === "builder" ? "Builder" : "Target"} run failed`, {
          description: message.message,
        });
        setRunning(false);
        setActivity(null);
        streamIdRef.current = null;
        rpc.removeMessageListener("receiveAgentProjectResponse", onResponse);
        listenerRef.current = null;
      }
    };
    listenerRef.current = onResponse;
    rpc.addMessageListener("receiveAgentProjectResponse", onResponse);
    rpc.send.sendAgentProjectPrompt({
      streamId,
      projectPath: project.path,
      kind,
      text,
    });
  }, [draft, kind, onProjectChange, project.path, running]);

  const stop = useCallback(() => {
    const streamId = streamIdRef.current;
    if (streamId) electrobun.rpc?.send.abortAgentProjectPrompt({ streamId });
  }, []);

  const newSession = useCallback(async () => {
    const next = await electrobun.rpc?.request.agentProjectNewSession({
      projectPath: project.path,
      kind,
    });
    if (next) onProjectChange(next);
  }, [kind, onProjectChange, project.path]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      const next = await electrobun.rpc?.request.agentProjectSelectSession({
        projectPath: project.path,
        kind,
        sessionId,
      });
      if (next) onProjectChange(next);
    },
    [kind, onProjectChange, project.path]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!running) void run();
      }
    },
    [run, running]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border/70 flex h-10 shrink-0 items-center gap-2 border-b px-3">
        {kind === "builder" ? (
          <MessageSquareCodeIcon className="text-primary size-4" />
        ) : (
          <PlayIcon className="text-primary size-4" />
        )}
        <span className="text-xs font-medium">
          {kind === "builder" ? "Builder Agent" : "Target Agent"}
        </span>
        {session.sessions.length > 0 ? (
          <select
            aria-label={`${kind} session`}
            className="border-input bg-background h-6 max-w-28 min-w-0 rounded border px-1 text-[10px]"
            value={session.activeSessionId ?? ""}
            disabled={running}
            onChange={(event) => void selectSession(event.target.value)}
          >
            {session.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground text-[10px]">New session</span>
        )}
        <Button
          className="ml-auto h-6 px-2 text-[10px]"
          size="sm"
          variant="ghost"
          onClick={() => void newSession()}
          disabled={running}
        >
          <PlusIcon className="size-3" /> New Session
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {session.messages.length === 0 && !running ? (
            <p className="text-muted-foreground py-8 text-center text-xs">
              {kind === "builder"
                ? "Ask Builder to inspect, improve, and validate this agent."
                : "Test the agent with a real prompt and real project tools."}
            </p>
          ) : null}
          {session.messages.map((message, index) => (
            <_Message key={`${message.role}:${index}`} message={message} />
          ))}
          {liveText ? (
            <div className="bg-muted/60 rounded-lg px-3 py-2 text-xs whitespace-pre-wrap">
              {liveText}
            </div>
          ) : null}
          {activity ? (
            <p className="text-primary animate-pulse text-[11px]">{activity}</p>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-border/70 shrink-0 border-t p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            kind === "builder"
              ? "Improve this agent…"
              : "Message the target agent…"
          }
          className="min-h-20 resize-none text-xs"
          disabled={running}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground text-[10px]">
            ⌘/Ctrl + Enter to send
          </span>
          {running ? (
            <Button size="sm" variant="destructive" onClick={stop}>
              <CircleStopIcon /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void run()}
              disabled={!draft.trim()}
            >
              <SendIcon /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

function _Message({ message }: { message: AgentProjectMessageView }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 text-xs whitespace-pre-wrap",
        isUser ? "bg-primary/10 ml-6" : "bg-muted/60 mr-6"
      )}
    >
      <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
        {message.role === "toolResult" ? "Tool result" : message.role}
      </p>
      {message.text || null}
      {message.toolCalls?.map((toolCall) => (
        <div key={toolCall.id} className="mt-2 rounded border p-2 font-mono">
          {toolCall.name}({JSON.stringify(toolCall.arguments)})
        </div>
      ))}
    </div>
  );
}

function _applyLiveEvent(
  event: AgentEvent,
  setLiveText: Dispatch<SetStateAction<string>>,
  setActivity: Dispatch<SetStateAction<string | null>>
): void {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") {
      setLiveText((current) => current + update.delta);
    }
    return;
  }
  if (event.type === "tool_execution_start") {
    setActivity(`Running ${event.toolName}…`);
  } else if (event.type === "tool_execution_end") {
    setActivity(`Finished ${event.toolName}`);
  } else if (event.type === "turn_start") {
    setActivity("Thinking…");
  }
}

export const AgentProjectTabPane = memo(_AgentProjectTabPane);
