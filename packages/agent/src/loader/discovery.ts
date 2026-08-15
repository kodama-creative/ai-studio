import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { moduleBaseName } from "./module-files";
import { resolveAgentProject } from "./project";
import type {
  AgentDiagnostic,
  AgentExtensionSourceRef,
  AgentSourceManifest,
  AgentSourceRef,
  DiscoverAgentOptions,
  DiscoverAgentResult,
  ResolvedAgentProject,
} from "./types";

const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const CONNECTION_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const GENERIC_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function _logical(path: string): string {
  return path.split(sep).join("/");
}

function _moduleRef(logicalPath: string, name?: string): AgentSourceRef {
  return {
    logicalPath,
    moduleId: logicalPath,
    ...(name === undefined ? {} : { name }),
    sourceKind: "module",
  };
}

function _markdownRef(logicalPath: string, name?: string): AgentSourceRef {
  return {
    logicalPath,
    moduleId: logicalPath,
    ...(name === undefined ? {} : { name }),
    sourceKind: "markdown",
  };
}

function _diagnostic(
  code: string,
  message: string,
  sourcePath: string,
  severity: AgentDiagnostic["severity"] = "error"
): AgentDiagnostic {
  return { code, message, severity, sourcePath };
}

async function _exists(
  path: string,
  kind: "directory" | "file"
): Promise<boolean> {
  try {
    const value = await stat(path);
    return kind === "directory" ? value.isDirectory() : value.isFile();
  } catch {
    return false;
  }
}

async function _sortedEntries(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

async function _moduleSlot(
  root: string,
  baseName: string,
  diagnostics: AgentDiagnostic[],
  required = false
): Promise<AgentSourceRef | undefined> {
  const candidates = (await _sortedEntries(root))
    .filter(
      (entry) => entry.isFile() && moduleBaseName(entry.name) === baseName
    )
    .map((entry) => entry.name);
  if (candidates.length > 1) {
    diagnostics.push(
      _diagnostic(
        "discover/module-slot-collision",
        `Multiple modules claim the "${baseName}" slot: ${candidates.join(", ")}.`,
        root
      )
    );
    return undefined;
  }
  const [candidate] = candidates;
  if (candidate !== undefined) return _moduleRef(candidate);
  if (required) {
    diagnostics.push(
      _diagnostic(
        `discover/required-${baseName}-missing`,
        `Expected a ${baseName} module in "${root}".`,
        root
      )
    );
  }
  return undefined;
}

async function _instructions(
  root: string,
  diagnostics: AgentDiagnostic[],
  required: boolean
): Promise<AgentSourceRef[]> {
  const result: AgentSourceRef[] = [];
  const entries = await _sortedEntries(root);
  const markdown = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === "instructions.md"
  );
  const modules = entries.filter(
    (entry) => entry.isFile() && moduleBaseName(entry.name) === "instructions"
  );
  if (markdown !== undefined && modules.length > 0) {
    diagnostics.push(
      _diagnostic(
        "discover/slot-collision",
        "The instructions slot cannot contain both Markdown and a module.",
        root
      )
    );
  } else if (modules.length > 1) {
    diagnostics.push(
      _diagnostic(
        "discover/module-slot-collision",
        `Multiple modules claim the instructions slot: ${modules.map((entry) => entry.name).join(", ")}.`,
        root
      )
    );
  } else if (markdown !== undefined) {
    result.push(_markdownRef(markdown.name));
  } else if (modules[0] !== undefined) {
    result.push(_moduleRef(modules[0].name));
  }

  const directory = join(root, "instructions");
  if (await _exists(directory, "directory")) {
    for (const entry of await _sortedEntries(directory)) {
      if (!entry.isFile()) continue;
      const logicalPath = `instructions/${entry.name}`;
      if (entry.name.toLowerCase().endsWith(".md"))
        result.push(_markdownRef(logicalPath));
      else if (moduleBaseName(entry.name) !== null)
        result.push(_moduleRef(logicalPath));
    }
  }

  if (result.length === 0) {
    const legacyMarkdown = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === "system.md"
    );
    const legacyModule = entries.find(
      (entry) => entry.isFile() && moduleBaseName(entry.name) === "system"
    );
    const legacy = legacyMarkdown ?? legacyModule;
    if (legacy !== undefined) {
      result.push(
        legacy.name.toLowerCase().endsWith(".md")
          ? _markdownRef(legacy.name)
          : _moduleRef(legacy.name)
      );
      diagnostics.push(
        _diagnostic(
          "discover/deprecated-system-slot",
          `The "${legacy.name}" slot is deprecated; rename it to instructions.`,
          join(root, legacy.name),
          "warning"
        )
      );
    }
  }

  if (required && result.length === 0) {
    diagnostics.push(
      _diagnostic(
        "discover/required-instructions-missing",
        'Expected authored instructions at "instructions.md", "instructions.ts", or "instructions/".',
        root
      )
    );
  }
  return result;
}

