import { memo } from "react";

import { CodeEditor } from "@/components/code-editor";
import { Markdown } from "@/components/markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PreviewType = "json" | "text";
export type PreviewMode = "code" | "html" | "markdown";

function _PreviewDialog({
  open,
  onOpenChange,
  title = "Preview",
  value,
  type = "text",
  mode = "code"
}: {
  readonly mode?: PreviewMode;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title?: string;
  readonly type?: PreviewType;
  readonly value: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[85vh] w-[85vw] max-w-none! flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {type === "json"
          ? (
            <div className="min-h-0 flex-1 p-3">
              <CodeEditor
                className="h-full opacity-100!"
                hideBorder
                hideFocusRing
                language="json"
                readonly
                value={value}
              />
            </div>
          )
          : (
            <Tabs
              className="min-h-0 flex-1 gap-0"
              defaultValue={
                mode === "markdown" ? "markdown" : mode === "html" ? "html" : "raw"
              }
            >
              <div className="border-b px-4 py-2">
                <TabsList variant="line">
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                  <TabsTrigger value="markdown">Markdown</TabsTrigger>
                  <TabsTrigger value="html">HTML</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent className="min-h-0 p-3" value="raw">
                <CodeEditor
                  className="h-full opacity-100!"
                  hideBorder
                  hideFocusRing
                  readonly
                  value={value}
                />
              </TabsContent>
              <TabsContent className="min-h-0 p-3" value="markdown">
                <Markdown className="size-full overflow-auto rounded-lg bg-(--textarea) px-3 py-2">
                  {value}
                </Markdown>
              </TabsContent>
              <TabsContent className="min-h-0 p-3" value="html">
                <iframe
                  className="size-full rounded-lg border bg-white"
                  referrerPolicy="no-referrer"
                  sandbox=""
                  srcDoc={value}
                  title={`${title} HTML preview`}
                />
              </TabsContent>
            </Tabs>
          )}
      </DialogContent>
    </Dialog>
  );
}

export const PreviewDialog = memo(_PreviewDialog);
