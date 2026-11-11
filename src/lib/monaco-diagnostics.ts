/** Wire Monaco TS/JS language service markers into the Problems store. */

import type { Monaco } from "@monaco-editor/react";
import {
  isTsJsPath,
  monacoSeverityToProblem,
  type EditorProblem,
} from "./editor-diagnostics";
import { useTerminalStore } from "../store/terminalStore";

let configured = false;
let markerSub: { dispose: () => void } | null = null;

export function configureMonacoTsJs(monaco: Monaco): void {
  if (configured) return;
  configured = true;

  const compilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: true,
    esModuleInterop: true,
    isolatedModules: true,
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  const sync = () => {
    const markers = monaco.editor.getModelMarkers({});
    const problems: EditorProblem[] = [];
    for (const marker of markers) {
      const path = marker.resource?.fsPath || marker.resource?.path || "";
      if (!path || !isTsJsPath(path)) continue;
      if (!marker.message) continue;
      problems.push({
        id: `${path}:${marker.startLineNumber}:${marker.startColumn}:${marker.code ?? marker.message}`,
        path,
        message: marker.message,
        severity: monacoSeverityToProblem(marker.severity),
        line: marker.startLineNumber,
        column: marker.startColumn,
        source: marker.source || "typescript",
      });
    }
    useTerminalStore.getState().setProblems(problems);
  };

  markerSub?.dispose();
  markerSub = monaco.editor.onDidChangeMarkers(() => sync());
  sync();
}
