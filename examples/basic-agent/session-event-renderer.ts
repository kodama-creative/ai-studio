import type { RunFrame } from "@llm-space/engine";

/** Renders durable Run snapshots/events without owning Run execution lifetime. */
export async function renderRun(
  frames: AsyncIterable<RunFrame>,
  write: (value: string) => void
): Promise<void> {
  for await (const frame of frames) {
    if (frame.type === "snapshot") {
      for (const output of frame.outputs) {
        const text = output.message.content.map((part) => part.text).join("\n");
        if (text.length > 0) write(text);
      }
    } else if (frame.event.type === "message.delta") {
      write(frame.event.delta);
    }
  }
}