async function _moduleDirectory(
  root: string,
  directoryName: string,
  diagnostics: AgentDiagnostic[],
  options: {
    readonly namePattern?: RegExp;
    readonly diagnosticCode?: string;
    readonly flattenName?: boolean;
    readonly markdown?: boolean;
    readonly recursive?: boolean;
  } = {}
): Promise<AgentSourceRef[]> {
  const directory = join(root, directoryName);
  if (!(await _exists(directory, "directory"))) return [];
  const result: AgentSourceRef[] = [];

  async function visit(current: string): Promise<void> {
    for (const entry of await _sortedEntries(current)) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory() && options.recursive !== false) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const markdown =
        options.markdown === true && entry.name.toLowerCase().endsWith(".md");
      const base = moduleBaseName(entry.name);
      if (!markdown && base === null) continue;
      const relativeFromDirectory = _logical(
        relative(directory, absolute)
      ).replace(markdown ? /\.md$/i : /\.(?:cts|mts|cjs|mjs|ts|js)$/, "");
      const segments = relativeFromDirectory.split("/");
      const invalid = segments.find((segment) =>
        options.namePattern === undefined
          ? false
          : !options.namePattern.test(segment)
      );
      if (invalid !== undefined) {
        diagnostics.push(
          _diagnostic(
            options.diagnosticCode ?? "discover/name-invalid",
            `"${invalid}" is not a legal ${directoryName} name.`,
            absolute
          )
        );
        continue;
      }
      const name = options.flattenName
        ? relativeFromDirectory.replaceAll("/", "-")
        : relativeFromDirectory;
      const logicalPath = _logical(relative(root, absolute));
      result.push(
        markdown
          ? _markdownRef(logicalPath, name)
          : _moduleRef(logicalPath, name)
      );
    }
  }

  await visit(directory);
  return result;
}

async function _skills(
  root: string,
  diagnostics: AgentDiagnostic[]
): Promise<AgentSourceRef[]> {
  const directory = join(root, "skills");
  if (!(await _exists(directory, "directory"))) return [];
  const result: AgentSourceRef[] = [];
  for (const entry of await _sortedEntries(directory)) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      const markdownPath = join(absolute, "SKILL.md");
      if (!(await _exists(markdownPath, "file"))) {
        diagnostics.push(
          _diagnostic(
            "discover/skill-markdown-missing",
            `Skill package "${entry.name}" requires SKILL.md.`,
            absolute
          )
        );
        continue;
      }
      result.push({
        logicalPath: `skills/${entry.name}/SKILL.md`,
        moduleId: `skills/${entry.name}`,
        name: entry.name,
        sourceKind: "skill-package",
      });
      continue;
    }
    if (!entry.isFile()) continue;
    if (moduleBaseName(entry.name) === "index") continue;
    if (entry.name.toLowerCase().endsWith(".md")) {
      result.push(
        _markdownRef(`skills/${entry.name}`, basename(entry.name, ".md"))
      );
      continue;
    }
    const base = moduleBaseName(entry.name);
    if (base !== null) result.push(_moduleRef(`skills/${entry.name}`, base));
  }
  return result;
}

