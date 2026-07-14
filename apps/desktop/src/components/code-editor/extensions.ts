import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { CodeEditorLanguage } from "./editor";

export function createExtensions(language: CodeEditorLanguage | "none") {
  const extensions: Extension[] = [EditorView.lineWrapping];
  switch (language) {
    case "none":
      break;
    case "json":
      extensions.push(json());
      break;
    case "javascript":
      extensions.push(javascript());
      break;
    case "typescript":
      extensions.push(javascript({ typescript: true }));
      break;
    default:
      extensions.push(
        markdown({
          codeLanguages: languages,
        })
      );
      break;
  }
  return extensions;
}
