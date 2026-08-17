import { basename } from "node:path";

import { Utils } from "electrobun/bun";

import type { ImportFilePayload } from "../../shared/commands";

function _normalizeSelectedPaths(paths: string[]): string[] {
  return paths.map((path) => path.trim()).filter(Boolean);
}

async function _readImportFile(path: string): Promise<ImportFilePayload> {
  return {
    name: basename(path),
    text: await Bun.file(path).text(),
  };
}

/**
 * Native import entrypoint for the application menu. The renderer still owns
 * parsing/writing so imports use the same model normalization as drag/drop.
 */
export async function importFilesWithNativePicker(
): Promise<readonly ImportFilePayload[]> {
  const paths = _normalizeSelectedPaths(
    await Utils.openFileDialog({
      startingFolder: Utils.paths.documents,
      allowedFileTypes: "json,jsonl",
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: true,
    })
  );
  if (paths.length === 0) return [];

  return Promise.all(paths.map((path) => _readImportFile(path)));
}

/**
 * Native clipboard import entrypoint. Clipboard access belongs to the bun side;
 * the renderer still owns parsing/writing through the regular file-import path.
 */
export function importTextFromClipboard(): readonly ImportFilePayload[] {
  const text = Utils.clipboardReadText();
  return [{ name: "clipboard.json", text: text ?? "" }];
}
