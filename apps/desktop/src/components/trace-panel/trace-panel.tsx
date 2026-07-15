"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FolderPlusIcon,
  ImportIcon,
  KeyRoundIcon,
  LinkIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon
} from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import { traceClient } from "@/client";
import { useCommands, useRegisterCommands } from "@/commands";
import { cn } from "@/lib/utils";
import { Tooltip } from "../tooltip";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from "../ui/empty";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import type {
  TraceConnectedProjectInput,
  TraceImportFile,
  TraceLangfuseSearchInput,
  TraceProject,
  TraceRecord,
  TraceRemoteTraceSummary
} from "@/shared/traces";

interface TracePanelProps {
  readonly className?: string;
  readonly headerStart?: ReactNode;
  readonly onOpenTrace: (trace: TraceRecord) => void;
}

type ConnectedTraceProject = {
  source: Extract<TraceProject["source"], { mode: "connected"; }>;
} & TraceProject;

interface TraceSearchFormState {
  traceId: string;
  query: string;
  name: string;
  userId: string;
  sessionId: string;
  tags: string;
  version: string;
  release: string;
  environment: string;
  fromTimestamp: string;
  toTimestamp: string;
  orderBy: string;
  limit: string;
}

const DEFAULT_TRACE_SEARCH_FORM: TraceSearchFormState = {
  traceId: "",
  query: "",
  name: "",
  userId: "",
  sessionId: "",
  tags: "",
  version: "",
  release: "",
  environment: "",
  fromTimestamp: "",
  toTimestamp: "",
  orderBy: "timestamp.desc",
  limit: "25"
};

const TRACE_SEARCH_ORDER_OPTIONS = [
  { value: "timestamp.desc", label: "Newest" },
  { value: "timestamp.asc", label: "Oldest" },
  { value: "name.asc", label: "Name A-Z" },
  { value: "userId.asc", label: "User A-Z" },
  { value: "sessionId.asc", label: "Session A-Z" },
  { value: "id.asc", label: "ID A-Z" }
];

const TRACE_SEARCH_LIMIT_OPTIONS = ["25", "50", "100"];

