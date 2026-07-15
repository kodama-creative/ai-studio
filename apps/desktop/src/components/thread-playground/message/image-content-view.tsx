import { XIcon } from "lucide-react";
import React, { useCallback, useState } from "react";

import type { ImageDataContent } from "@llm-space/core";

import { cn } from "@/lib/utils";
import { Tooltip } from "../../tooltip";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/dialog";
import { useThreadStoreActions } from "../stores";

const FRAME_SIZE_PX = 192; // size-48

const _ImageContentView = function ImageContentView({
  image,
  readonly,
  onRemove,
  className
}: {
  readonly className?: string;
  readonly image: ImageDataContent;
  readonly onRemove?: () => void;
  readonly readonly?: boolean;
}) {
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [previewOpen, setPreviewOpen] = useState(false);

  const imageSrc = `data:${image.mimeType};base64,${image.data}`;

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      setFit(
        naturalWidth <= FRAME_SIZE_PX && naturalHeight <= FRAME_SIZE_PX
          ? "contain"
          : "cover"
      );
    },
    []
  );

  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove]
  );

  const handleOpenPreview = useCallback(() => {
    setPreviewOpen(true);
  }, []);

  return (
    <>
      <div
        aria-label="Open image preview"
        className={cn(
          "group/image relative flex size-48 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border shadow",
          className
        )}
        onClick={handleOpenPreview}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleOpenPreview();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <img
          alt=""
          className={cn(
            fit === "cover"
              ? "size-full object-cover"
              : "max-h-full max-w-full object-contain"
          )}
          onLoad={handleLoad}
          src={imageSrc}
        />
        {!readonly && onRemove
          ? (
            <Tooltip content="Remove image">
              <Button
                aria-label="Remove image"
                className="bg-background/80 absolute top-1 right-1 rounded-full border opacity-0 transition-opacity group-hover/image:opacity-100"
                onClick={handleRemove}
                size="icon-sm"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </Tooltip>
          )
          : null}
      </div>

      <Dialog onOpenChange={setPreviewOpen} open={previewOpen}>
        <DialogContent
          className="top-0 left-0 flex h-dvh max-h-none w-dvw max-w-none translate-x-0 translate-y-0 cursor-zoom-out items-center justify-center rounded-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
          onClick={() => { setPreviewOpen(false); }}
          showCloseButton
        >
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          <img
            alt=""
            className="max-h-[95vh] max-w-[95vw] cursor-default object-contain"
            onClick={event => { event.stopPropagation(); }}
            src={imageSrc}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export const ImageContentView = React.memo(_ImageContentView);

const _ImageContentList = function ImageContentList({
  messageId,
  images,
  readonly,
  className
}: {
  readonly className?: string;
  readonly images: Array<{ content: ImageDataContent; contentIndex: number; }>;
  readonly messageId: string;
  readonly readonly?: boolean;
}) {
  const { removeMessageImageContent } = useThreadStoreActions();

  if (images.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex w-full flex-wrap gap-3 px-3 pt-2", className)}>
      {images.map(({ content, contentIndex }) => (
        <ImageContentView
          image={content}
          key={`${content.mimeType}-${contentIndex}`}
          onRemove={() => {
            removeMessageImageContent(messageId, contentIndex);
          }}
          readonly={readonly}
        />
      ))}
    </div>
  );
};

export const ImageContentList = React.memo(_ImageContentList);
