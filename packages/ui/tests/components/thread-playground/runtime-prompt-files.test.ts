import { describe, expect, test } from "bun:test";

import { renderThreadPromptVariables } from "@llm-space/core/thread";
import type { ThreadContext } from "@llm-space/core/types";

import { createGenerateProjectPromptPreparer } from "../../../src/components/thread-playground/codegen/generate-project-prompt-preparer";
import { createPromptFiles } from "../../../src/components/thread-playground/runtime-prompt-files";
import { createThreadStore } from "../../../src/components/thread-playground/stores/thread-store";
import type { FilesHost } from "../../../src/host/types";

describe("prompt files", () => {
  test("prepares generated projects through the injected file host", async () => {
    const accesses: string[] = [];
    const files = {
      readText: (path: string): Promise<string> => {
        accesses.push(path);
        return Promise.resolve("FILE SENTINEL");
      },
      exists: () => Promise.resolve(true),
      directoryExists: () => Promise.resolve(null),
      pickFile: () => Promise.resolve(null),
      pickDirectory: () => Promise.resolve(null),
    } satisfies FilesHost;
    const store = createThreadStore(
      {
        context: {
          systemPrompt:
            '{{@include("/workspace/same.md")}} | {{ document }}',
          variables: {
            document: { type: "file", value: "/workspace/same.md" },
          },
        },
      }
    );
    const preparePrompt = createGenerateProjectPromptPreparer({
      files,
      store,
    });
    const prepared = await preparePrompt({
      skillList: [],
      useMetaUserPrompt: false,
    });

    expect(prepared.rendered.context.systemPrompt).toBe(
      "FILE SENTINEL | FILE SENTINEL"
    );
    expect(prepared.systemPromptTemplate).toBe(
      "FILE SENTINEL | {{ document }}"
    );
    expect(accesses.length).toBeGreaterThan(0);
    expect(accesses.every((path) => path === "/workspace/same.md")).toBe(true);
  });

  test("resolves includes, exists, file variables, and AGENTS.md through one file host", async () => {
    const hostFiles: Record<string, string> = {
      "/workspace/AGENTS.md":
        'HOST AGENTS {{@include("/workspace/nested.md")}}',
      "/workspace/nested.md": "HOST NESTED",
      "/workspace/document.md": "HOST FILE VARIABLE",
      "~/note.md": "HOST HOME",
    };
    const accesses: {
      operation: "read" | "exists";
      path: string;
    }[] = [];
    const files = {
      readText: (path: string): Promise<string> => {
        accesses.push({ operation: "read", path });
        return Promise.resolve(hostFiles[path] ?? "");
      },
      exists: (path: string): Promise<boolean> => {
        accesses.push({ operation: "exists", path });
        return Promise.resolve(Object.hasOwn(hostFiles, path));
      },
      directoryExists: () => Promise.resolve(null),
      pickFile: () => Promise.resolve(null),
      pickDirectory: () => Promise.resolve(null),
    } satisfies FilesHost;
    const promptFiles = createPromptFiles(files);
    const context: ThreadContext = {
      systemPrompt: `
{% set agents_path = current_working_directory ~ "/AGENTS.md" %}
{% if exists(agents_path) %}{{@include((agents_path))}}{% endif %}
|{{ doc }}
|{{@include("~/note.md")}}
|{{@include("/workspace/local-only.md")}}
|{% if exists("/workspace/unreadable.md") %}LEAK{% else %}SAFE{% endif %}`,
      variables: {
        current_working_directory: {
          type: "workingDirectory",
          value: "/workspace",
        },
        doc: { type: "file", value: "/workspace/document.md" },
      },
    };

    const rendered = await renderThreadPromptVariables({
      context,
      loadFile: promptFiles.loadFile,
      fileExists: promptFiles.fileExists,
    });

    expect((rendered.context.systemPrompt ?? "").replace(/\s+/g, " ").trim()).toBe(
      "HOST AGENTS HOST NESTED |HOST FILE VARIABLE |HOST HOME | |SAFE"
    );
    expect(accesses.length).toBeGreaterThan(0);
    expect(accesses).toContainEqual({
      operation: "read",
      path: "~/note.md",
    });
  });
});
