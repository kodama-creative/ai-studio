import { FileSessionRepository } from "./file-session-repository";
import { JsonlSessionEventLog } from "./jsonl-session-event-log";

export { FileSessionRepository } from "./file-session-repository";
export { JsonlSessionEventLog } from "./jsonl-session-event-log";

export function createFileSessionStorage(root: string): {
  readonly repository: FileSessionRepository;
  readonly eventLog: JsonlSessionEventLog;
} {
  return {
    repository: new FileSessionRepository(root),
    eventLog: new JsonlSessionEventLog(root),
  };
}
