/** Open Monaco Go-to-Definition / refs targets in Vigil editor tabs. */

import type { Monaco } from "@monaco-editor/react";
import { monacoResourceToPath } from "./monaco-file-uri";
import { openAndRevealFile } from "./open-workspace-file";

let installed = false;

export function installMonacoEditorOpener(monaco: Monaco): void {
  if (installed) return;
  installed = true;

  monaco.editor.registerEditorOpener({
    async openCodeEditor(_source, resource, selectionOrPosition) {
      const path = monacoResourceToPath(resource);
      if (!path) return false;
      let line = 1;
      if (selectionOrPosition) {
        if ("startLineNumber" in selectionOrPosition) {
          line = Number(selectionOrPosition.startLineNumber) || 1;
        } else if ("lineNumber" in selectionOrPosition) {
          line = Number(selectionOrPosition.lineNumber) || 1;
        }
      }
      await openAndRevealFile(path, { revealLine: line });
      return true;
    },
  });
}
