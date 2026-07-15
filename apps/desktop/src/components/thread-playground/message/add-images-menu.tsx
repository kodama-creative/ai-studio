"use client";

import { ClipboardPasteIcon, FileIcon, ImagePlusIcon } from "lucide-react";
import { useCallback, useRef } from "react";

import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "../../ui/dropdown-menu";
import { useThreadStoreActions } from "../stores/thread-store";

function readImageFile(
  file: File,

  onSuccess: (mimeType: string, data: string) => void
) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    const [, mimeType, data] = match ?? [];
    if (mimeType && data) {
      onSuccess(mimeType, data);
    }
  };
  reader.readAsDataURL(file);
}

export function AddImagesMenu({
  messageId,
  disabled
}: {
  readonly disabled?: boolean;
  readonly messageId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addMessageImageContent } = useThreadStoreActions();

  const addImage = useCallback(
    (mimeType: string, data: string) => {
      addMessageImageContent(messageId, mimeType, data);
    },
    [addMessageImageContent, messageId]
  );

  const handleFilesSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) {
        return;
      }
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          readImageFile(file, addImage);
        }
      }
      event.target.value = "";
    },
    [addImage]
  );

  const handleFromFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const file = new File([blob], "clipboard-image", { type });
            readImageFile(file, addImage);
            return;
          }
        }
      }
    } catch {
      // Clipboard access denied or no image available.
    }
  }, [addImage]);

  return (
    <>
      <input
        accept="image/*"
        aria-label="Image files"
        className="hidden"
        multiple
        onChange={handleFilesSelected}
        ref={fileInputRef}
        type="file"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Add image to message"
            disabled={disabled}
            size="icon-sm"
            variant="ghost"
          >
            <ImagePlusIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Add Images</DropdownMenuLabel>
          <DropdownMenuItem onSelect={handleFromFiles}>
            <FileIcon />
            From Files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleFromClipboard}>
            <ClipboardPasteIcon />
            From Clipboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
