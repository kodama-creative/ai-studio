import type {
  PluginCommandReport,
  PluginCommandUserMessage,
} from "@llm-space/core";

/** Transient business progress emitted while one Plugin Command executes. */
export type PluginCommandExecutionEvent =
  | {
      executionId: string;
      commandId: string;
      type: "status";
      status: "running" | "succeeded" | "failed";
      userMessage?: PluginCommandUserMessage;
    }
  | {
      executionId: string;
      commandId: string;
      type: "phase";
      report: PluginCommandReport;
    };