export function TracePanel({ className, onOpenTrace }: TracePanelProps) {
  const { executeCommand } = useCommands();
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [importProjectId, setImportProjectId] = useState<string | null>(null);
  const [syncProjectId, setSyncProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["trace", "projects"],
    queryFn: async () => traceClient.listProjects()
  });
  const selectedProject = useMemo(
    () =>
      projects.find(project => project.id === selectedProjectId)
      ?? projects[0]
      ?? null,
    [projects, selectedProjectId]
  );
  const syncProject = useMemo(() => {
    const project =
      projects.find(project => project.id === syncProjectId) ?? null;
    return project?.source.mode === "connected"
      ? (project as ConnectedTraceProject)
      : null;
  }, [projects, syncProjectId]);
  const importProject = useMemo(() => {
    const project =
      projects.find(project => project.id === importProjectId) ?? null;
    return project?.source.mode === "manual" ? project : null;
  }, [importProjectId, projects]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
    if (
      selectedProjectId
      && projects.length > 0
      && !projects.some(project => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(projects[0]?.id ?? null);
    }
  }, [projects, selectedProjectId]);

  const createProject = useCallback(
    async (name: string) => {
      try {
        const project = await traceClient.createProject(name);
        setProjectName("");
        setProjectDialogOpen(false);
        setSelectedProjectId(project.id);
        await qc.invalidateQueries({ queryKey: ["trace", "projects"] });
      } catch (error) {
        toast.error("Could not create trace project", {
          description:
            error instanceof Error ? error.message : "Project creation failed."
        });
      }
    },
    [qc]
  );

  const createConnectedProject = useCallback(
    async (input: TraceConnectedProjectInput) => {
      setConnectionPending(true);
      try {
        const project = await traceClient.createConnectedProject(input);
        setProjectDialogOpen(false);
        setSelectedProjectId(project.id);
        await qc.invalidateQueries({ queryKey: ["trace", "projects"] });
        toast.success("Connected Langfuse project", {
          description: project.source.langfuseProjectName ?? project.name
        });
      } catch (error) {
        toast.error("Could not connect Langfuse", {
          description:
            error instanceof Error ? error.message : "Connection failed."
        });
      } finally {
        setConnectionPending(false);
      }
    },
    [qc]
  );

  const importLangfuseFiles = useCallback(
    async (projectId: string, files: TraceImportFile[]) => {
      setImporting(true);
      try {
        const result = await traceClient.importLangfuseJson(projectId, files);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["trace", "projects"] }),
          qc.invalidateQueries({
            queryKey: ["trace", "traces", projectId]
          })
        ]);
        if (result.imported.length > 0) {
          setImportProjectId(null);
          toast.success(
            `Imported ${result.imported.length} trace${
              result.imported.length === 1 ? "" : "s"
            }`,
            result.warnings.length > 0
              ? { description: result.warnings[0] }
              : undefined
          );
        } else {
          toast.error("No Langfuse traces imported", {
            description:
              result.warnings[0]
              ?? "Select a Langfuse Observations JSON export."
          });
        }
      } catch (error) {
        toast.error("Import failed", {
          description:
            error instanceof Error ? error.message : "Could not import traces."
        });
      } finally {
        setImporting(false);
      }
    },
    [qc]
  );

  const syncLangfuseTraceIds = useCallback(
    async (projectId: string, traceIds: string[]) => {
      setSyncingProjectId(projectId);
      try {
        const result = await traceClient.syncLangfuseTraces(
          projectId,
          traceIds
        );
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["trace", "projects"] }),
          qc.invalidateQueries({
            queryKey: ["trace", "traces", projectId]
          })
        ]);
        if (result.imported.length > 0) {
          toast.success(
            `Synced ${result.imported.length} trace${
              result.imported.length === 1 ? "" : "s"
            }`,
            result.warnings.length > 0
              ? { description: result.warnings[0] }
              : undefined
          );
        } else {
          toast.error("No traces synced", {
            description:
              result.warnings[0] ?? "Select a Langfuse trace id to sync."
          });
        }
      } catch (error) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["trace", "projects"] }),
          qc.invalidateQueries({
            queryKey: ["trace", "traces", projectId]
          })
        ]);
        toast.error("Sync failed", {
          description:
            error instanceof Error ? error.message : "Could not sync traces."
        });
      } finally {
        setSyncingProjectId(null);
      }
    },
    [qc]
  );

  useRegisterCommands({
    createTraceProject: ({ name }) => void createProject(name),
    createConnectedTraceProject: input => void createConnectedProject(input),
    importLangfuseTraceFiles: ({ projectId, files }) =>
      void importLangfuseFiles(projectId, files),
    syncLangfuseTraceIds: ({ projectId, traceIds }) =>
      void syncLangfuseTraceIds(projectId, traceIds)
  });

  const requestCreateProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) {
      return;
    }
    executeCommand({ type: "createTraceProject", args: { name } });
  }, [executeCommand, projectName]);

  const importFilesIntoProject = useCallback(
    (projectId: string, files: TraceImportFile[]) => {
      executeCommand({
        type: "importLangfuseTraceFiles",
        args: { projectId, files }
      });
    },
    [executeCommand]
  );

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
  }, []);
  const cancelCreateProject = useCallback(() => {
    setProjectDialogOpen(false);
    setProjectName("");
  }, []);
  const openProjectDialog = useCallback(() => {
    setProjectDialogOpen(true);
  }, []);
  const setSyncDialogOpen = useCallback((open: boolean) => {
    if (!open) {
      setSyncProjectId(null);
    }
  }, []);

  const handleCreateConnectedProject = useCallback(
    (input: TraceConnectedProjectInput) => {
      executeCommand({
        type: "createConnectedTraceProject",
        args: input
      });
    },
    [executeCommand]
  );

  const handleSyncTraceIds = useCallback(
    (projectId: string, traceIds: string[]) => {
      executeCommand({
        type: "syncLangfuseTraceIds",
        args: { projectId, traceIds }
      });
    },
    [executeCommand]
  );

  const addTraceToProject = useCallback((project: TraceProject) => {
    setSelectedProjectId(project.id);
    if (project.source.mode === "connected") {
      setSyncProjectId(project.id);
      return;
    }
    setImportProjectId(project.id);
  }, []);

  return (
    <div className={cn("bg-sidebar flex h-full flex-col", className)}>
      <header className="electrobun-webkit-app-region-drag flex h-11.5 items-center justify-between px-3">
        <span className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Add Trace Project">
            <Button
              aria-label="Add Trace Project"
              onClick={openProjectDialog}
              size="icon-sm"
              variant="ghost"
            >
              <PlusIcon className="size-4" />
            </Button>
          </Tooltip>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {projectsLoading
          ? (
            <div className="flex items-center justify-center p-4">
              <Spinner />
            </div>
          )
          : projects.length === 0
            ? (
              <_EmptyProjects onAddProject={openProjectDialog} />
            )
            : (
              <div className="flex flex-col gap-2">
                {projects.map(project => (
                  <TraceProjectGroup
                    adding={importing || syncingProjectId === project.id}
                    key={project.id}
                    onAddTrace={addTraceToProject}
                    onOpenTrace={onOpenTrace}
                    onSelectProject={selectProject}
                    project={project}
                    selected={project.id === selectedProject?.id}
                  />
                ))}
              </div>
            )}
      </div>
      <_TraceProjectDialog
        onCancelManual={cancelCreateProject}
        onCreate={handleCreateConnectedProject}
        onCreateManual={requestCreateProject}
        onOpenChange={open => {
          if (!connectionPending) {
            setProjectDialogOpen(open);
          }
        }}
        onProjectNameChange={setProjectName}
        open={projectDialogOpen}
        pending={connectionPending}
        projectName={projectName}
      />
      <_ImportLangfuseDialog
        importing={importing}
        onImport={importFilesIntoProject}
        onOpenChange={open => {
          if (!open && !importing) {
            setImportProjectId(null);
          }
        }}
        open={Boolean(importProject)}
        project={importProject}
      />
      <_SyncProjectDialog
        onOpenChange={setSyncDialogOpen}
        onSyncTraceIds={handleSyncTraceIds}
        open={Boolean(syncProject)}
        project={syncProject}
        syncing={syncProject ? syncingProjectId === syncProject.id : false}
      />
    </div>
  );
}

