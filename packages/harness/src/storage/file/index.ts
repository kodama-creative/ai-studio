import { KeyedOperationCoordinator } from "../../internal/keyed-operation-coordinator";

import { FileChannelBindingRepository } from "./file-channel-binding-repository";
import { FileSessionCommandQueue } from "./file-session-command-queue";
import { FileSessionRepository } from "./file-session-repository";
import { JsonlSessionEventLog } from "./jsonl-session-event-log";

export { FileSessionCommandQueue } from "./file-session-command-queue";
export { FileSessionRepository } from "./file-session-repository";
export { JsonlSessionEventLog } from "./jsonl-session-event-log";

export function createFileSessionStorage(root: string): {
  readonly repository: FileSessionRepository;
  readonly eventLog: JsonlSessionEventLog;
  readonly commandQueue: FileSessionCommandQueue;
  readonly bindings: FileChannelBindingRepository;
} {
  const commandCoordinator = new KeyedOperationCoordinator();
  return {
    repository: new FileSessionRepository(root),
    eventLog: new JsonlSessionEventLog(root),
    commandQueue: new FileSessionCommandQueue(root, commandCoordinator),
    bindings: new FileChannelBindingRepository(root),
  };
}
export { FileChannelBindingRepository } from "./file-channel-binding-repository";
