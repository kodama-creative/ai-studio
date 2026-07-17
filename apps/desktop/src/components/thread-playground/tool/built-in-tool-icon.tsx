import {
  CircleHelpIcon,
  CloudSunIcon,
  Edit3Icon,
  FileOutputIcon,
  FileSearchIcon,
  FilesIcon,
  FileTextIcon,
  FolderSearchIcon,
  FolderTreeIcon,
  GlobeIcon,
  ListTodoIcon,
  ListTreeIcon,
  PackageCheckIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon
} from "lucide-react";

const ICON_KEY_BY_NAME: Record<string, string> = {
  read: "file-text",
  write: "file-output",
  edit: "pencil",
  ls: "list-tree",
  tree: "folder-tree",
  skill: "sparkles",
  grep: "file-search",
  glob: "folder-search",
  bash: "terminal",
  web_fetch: "globe",
  web_search: "search",
  weather_report: "cloud-sun",
  present_files: "files",
  todo_write: "list-todo",
  ask_user_question: "circle-help"
};

/** Render a built-in tool icon with a legacy name fallback. */
export function BuiltInToolIcon({
  tool,
  className
}: {
  readonly className?: string;
  readonly tool: { icon?: string; name: string; };
}) {
  const key = tool.icon ?? ICON_KEY_BY_NAME[tool.name];
  switch (key) {
    case "circle-help":
      return <CircleHelpIcon className={className} />;
    case "cloud-sun":
      return <CloudSunIcon className={className} />;
    case "file-output":
      return <FileOutputIcon className={className} />;
    case "file-search":
      return <FileSearchIcon className={className} />;
    case "file-text":
      return <FileTextIcon className={className} />;
    case "files":
      return <FilesIcon className={className} />;
    case "folder-search":
      return <FolderSearchIcon className={className} />;
    case "folder-tree":
      return <FolderTreeIcon className={className} />;
    case "globe":
      return <GlobeIcon className={className} />;
    case "list-todo":
      return <ListTodoIcon className={className} />;
    case "list-tree":
      return <ListTreeIcon className={className} />;
    case "pencil":
      return <Edit3Icon className={className} />;
    case "search":
      return <SearchIcon className={className} />;
    case "sparkles":
      return <SparklesIcon className={className} />;
    case "terminal":
      return <TerminalIcon className={className} />;
    case undefined:
      return <PackageCheckIcon className={className} />;
    default:
      return <PackageCheckIcon className={className} />;
  }
}
