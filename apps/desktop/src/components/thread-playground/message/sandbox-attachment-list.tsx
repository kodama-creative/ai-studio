import { FileIcon, XIcon } from "lucide-react";
import { memo, useCallback } from "react";

import type { SandboxAttachmentDescriptor } from "@llm-space/core";

import { Tooltip } from "../../tooltip";
import { Button } from "../../ui/button";
import { useThreadStore, useThreadStoreActions } from "../stores";

const _SandboxAttachmentList = function SandboxAttachmentList({
  attachments,
  messageId,
  readonly
}: {
  readonly attachments: readonly SandboxAttachmentDescriptor[];
  readonly messageId: string;
  readonly readonly?: boolean;
}) {
  const { removeMessageSandboxAttachment } = useThreadStoreActions();
  const running = useThreadStore(state => state.status === "running");
  const remove = useCallback((attachmentId: string) => {
    removeMessageSandboxAttachment(messageId, attachmentId);
  }, [messageId, removeMessageSandboxAttachment]);
  if (attachments.length === 0) { return null; }
  return (
    <div
      aria-label="Staged attachments"
      className="flex flex-wrap gap-1.5 px-2 pt-2"
    >
      {attachments.map(attachment => (
        <div
          className="border-border bg-muted/40 flex min-w-0 max-w-64 items-center gap-1 rounded-md border px-2 py-1 text-xs"
          key={attachment.id}
          title={attachment.path}
        >
          <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{attachment.name}</span>
          <span className="text-muted-foreground shrink-0">
            {_formatBytes(attachment.size)}
          </span>
          {readonly || running
            ? null
            : (
              <Tooltip content="Remove attachment">
                <Button
                  aria-label={`Remove attachment ${attachment.name}`}
                  className="-mr-1 size-5"
                  onClick={() => { remove(attachment.id); }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <XIcon className="size-3" />
                </Button>
              </Tooltip>
            )}
        </div>
      ))}
    </div>
  );
};

export const SandboxAttachmentList = memo(_SandboxAttachmentList);

function _formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}
