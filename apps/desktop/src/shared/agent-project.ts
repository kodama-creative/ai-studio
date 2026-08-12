export interface AgentProjectView {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly agentRoot: string;
  readonly agentId: string;
  readonly generationId: string;
}

/** Main-window catalog entry; Experiments remain owned by the Project window. */
export interface AgentProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
}

export type DesktopWindowContext =
  | { readonly kind: "playground" }
  | { readonly kind: "agentProject"; readonly project: AgentProjectView };