async function _extensions(
  root: string,
  appRoot: string,
  diagnostics: AgentDiagnostic[]
): Promise<AgentExtensionSourceRef[]> {
  const directory = join(root, "extensions");
  if (!(await _exists(directory, "directory"))) return [];
  const result: AgentExtensionSourceRef[] = [];
  const claimed = new Set<string>();

  for (const entry of await _sortedEntries(directory)) {
    const absolute = join(directory, entry.name);
    if (entry.isFile()) {
      const name = moduleBaseName(entry.name);
      if (name === null) continue;
      if (!GENERIC_NAME.test(name)) {
        diagnostics.push(
          _diagnostic(
            "discover/extension-name-invalid",
            `"${name}" is not a legal extensions name.`,
            absolute
          )
        );
        continue;
      }
      if (claimed.has(name)) {
        diagnostics.push(
          _diagnostic(
            "discover/extension-namespace-collision",
            `Extension namespace "${name}" is claimed by both file and directory mounts.`,
            absolute
          )
        );
        continue;
      }
      claimed.add(name);
      result.push(_moduleRef(`extensions/${entry.name}`, name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const namespace = entry.name;
    if (!GENERIC_NAME.test(namespace)) {
      diagnostics.push(
        _diagnostic(
          "discover/extension-name-invalid",
          `"${namespace}" is not a legal extensions name.`,
          absolute
        )
      );
      continue;
    }
    const mount = await _moduleSlot(absolute, "extension", diagnostics, true);
    if (mount === undefined) continue;
    if (claimed.has(namespace)) {
      diagnostics.push(
        _diagnostic(
          "discover/extension-namespace-collision",
          `Extension namespace "${namespace}" is claimed by both file and directory mounts.`,
          absolute
        )
      );
      continue;
    }
    claimed.add(namespace);
    const overrides = await _discoverNode({
      agentRoot: absolute,
      appRoot,
      agentId: namespace,
      diagnostics,
      nodeKind: "extension",
    });
    result.push({
      ..._moduleRef(`extensions/${namespace}/${mount.logicalPath}`, namespace),
      overrides,
    });
  }
  return result;
}

async function _sandbox(
  root: string,
  diagnostics: AgentDiagnostic[]
): Promise<{ sandbox?: AgentSourceRef; workspace: AgentSourceRef[] }> {
  const flat = await _moduleSlot(root, "sandbox", diagnostics);
  const directory = join(root, "sandbox");
  let nested: AgentSourceRef | undefined;
  if (await _exists(directory, "directory")) {
    const nestedRef = await _moduleSlot(directory, "sandbox", diagnostics);
    if (nestedRef !== undefined)
      nested = _moduleRef(`sandbox/${nestedRef.logicalPath}`);
  }
  if (flat !== undefined && nested !== undefined) {
    diagnostics.push(
      _diagnostic(
        "discover/slot-collision",
        "The sandbox slot cannot be declared by both sandbox.ts and sandbox/sandbox.ts.",
        root
      )
    );
  }
  const workspace: AgentSourceRef[] = [];
  const workspaceRoot = join(directory, "workspace");
  if (await _exists(workspaceRoot, "directory")) {
    async function visit(current: string): Promise<void> {
      for (const entry of await _sortedEntries(current)) {
        const absolute = join(current, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
          const logicalPath = _logical(relative(root, absolute));
          workspace.push({
            logicalPath,
            moduleId: logicalPath,
            sourceKind: "workspace",
          });
        }
      }
    }
    await visit(workspaceRoot);
  }
  return { sandbox: flat ?? nested, workspace };
}

async function _agentId(
  appRoot: string,
  fallbackRoot: string
): Promise<string> {
  try {
    const parsed = JSON.parse(
      await readFile(join(appRoot, "package.json"), "utf8")
    ) as {
      name?: unknown;
    };
    if (typeof parsed.name === "string" && parsed.name.length > 0)
      return parsed.name;
  } catch {
    // Directory basename is the documented fallback.
  }
  return basename(fallbackRoot);
}

async function _diagnoseUnsupportedExtensionSlots(
  root: string,
  diagnostics: AgentDiagnostic[]
): Promise<void> {
  const unsupported = new Set([
    "agent",
    "channels",
    "extensions",
    "instrumentation",
    "sandbox",
    "schedules",
    "subagents",
  ]);
  for (const entry of await _sortedEntries(root)) {
    const slot = entry.isDirectory() ? entry.name : moduleBaseName(entry.name);
    if (slot === null || !unsupported.has(slot)) continue;
    diagnostics.push(
      _diagnostic(
        "discover/extension-slot-unsupported",
        `Extension source cannot contribute the "${slot}" Agent definition slot.`,
        join(root, entry.name)
      )
    );
  }
}

async function _discoverNode(input: {
  readonly agentRoot: string;
  readonly appRoot: string;
  readonly agentId: string;
  readonly diagnostics: AgentDiagnostic[];
  readonly nodeKind: "extension" | "root" | "subagent";
}): Promise<AgentSourceManifest> {
  const { agentRoot, appRoot, diagnostics } = input;
  if (input.nodeKind === "extension") {
    await _diagnoseUnsupportedExtensionSlots(agentRoot, diagnostics);
  }
  const agent = await _moduleSlot(
    agentRoot,
    "agent",
    diagnostics,
    input.nodeKind === "subagent"
  );
  const instructions = await _instructions(
    agentRoot,
    diagnostics,
    input.nodeKind === "root"
  );
  const tools = await _moduleDirectory(agentRoot, "tools", diagnostics, {
    diagnosticCode: "discover/tool-name-invalid",
    flattenName: true,
    namePattern: TOOL_NAME,
  });
  const hooks = await _moduleDirectory(agentRoot, "hooks", diagnostics, {
    diagnosticCode: "discover/hook-name-invalid",
    namePattern: GENERIC_NAME,
  });
  const channels =
    input.nodeKind === "root"
      ? await _moduleDirectory(agentRoot, "channels", diagnostics, {
          diagnosticCode: "discover/channel-name-invalid",
          namePattern: GENERIC_NAME,
        })
      : [];
  const connections = await _moduleDirectory(
    agentRoot,
    "connections",
    diagnostics,
    {
      diagnosticCode: "discover/connection-name-invalid",
      namePattern: CONNECTION_NAME,
    }
  );
  const extensions =
    input.nodeKind === "root"
      ? await _extensions(agentRoot, appRoot, diagnostics)
      : [];
  const schedules =
    input.nodeKind === "root"
      ? await _moduleDirectory(agentRoot, "schedules", diagnostics, {
          diagnosticCode: "discover/schedule-name-invalid",
          markdown: true,
          namePattern: GENERIC_NAME,
        })
      : [];
  const skills = await _skills(agentRoot, diagnostics);
  const discoveredSkillsVariable = await _moduleSlot(
    join(agentRoot, "skills"),
    "index",
    diagnostics
  );
  const skillsVariable =
    discoveredSkillsVariable === undefined
      ? undefined
      : _moduleRef(`skills/${discoveredSkillsVariable.logicalPath}`);
  const sandbox =
    input.nodeKind === "extension"
      ? { sandbox: undefined, workspace: [] }
      : await _sandbox(agentRoot, diagnostics);
  const instrumentation =
    input.nodeKind === "root"
      ? await _moduleSlot(agentRoot, "instrumentation", diagnostics)
      : undefined;
  const subagents: AgentSourceManifest[] = [];
  const subagentDirectory = join(agentRoot, "subagents");
  if (
    input.nodeKind !== "extension" &&
    (await _exists(subagentDirectory, "directory"))
  ) {
    for (const entry of await _sortedEntries(subagentDirectory)) {
      if (entry.isDirectory()) {
        if (!GENERIC_NAME.test(entry.name)) {
          diagnostics.push(
            _diagnostic(
              "discover/subagent-name-invalid",
              `"${entry.name}" is not a legal subagent name.`,
              join(subagentDirectory, entry.name)
            )
          );
          continue;
        }
        subagents.push(
          await _discoverNode({
            agentRoot: join(subagentDirectory, entry.name),
            appRoot,
            agentId: entry.name,
            diagnostics,
            nodeKind: "subagent",
          })
        );
        continue;
      }
      if (!entry.isFile()) continue;
      const name = moduleBaseName(entry.name);
      if (name === null) continue;
      if (!GENERIC_NAME.test(name)) {
        diagnostics.push(
          _diagnostic(
            "discover/subagent-name-invalid",
            `"${name}" is not a legal subagent name.`,
            join(subagentDirectory, entry.name)
          )
        );
        continue;
      }
      subagents.push({
        kind: "llm-space-agent-source-manifest",
        agentId: name,
        agentRoot,
        appRoot,
        agent: _moduleRef(`subagents/${entry.name}`),
        channels: [],
        connections: [],
        extensions: [],
        hooks: [],
        instructions: [],
        sandboxWorkspace: [],
        schedules: [],
        skills: [],
        subagents: [],
        tools: [],
      });
    }
  }
  return {
    kind: "llm-space-agent-source-manifest",
    agentId: input.agentId,
    agentRoot,
    appRoot,
    ...(agent === undefined ? {} : { agent }),
    channels,
    connections,
    extensions,
    hooks,
    instructions,
    ...(instrumentation === undefined ? {} : { instrumentation }),
    ...(sandbox.sandbox === undefined ? {} : { sandbox: sandbox.sandbox }),
    sandboxWorkspace: sandbox.workspace,
    schedules,
    skills,
    ...(skillsVariable === undefined ? {} : { skillsVariable }),
    subagents,
    tools,
  };
}

export async function discoverAgent(
  options: DiscoverAgentOptions = {}
): Promise<DiscoverAgentResult> {
  const project: ResolvedAgentProject = await resolveAgentProject(options);
  const diagnostics: AgentDiagnostic[] = [];
  const manifest = await _discoverNode({
    agentRoot: project.agentRoot,
    appRoot: project.appRoot,
    agentId: await _agentId(project.appRoot, project.agentRoot),
    diagnostics,
    nodeKind: "root",
  });
  return { diagnostics, manifest, project };
}

export async function discoverExtensionSource(input: {
  readonly appRoot: string;
  readonly packageName: string;
  readonly sourceRoot: string;
}): Promise<{
  readonly diagnostics: readonly AgentDiagnostic[];
  readonly manifest: AgentSourceManifest;
}> {
  const diagnostics: AgentDiagnostic[] = [];
  const manifest = await _discoverNode({
    agentRoot: input.sourceRoot,
    appRoot: input.appRoot,
    agentId: input.packageName,
    diagnostics,
    nodeKind: "extension",
  });
  return { diagnostics, manifest };
}
