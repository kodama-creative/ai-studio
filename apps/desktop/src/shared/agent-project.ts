export interface AgentProjectView {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly agentRoot: string;
  readonly agentId: string;
  readonly generationId: string;
}

export type DesktopWindowContext =
  | { readonly kind: "playground" }
  | { readonly kind: "agentProject"; readonly project: AgentProjectView };
