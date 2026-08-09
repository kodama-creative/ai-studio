import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai";

export class ExampleFauxModel {
  readonly provider: FauxProviderHandle;

  constructor() {
    this.provider = fauxProvider({
      provider: "faux",
      models: [{ id: "local", name: "Local deterministic example" }],
      tokensPerSecond: 0,
    });
  }

  queueTurn(): void {
    this.provider.appendResponses([_fauxResponse, _fauxResponse]);
  }
}

function _fauxResponse(context: Context) {
  const last = context.messages.at(-1);
  if (last?.role === "toolResult") {
    const text = last.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    const count = _asCount(text);
    return fauxAssistantMessage(
      `The message contains ${count} ${count === 1 ? "word" : "words"}.`
    );
  }
  return fauxAssistantMessage(
    fauxToolCall("word-count", { text: _lastUserText(context) }),
    { stopReason: "toolUse" }
  );
}

function _asCount(value: string): number {
  try {
    const parsed = JSON.parse(value) as { readonly count?: unknown };
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function _lastUserText(context: Context): string {
  const message = context.messages.findLast((entry) => entry.role === "user");
  if (message?.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