function _EmptyProjects({ onAddProject }: { readonly onAddProject: () => void; }) {
  return (
    <Empty className="h-full border-0 px-3">
      <EmptyHeader>
        <EmptyTitle>No trace projects</EmptyTitle>
        <EmptyDescription>
          Connect Langfuse or create a manual project for JSON exports.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button className="w-full py-4" onClick={onAddProject} size="lg">
          <PlusIcon className="size-3" />
          Add trace project
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function _TraceProjectDialog({
  open,
  pending,
  onOpenChange,
  projectName,
  onProjectNameChange,
  onCreateManual,
  onCancelManual,
  onCreate
}: {
  readonly onCancelManual: () => void;
  readonly onCreate: (input: TraceConnectedProjectInput) => void;
  readonly onCreateManual: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onProjectNameChange: (name: string) => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly projectName: string;
}) {
  const [tab, setTab] = useState<"langfuse" | "manual">("langfuse");

  useEffect(() => {
    if (open) {
      setTab("langfuse");
    }
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        onInteractOutside={event => {
          if (pending) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={event => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add Trace Project</DialogTitle>
          <DialogDescription>
            Create a local project or connect a trace provider. More providers
            can plug into this flow later.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          className="gap-4"
          onValueChange={value => { setTab(value as "langfuse" | "manual"); }}
          value={tab}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger disabled={pending} value="langfuse">
              <LinkIcon className="size-3.5" />
              Langfuse
            </TabsTrigger>
            <TabsTrigger disabled={pending} value="manual">
              <FolderPlusIcon className="size-3.5" />
              Manual
            </TabsTrigger>
          </TabsList>
          <TabsContent className="mt-0" value="langfuse">
            <_ConnectProjectForm
              onCancel={() => { onOpenChange(false); }}
              onCreate={onCreate}
              pending={pending}
            />
          </TabsContent>
          <TabsContent className="mt-0" value="manual">
            <_ManualProjectForm
              onCancel={onCancelManual}
              onCreate={onCreateManual}
              onNameChange={onProjectNameChange}
              projectName={projectName}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function _ManualProjectForm({
  projectName,
  onNameChange,
  onCreate,
  onCancel
}: {
  readonly onCancel: () => void;
  readonly onCreate: () => void;
  readonly onNameChange: (name: string) => void;
  readonly projectName: string;
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <_Field label="Project name">
        <Input
          aria-label="Trace project name"
          onChange={event => { onNameChange(event.target.value); }}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCreate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="Local traces"
          value={projectName}
        />
      </_Field>
      <div className="text-muted-foreground bg-muted/30 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
        <FolderPlusIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Manual projects are for Langfuse JSON exports and any provider import
          we add later.
        </span>
      </div>
      <DialogFooter>
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!projectName.trim()} onClick={onCreate} size="sm">
          Create
        </Button>
      </DialogFooter>
    </div>
  );
}

function _ConnectProjectForm({
  onCreate,
  onCancel,
  pending = false
}: {
  readonly onCancel: () => void;
  readonly onCreate: (input: TraceConnectedProjectInput) => void;
  readonly pending?: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState("https://cloud.langfuse.com");
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const canCreate = Boolean(
    baseUrl.trim() && publicKey.trim() && secretKey.trim()
  );
  const submit = useCallback(() => {
    if (!canCreate || pending) {
      return;
    }
    onCreate({
      baseUrl: baseUrl.trim(),
      publicKey: publicKey.trim(),
      secretKey: secretKey.trim()
    });
  }, [baseUrl, canCreate, onCreate, pending, publicKey, secretKey]);
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <_Field className="sm:col-span-2" label="Langfuse base URL">
          <Input
            aria-label="Langfuse base URL"
            autoFocus
            onChange={event => { setBaseUrl(event.target.value); }}
            placeholder="https://cloud.langfuse.com"
            value={baseUrl}
          />
        </_Field>
        <_Field label="Public key">
          <Input
            aria-label="Langfuse public key"
            onChange={event => { setPublicKey(event.target.value); }}
            placeholder="pk-lf-..."
            value={publicKey}
          />
        </_Field>
        <_Field label="Secret key">
          <Input
            aria-label="Langfuse secret key"
            onChange={event => { setSecretKey(event.target.value); }}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            placeholder="sk-lf-..."
            type="password"
            value={secretKey}
          />
        </_Field>
      </div>
      <div className="text-muted-foreground bg-muted/30 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
        <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          The connection is tested before the project is created. Connecting
          does not sync traces automatically.
        </span>
      </div>
      <DialogFooter>
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!canCreate || pending} onClick={submit} size="sm">
          {pending ? <Spinner className="size-3" /> : null}
          Connect
        </Button>
      </DialogFooter>
    </div>
  );
}

function _Field({
  label,
  children,
  className
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function _TraceProjectGroup({
  project,
  selected,
  adding,
  onSelectProject,
  onAddTrace,
  onOpenTrace
}: {
  readonly adding: boolean;
  readonly onAddTrace: (project: TraceProject) => void;
  readonly onOpenTrace: (trace: TraceRecord) => void;
  readonly onSelectProject: (projectId: string) => void;
  readonly project: TraceProject;
  readonly selected: boolean;
}) {
  const { data: traces = [], isLoading } = useQuery({
    queryKey: ["trace", "traces", project.id],
    queryFn: async () => traceClient.listTraces(project.id),
    enabled: selected
  });
  const addLabel =
    project.source.mode === "connected"
      ? "Sync Langfuse Traces"
      : "Import Langfuse Export";

  return (
    <section className="flex flex-col gap-1">
      <div
        className={cn(
          "hover:bg-muted/70 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
          selected && "bg-muted/70"
        )}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => { onSelectProject(project.id); }}
          type="button"
        >
          <span className="bg-primary/10 flex size-6 shrink-0 items-center justify-center rounded-md">
            <DatabaseIcon className="text-primary size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {project.name}
            </span>
            <span className="text-muted-foreground block truncate text-[0.625rem]">
              {_projectSourceSummary(project)}
            </span>
          </span>
        </button>
        <Tooltip content={addLabel}>
          <Button
            aria-label={addLabel}
            className="size-7 shrink-0"
            disabled={adding}
            onClick={() => { onAddTrace(project); }}
            size="icon-sm"
            variant="secondary"
          >
            {adding
              ? (
                <Spinner className="size-3" />
              )
              : (
                <PlusIcon className="size-3.5" />
              )}
          </Button>
        </Tooltip>
      </div>
      {selected
        ? (
          <div className="flex flex-col gap-1.5 pl-1">
            {isLoading
              ? (
                <div className="flex items-center justify-center p-3">
                  <Spinner className="size-3.5" />
                </div>
              )
              : traces.length === 0
                ? (
                  <div className="text-muted-foreground bg-muted/20 rounded-md border border-dashed px-3 py-4 text-xs">
                    {project.source.mode === "connected"
                      ? "No synced traces yet. Use Sync to pull selected Langfuse traces."
                      : "No imported traces yet. Import a Langfuse JSON export."}
                  </div>
                )
                : (
                  traces.map(trace => (
                    <TraceRow key={trace.key} onOpen={onOpenTrace} trace={trace} />
                  ))
                )}
          </div>
        )
        : null}
    </section>
  );
}

const TraceProjectGroup = memo(_TraceProjectGroup);

function _ImportLangfuseDialog({
  open,
  project,
  importing,
  onOpenChange,
  onImport
}: {
  readonly importing: boolean;
  readonly onImport: (projectId: string, files: TraceImportFile[]) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly project: TraceProject | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const pending = importing || reading;

  useEffect(() => {
    if (open) {
      setSelectedFiles([]);
      setReading(false);
    }
  }, [open, project?.id]);

  const selectFiles = useCallback((files: FileList | null) => {
    setSelectedFiles(files ? [...files] : []);
  }, []);

  const submit = useCallback(async () => {
    if (!project || selectedFiles.length === 0 || pending) {
      return;
    }
    setReading(true);
    try {
      const records = await Promise.all(
        selectedFiles.map(async file => ({
          name: file.name,
          text: await file.text()
        }))
      );
      onImport(project.id, records);
    } catch (error) {
      toast.error("Import failed", {
        description:
          error instanceof Error ? error.message : "Could not read files."
      });
    } finally {
      setReading(false);
    }
  }, [onImport, pending, project, selectedFiles]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open ? project !== null : false}>
      {project
        ? (
          <DialogContent
            className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
            onInteractOutside={event => {
              if (pending) {
                event.preventDefault();
              }
            }}
            onPointerDownOutside={event => {
              if (pending) {
                event.preventDefault();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Import Langfuse Export</DialogTitle>
              <DialogDescription>
                {project.name} accepts JSON exports from one Langfuse project.
              </DialogDescription>
            </DialogHeader>
            <input
              accept=".json,application/json"
              aria-label="Choose Langfuse JSON files"
              className="hidden"
              multiple
              onChange={event => {
                selectFiles(event.target.files);
                event.target.value = "";
              }}
              ref={inputRef}
              type="file"
            />
            <div className="flex flex-col gap-3">
              <Button
                className="justify-start"
                disabled={pending}
                onClick={() => inputRef.current?.click()}
                variant="secondary"
              >
                <ImportIcon className="size-4" />
                Choose JSON Files
              </Button>
              <div className="bg-muted/30 border-border/70 min-h-24 rounded-md border p-3">
                {selectedFiles.length === 0
                  ? (
                    <div className="text-muted-foreground flex h-20 items-center justify-center text-center text-xs">
                      Select Langfuse Observations JSON exports to import.
                    </div>
                  )
                  : (
                    <div className="flex flex-col gap-1.5">
                      {selectedFiles.map(file => (
                        <div
                          className="flex min-w-0 items-center justify-between gap-3 text-xs"
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                        >
                          <span className="truncate">{file.name}</span>
                          <span className="text-muted-foreground shrink-0">
                            {_formatBytes(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => { onOpenChange(false); }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={selectedFiles.length === 0 || pending}
                onClick={() => void submit()}
                size="sm"
              >
                {pending ? <Spinner className="size-3" /> : null}
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        )
        : null}
    </Dialog>
  );
}

function _SyncProjectDialog({
  open,
  project,
  syncing,
  onOpenChange,
  onSyncTraceIds
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSyncTraceIds: (projectId: string, traceIds: string[]) => void;
  readonly open: boolean;
  readonly project: ConnectedTraceProject | null;
  readonly syncing: boolean;
}) {
  const [form, setForm] = useState<TraceSearchFormState>(
    DEFAULT_TRACE_SEARCH_FORM
  );
  const [remoteTraces, setRemoteTraces] = useState<TraceRemoteTraceSummary[]>(
    []
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const searchFilters = useMemo(
    () => _traceSearchFiltersFromForm(form),
    [form]
  );

  useEffect(() => {
    if (open) {
      setForm(DEFAULT_TRACE_SEARCH_FORM);
      setRemoteTraces([]);
      setSelected(new Set());
      setAdvancedFiltersOpen(false);
    }
  }, [open, project?.id]);

  const setFormValue = useCallback(
    (key: keyof TraceSearchFormState, value: string) => {
      setForm(current => ({ ...current, [key]: value }));
    },
    []
  );

  const search = useCallback(async () => {
    if (!project) {
      return;
    }
    setSearching(true);
    try {
      const rows = await traceClient.searchLangfuseTraces(
        project.id,
        searchFilters
      );
      setRemoteTraces(rows);
      setSelected(new Set());
    } catch (error) {
      toast.error("Search failed", {
        description:
          error instanceof Error ? error.message : "Could not search traces."
      });
    } finally {
      setSearching(false);
    }
  }, [project, searchFilters]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAdvancedFilters = useCallback(() => {
    setAdvancedFiltersOpen(current => !current);
  }, []);

  const syncSelected = useCallback(() => {
    if (!project || selectedIds.length === 0) {
      return;
    }
    onSyncTraceIds(project.id, selectedIds);
  }, [onSyncTraceIds, project, selectedIds]);

  const searchSummary =
    remoteTraces.length > 0
      ? `${remoteTraces.length} shown · ${selectedIds.length} selected`
      : "Search remote traces without syncing them.";

  return (
    <Dialog onOpenChange={onOpenChange} open={open ? project !== null : false}>
      {project
        ? (
          <DialogContent
            className="flex max-h-[85vh] w-[min(920px,calc(100vw-2rem))] max-w-none! flex-col gap-0 overflow-hidden p-0"
            onInteractOutside={e => { e.preventDefault(); }}
          >
            <DialogHeader className="border-b px-4 py-3">
              <DialogTitle>Sync Langfuse Traces</DialogTitle>
              <DialogDescription>
                {project.name}
                {project.source.langfuseProjectName
                  ? ` · ${project.source.langfuseProjectName}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto p-4">
              <div className="flex flex-col gap-4">
                <section className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        Search Remote Traces
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {searchSummary}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_7rem_auto]">
                    <_Field label="Search">
                      <Input
                        aria-label="Search remote Langfuse traces"
                        onChange={event => { setFormValue("query", event.target.value); }}
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void search();
                          }
                        }}
                        placeholder="Trace ID, name, user, or session"
                        value={form.query}
                      />
                    </_Field>
                    <_Field label="Sort">
                      <Select
                        onValueChange={value => { setFormValue("orderBy", value); }}
                        value={form.orderBy}
                      >
                        <SelectTrigger aria-label="Sort remote Langfuse traces">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRACE_SEARCH_ORDER_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </_Field>
                    <_Field label="Limit">
                      <Select
                        onValueChange={value => { setFormValue("limit", value); }}
                        value={form.limit}
                      >
                        <SelectTrigger aria-label="Remote Langfuse trace limit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRACE_SEARCH_LIMIT_OPTIONS.map(value => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </_Field>
                    <Button
                      className="mt-5 shrink-0 justify-center"
                      disabled={searching}
                      onClick={() => void search()}
                      variant="secondary"
                    >
                      {searching
                        ? (
                          <Spinner className="size-3.5" />
                        )
                        : (
                          <SearchIcon className="size-4" />
                        )}
                      Search
                    </Button>
                  </div>
                  {advancedFiltersOpen
                    ? (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <_Field label="Trace ID">
                          <Input
                            onChange={event => { setFormValue("traceId", event.target.value); }}
                            placeholder="exact trace id"
                            value={form.traceId}
                          />
                        </_Field>
                        <_Field label="Name">
                          <Input
                            onChange={event => { setFormValue("name", event.target.value); }}
                            placeholder="trace name"
                            value={form.name}
                          />
                        </_Field>
                        <_Field label="User ID">
                          <Input
                            onChange={event => { setFormValue("userId", event.target.value); }}
                            placeholder="user id"
                            value={form.userId}
                          />
                        </_Field>
                        <_Field label="Session ID">
                          <Input
                            onChange={event => { setFormValue("sessionId", event.target.value); }}
                            placeholder="session id"
                            value={form.sessionId}
                          />
                        </_Field>
                        <_Field label="Tags">
                          <Input
                            onChange={event => { setFormValue("tags", event.target.value); }}
                            placeholder="tag-a, tag-b"
                            value={form.tags}
                          />
                        </_Field>
                        <_Field label="Environment">
                          <Input
                            onChange={event => { setFormValue("environment", event.target.value); }}
                            placeholder="production"
                            value={form.environment}
                          />
                        </_Field>
                        <_Field label="Version">
                          <Input
                            onChange={event => { setFormValue("version", event.target.value); }}
                            placeholder="version"
                            value={form.version}
                          />
                        </_Field>
                        <_Field label="Release">
                          <Input
                            onChange={event => { setFormValue("release", event.target.value); }}
                            placeholder="release"
                            value={form.release}
                          />
                        </_Field>
                      </div>
                    )
                    : null}
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto]">
                    <_Field label="From">
                      <Input
                        onChange={event => { setFormValue("fromTimestamp", event.target.value); }}
                        type="datetime-local"
                        value={form.fromTimestamp}
                      />
                    </_Field>
                    <_Field label="To">
                      <Input
                        onChange={event => { setFormValue("toTimestamp", event.target.value); }}
                        type="datetime-local"
                        value={form.toTimestamp}
                      />
                    </_Field>
                    <div className="flex items-end">
                      <Button
                        aria-expanded={advancedFiltersOpen}
                        className="mt-5 min-w-28 justify-between"
                        onClick={toggleAdvancedFilters}
                        variant="link"
                      >
                        <ChevronDownIcon
                          className={cn(
                            "size-3.5 transition-transform",
                            advancedFiltersOpen && "rotate-180"
                          )}
                        />
                        {advancedFiltersOpen ? "Hide Filters" : "More Filters"}
                      </Button>
                    </div>
                  </div>
                  <div className="border-border/70 max-h-80 min-h-65 overflow-auto rounded-md border bg-[#141414]">
                    {remoteTraces.length === 0
                      ? (
                        <div className="flex h-60 flex-col items-center justify-center px-6 text-center">
                          <SearchIcon className="text-muted-foreground/70 mb-2 size-5" />
                          <div className="text-sm font-medium">
                            No remote traces loaded
                          </div>
                          <div className="text-muted-foreground mt-1 text-xs">
                            Run a search, then select traces to sync.
                          </div>
                        </div>
                      )
                      : (
                        remoteTraces.map(trace => (
                          <RemoteTraceRow
                            key={trace.id}
                            onToggle={toggle}
                            selected={selected.has(trace.id)}
                            trace={trace}
                          />
                        ))
                      )}
                  </div>
                </section>
              </div>
            </div>
            <DialogFooter className="border-t px-4 py-3">
              <Button
                disabled={syncing}
                onClick={() => { onOpenChange(false); }}
                variant="ghost"
              >
                Close
              </Button>
              <Button
                disabled={syncing || selectedIds.length === 0}
                onClick={syncSelected}
              >
                {syncing
                  ? (
                    <Spinner className="size-3.5" />
                  )
                  : (
                    <RefreshCwIcon className="size-4" />
                  )}
                {selectedIds.length > 0
                  ? `Sync ${selectedIds.length} Selected`
                  : "Sync Selected"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )
        : null}
    </Dialog>
  );
}

function _projectSourceSummary(project: TraceProject): string {
  if (project.source.mode === "connected") {
    return project.source.langfuseProjectName
      ? `Connected · ${project.source.langfuseProjectName}`
      : "Connected Langfuse";
  }
  return project.source.langfuseProjectName
    ? `Manual import · ${project.source.langfuseProjectName}`
    : "Manual import";
}

function _traceSearchFiltersFromForm(
  form: TraceSearchFormState
): TraceLangfuseSearchInput {
  return {
    ...(_trimmed(form.traceId) ? { id: _trimmed(form.traceId) } : {}),
    ...(_trimmed(form.query) ? { query: _trimmed(form.query) } : {}),
    ...(_trimmed(form.name) ? { name: _trimmed(form.name) } : {}),
    ...(_trimmed(form.userId) ? { userId: _trimmed(form.userId) } : {}),
    ...(_trimmed(form.sessionId)
      ? { sessionId: _trimmed(form.sessionId) }
      : {}),
    ...(_csv(form.tags).length > 0 ? { tags: _csv(form.tags) } : {}),
    ...(_trimmed(form.version) ? { version: _trimmed(form.version) } : {}),
    ...(_trimmed(form.release) ? { release: _trimmed(form.release) } : {}),
    ...(_csv(form.environment).length > 0
      ? { environment: _csv(form.environment) }
      : {}),
    ...(_datetimeLocalToIso(form.fromTimestamp)
      ? { fromTimestamp: _datetimeLocalToIso(form.fromTimestamp) }
      : {}),
    ...(_datetimeLocalToIso(form.toTimestamp)
      ? { toTimestamp: _datetimeLocalToIso(form.toTimestamp) }
      : {}),
    orderBy: form.orderBy,
    limit: Number(form.limit)
  };
}

function _trimmed(value: string): string | undefined {
  return value.trim() || undefined;
}

function _csv(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function _datetimeLocalToIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function _RemoteTraceRow({
  trace,
  selected,
  onToggle
}: {
  readonly onToggle: (id: string) => void;
  readonly selected: boolean;
  readonly trace: TraceRemoteTraceSummary;
}) {
  const meta = _remoteTraceMeta(trace);
  return (
    <button
      aria-checked={selected}
      className={cn(
        "hover:bg-muted/70 flex w-full min-w-0 items-start gap-3 border-b px-3 py-2.5 text-left last:border-b-0",
        selected && "bg-muted"
      )}
      onClick={() => { onToggle(trace.id); }}
      role="checkbox"
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
          selected ? "border-primary bg-primary text-primary-foreground" : ""
        )}
      >
        {selected ? <CheckIcon className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {trace.name || trace.id}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {meta || trace.id}
        </span>
      </span>
    </button>
  );
}

const RemoteTraceRow = memo(_RemoteTraceRow);

function _remoteTraceMeta(trace: TraceRemoteTraceSummary): string {
  return [
    trace.timestamp ? _formatDateTime(trace.timestamp) : null,
    trace.userId,
    trace.sessionId,
    trace.environment,
    trace.release,
    trace.version,
    trace.tags && trace.tags.length > 0 ? trace.tags.join(", ") : null,
    trace.observationCount ? `${trace.observationCount} obs` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function _formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _formatDateTime(value: number | string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function _TraceRow({
  trace,
  onOpen
}: {
  readonly onOpen: (trace: TraceRecord) => void;
  readonly trace: TraceRecord;
}) {
  const subtitle = [
    trace.startedAt ? _formatDateTime(trace.startedAt) : null,
    trace.model,
    `${trace.observationCount} obs`
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className="hover:bg-muted/70 focus-visible:ring-ring/50 flex w-full min-w-0 items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      onClick={() => { onOpen(trace); }}
      type="button"
    >
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          trace.status === "error" ? "bg-destructive" : "bg-primary/70"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {trace.title}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-[0.625rem]">
          {subtitle || trace.source.traceId}
        </span>
      </span>
      {trace.status === "error" && (
        <span className="bg-destructive/10 text-destructive shrink-0 rounded px-1.5 py-0.5 text-[0.5625rem]">
          Error
        </span>
      )}
    </button>
  );
}

const TraceRow = memo(_TraceRow);
