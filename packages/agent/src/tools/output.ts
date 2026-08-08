export type ToolModelOutputPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "file";
      readonly data: { readonly type: "data"; readonly data: string };
      readonly mediaType: string;
      readonly filename?: string;
    };

export type ToolModelOutput =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "json"; readonly value: unknown }
  | {
      readonly type: "content";
      readonly value: readonly ToolModelOutputPart[];
    };

export const toolOutput = {
  text(value: string): ToolModelOutput {
    return { type: "text", value };
  },
  json(value: unknown): ToolModelOutput {
    return { type: "json", value };
  },
  content(value: readonly ToolModelOutputPart[]): ToolModelOutput {
    return { type: "content", value };
  },
};

export const toolOutputPart = {
  text(text: string): ToolModelOutputPart {
    return { type: "text", text };
  },
  file(
    base64: string,
    options: { readonly mediaType: string; readonly filename?: string }
  ): ToolModelOutputPart {
    return {
      type: "file",
      data: { type: "data", data: base64 },
      mediaType: options.mediaType,
      ...(options.filename === undefined ? {} : { filename: options.filename }),
    };
  },
};
