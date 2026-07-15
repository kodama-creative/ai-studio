export function qualifyProjectMcpToolName(
  connectionName: string,
  remoteToolName: string
): string {
  return `${connectionName}__${remoteToolName}`;
}
