import type { AgentSession } from "@llm-space/harness";

export async function renderSessionTurn(
  session: AgentSession,
  afterSequence: number,
  write: (value: string) => void
): Promise<void> {
  for await (const item of session.events({
    afterSequence,
    follow: true,
  })) {
    if (item.event.type === "message.appended") {
      write(item.event.delta);
    }
    if (
      item.event.type === "session.waiting" ||
      item.event.type === "session.completed" ||
      item.event.type === "session.failed"
    ) {
      return;
    }
  }
}
