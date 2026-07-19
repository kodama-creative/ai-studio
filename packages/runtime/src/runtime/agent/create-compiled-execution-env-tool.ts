import { Type } from "typebox";

import type { CompiledProjectTool } from "./agent-project-snapshot";
import type { ExecutionEnvToolKind } from "../../public/definitions/execution-env-tool";

const DEFINITIONS = {
  bash: {
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to the last 2000 lines or 50KB; truncated full output is saved to an environment-addressed temporary file. Optionally provide a timeout in seconds.",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(Type.Number({
        description: "Timeout in seconds (optional, no default timeout)"
      }))
    })
  },
  read: {
    description:
      "Read a UTF-8 text file. Output is truncated to 2000 lines or 50KB, whichever is reached first. Use offset and limit to continue through large files.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the file to read (relative or absolute)"
      }),
      offset: Type.Optional(Type.Number({
        description: "Line number to start reading from (1-indexed)"
      })),
      limit: Type.Optional(Type.Number({
        description: "Maximum number of lines to read"
      }))
    })
  },
  write: {
    description:
      "Write UTF-8 text to a file. Creates the file and parent directories when supported, and overwrites an existing file.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the file to write (relative or absolute)"
      }),
      content: Type.String({ description: "Content to write to the file" })
    })
  }
} as const;

export function createCompiledExecutionEnvTool(
  kind: ExecutionEnvToolKind,
  sourcePath: string
): CompiledProjectTool {
  const definition = DEFINITIONS[kind];
  return {
    name: kind,
    label: kind,
    description: definition.description,
    parameters: definition.parameters,
    executionEnvToolKind: kind,
    requiresExecutionEnv: true,
    sourcePath,
    async execute() {
      throw new Error(`ExecutionEnv tool "${kind}" was not bound by the Host`);
    }
  };
}
