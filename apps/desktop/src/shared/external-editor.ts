export const EXTERNAL_EDITORS = [
  {
    id: "vscode",
    label: "VS Code",
    command: "code",
    appName: "Visual Studio Code"
  },
  { id: "zed", label: "Zed", command: "zed", appName: "Zed" },
  { id: "cursor", label: "Cursor", command: "cursor", appName: "Cursor" }
] as const;

export type ExternalEditorId = (typeof EXTERNAL_EDITORS)[number]["id"];

export interface ExternalEditorOption {
  available: boolean;
  id: ExternalEditorId;
  label: string;
}

export interface ExternalEditorStatus {
  editors: ExternalEditorOption[];
  preferredEditorId: ExternalEditorId | null;
}
