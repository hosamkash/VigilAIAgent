import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { clearRecentProjects, projectName } from "./recent-projects";
import { monacoTrigger } from "./monaco-bridge";
import { readTextFile, runWorkspaceCommand, writeTextFile } from "./workspace-fs";
import { parseWorkspaceFolders, serializeWorkspace } from "./workspace-file";
import { useEditorTabsStore, type EditorTab } from "../store/editorTabsStore";
import { useExplorerStore } from "../store/explorerStore";
import { useLayoutStore, type SidebarView } from "../store/layoutStore";
import { useSettingsStore } from "../store/settingsStore";
import { useTerminalStore } from "../store/terminalStore";

const MONACO: Record<string, string> = {
  "edit.undo": "undo",
  "edit.redo": "redo",
  "edit.cut": "editor.action.clipboardCutAction",
  "edit.copy": "editor.action.clipboardCopyAction",
  "edit.paste": "editor.action.clipboardPasteAction",
  "edit.find": "actions.find",
  "edit.replace": "editor.action.startFindReplaceAction",
  "edit.comment": "editor.action.commentLine",
  "edit.blockComment": "editor.action.blockComment",
  "selection.all": "editor.action.selectAll",
  "selection.expand": "editor.action.smartSelect.expand",
  "selection.shrink": "editor.action.smartSelect.shrink",
  "selection.copyUp": "editor.action.copyLinesUpAction",
  "selection.copyDown": "editor.action.copyLinesDownAction",
  "selection.moveUp": "editor.action.moveLinesUpAction",
  "selection.moveDown": "editor.action.moveLinesDownAction",
  "selection.cursorAbove": "editor.action.insertCursorAbove",
  "selection.cursorBelow": "editor.action.insertCursorBelow",
  "selection.lineEnds": "editor.action.insertCursorAtEndOfEachLineSelected",
  "selection.next": "editor.action.addSelectionToNextFindMatch",
  "selection.allMatches": "editor.action.selectHighlights",
  "go.line": "editor.action.gotoLine",
  "go.symbol": "editor.action.quickOutline",
  "go.def": "editor.action.revealDefinition",
  "go.refs": "editor.action.goToReferences",
  "go.peek": "editor.action.peekDefinition",
};

export function isEditorCommand(id: string): boolean {
  return id in MONACO;
}

const messageListeners = new Set<(message: string) => void>();

export function onMenuMessage(fn: (message: string) => void) {
  messageListeners.add(fn);
  return () => {
    messageListeners.delete(fn);
  };
}

function toast(message: string) {
  for (const fn of messageListeners) fn(message);
}

let openPicker: (mode: "commands" | "files") => void = () => {};
let openAbout: () => void = () => {};

export function setPickerOpener(fn: (mode: "commands" | "files") => void) {
  openPicker = fn;
}

export function setAboutOpener(fn: () => void) {
  openAbout = fn;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fileTab(id?: string | null): EditorTab | null {
  const state = useEditorTabsStore.getState();
  const tab = state.tabs.find((entry) => entry.id === (id ?? state.activeId));
  if (!tab || tab.mode !== "file") return null;
  return tab;
}

function isUntitled(path: string): boolean {
  return path.startsWith("untitled:");
}

export function collectKnownFiles(): { path: string; name: string }[] {
  const map = new Map<string, string>();
  for (const tab of useEditorTabsStore.getState().tabs) {
    if (tab.mode === "file" && !isUntitled(tab.path)) map.set(tab.path, tab.title);
  }
  for (const entries of Object.values(useExplorerStore.getState().children)) {
    for (const entry of entries) {
      if (!entry.isDir) map.set(entry.path, entry.name);
    }
  }
  return [...map.entries()].map(([path, name]) => ({ path, name }));
}

export async function openEditorPath(path: string) {
  const content = await readTextFile(path);
  useExplorerStore.getState().closeLauncher();
  useEditorTabsStore.getState().openFile({ path, content });
}

async function saveAs(tab: EditorTab): Promise<boolean> {
  const suggested = isUntitled(tab.path) ? `${tab.title}.txt` : tab.path;
  const dest = await saveDialog({ defaultPath: suggested });
  if (typeof dest !== "string" || !dest) return false;
  await writeTextFile(dest, tab.content);
  useEditorTabsStore.getState().assignPath(tab.id, dest);
  const root = useExplorerStore.getState().root;
  if (root && dest.startsWith(root)) await useExplorerStore.getState().refresh();
  return true;
}

async function saveOne(tab: EditorTab): Promise<boolean> {
  if (isUntitled(tab.path)) return saveAs(tab);
  await writeTextFile(tab.path, tab.content);
  useEditorTabsStore.getState().markSaved(tab.id);
  return true;
}

async function openAppWindow(kind: "empty" | "agents" | "same") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (kind === "empty" || kind === "agents") url.searchParams.set("empty", "1");
  if (kind === "agents") url.searchParams.set("agents", "1");
  const href = url.toString();
  if (!inTauri()) {
    window.open(href, "_blank", "noopener");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `win-${crypto.randomUUID().slice(0, 8)}`;
  const win = new WebviewWindow(label, {
    url: href,
    title: kind === "agents" ? "Vigil Agents" : "Vigil AI Agent",
    width: 1280,
    height: 800,
    focus: true,
  });
  void win.once("tauri://error", () => {
    window.open(href, "_blank", "noopener");
  });
}

let zoom = 1;

async function applyZoom(next: number) {
  zoom = Math.min(2, Math.max(0.5, Math.round(next * 100) / 100));
  if (inTauri()) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(zoom);
    return;
  }
  document.documentElement.style.zoom = String(zoom);
}

function showView(view: SidebarView) {
  useExplorerStore.getState().closeLauncher();
  useLayoutStore.getState().showSidebar(view);
}

let runGeneration = 0;

async function runNpm(script: string) {
  const root = useExplorerStore.getState().root;
  if (!root) {
    toast("Open a folder first.");
    showView("run");
    return;
  }
  const generation = ++runGeneration;
  useLayoutStore.getState().setBottomTab("output");
  useTerminalStore.getState().appendOutput(`\n$ npm run ${script}\n`);
  const out = await runWorkspaceCommand(`npm run ${script}`, root);
  if (generation !== runGeneration) return;
  useTerminalStore.getState().appendOutput(`${out}\n`);
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

let suppressNav = false;
const backStack: string[] = [];
const forwardStack: string[] = [];

export function installEditorHistory() {
  return useEditorTabsStore.subscribe((state, prev) => {
    if (suppressNav) return;
    if (!prev.activeId || state.activeId === prev.activeId) return;
    if (!state.tabs.some((tab) => tab.id === prev.activeId)) return;
    backStack.push(prev.activeId);
    forwardStack.length = 0;
  });
}

function goHistory(dir: "back" | "forward") {
  const from = dir === "back" ? backStack : forwardStack;
  const to = dir === "back" ? forwardStack : backStack;
  const id = from.pop();
  const current = useEditorTabsStore.getState().activeId;
  if (!id || !useEditorTabsStore.getState().tabs.some((tab) => tab.id === id)) return;
  if (current) to.push(current);
  suppressNav = true;
  useEditorTabsStore.getState().setActive(id);
  suppressNav = false;
}

function cycleEditor(dir: 1 | -1) {
  const { tabs, activeId, setActive } = useEditorTabsStore.getState();
  if (tabs.length === 0) return;
  const index = tabs.findIndex((tab) => tab.id === activeId);
  const next = tabs[(index + dir + tabs.length) % tabs.length];
  if (next) setActive(next.id);
}

async function copyText(relative: boolean) {
  const tab = fileTab();
  if (!tab || isUntitled(tab.path)) {
    toast("No saved file to copy.");
    return;
  }
  const root = useExplorerStore.getState().root;
  const text =
    relative && root && tab.path.startsWith(root)
      ? tab.path.slice(root.length).replace(/^[/\\]/, "")
      : tab.path;
  await navigator.clipboard.writeText(text);
  toast("Copied to clipboard.");
}

export function installAutoSave() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return useEditorTabsStore.subscribe((state, prev) => {
    if (!state.autoSave) return;
    const tab = state.tabs.find((entry) => entry.id === state.activeId);
    if (!tab || tab.mode !== "file" || !tab.dirty || isUntitled(tab.path)) return;
    const previous = prev.tabs.find((entry) => entry.id === tab.id);
    if (previous && previous.content === tab.content) return;
    if (timer) clearTimeout(timer);
    const { id, path, content } = tab;
    timer = setTimeout(() => {
      void writeTextFile(path, content)
        .then(() => {
          const current = useEditorTabsStore.getState().tabs.find((entry) => entry.id === id);
          if (current && current.content === content) {
            useEditorTabsStore.getState().markSaved(id);
          }
        })
        .catch((err) => toast(String(err)));
    }, 500);
  });
}

export async function runCommand(id: string): Promise<void> {
  try {
    if (id.startsWith("recent:")) {
      const path = decodeURIComponent(id.slice("recent:".length));
      await useExplorerStore.getState().openWorkspace(path);
      return;
    }
    const monacoId = MONACO[id];
    if (monacoId) {
      if (!monacoTrigger(monacoId)) toast("Open a text file to use this command.");
      return;
    }
    switch (id) {
      case "file.newTextFile":
        useExplorerStore.getState().closeLauncher();
        useEditorTabsStore.getState().openUntitled();
        return;
      case "file.newWindow":
      case "file.newWindowProfile":
        await openAppWindow("empty");
        return;
      case "file.newAgentsWindow":
        await openAppWindow("agents");
        return;
      case "file.duplicateWorkspace":
        await openAppWindow("same");
        return;
      case "file.open": {
        const picked = await openDialog({ multiple: true, directory: false });
        const paths = picked == null ? [] : Array.isArray(picked) ? picked : [picked];
        for (const path of paths) await openEditorPath(path);
        return;
      }
      case "file.openFolder": {
        const picked = await openDialog({ directory: true, multiple: false });
        if (typeof picked === "string") await useExplorerStore.getState().openWorkspace(picked);
        return;
      }
      case "file.addFolder": {
        const picked = await openDialog({ directory: true, multiple: false });
        if (typeof picked === "string") await useExplorerStore.getState().addFolder(picked);
        return;
      }
      case "file.openWorkspace": {
        const picked = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: "Workspace", extensions: ["code-workspace", "json"] }],
        });
        if (typeof picked !== "string") return;
        const folders = parseWorkspaceFolders(await readTextFile(picked));
        if (folders.length === 0) {
          toast("That file has no workspace folders.");
          return;
        }
        await useExplorerStore.getState().openWorkspace(folders[0]!);
        for (const extra of folders.slice(1)) {
          await useExplorerStore.getState().addFolder(extra);
        }
        return;
      }
      case "file.saveWorkspace": {
        const root = useExplorerStore.getState().root;
        if (!root) return;
        const folders = [root, ...useExplorerStore.getState().extraRoots];
        const dest = await saveDialog({
          defaultPath: `${projectName(root)}.code-workspace`,
        });
        if (typeof dest !== "string" || !dest) return;
        await writeTextFile(dest, serializeWorkspace(folders));
        toast("Workspace saved.");
        return;
      }
      case "file.clearRecent":
        clearRecentProjects();
        return;
      case "file.save": {
        const tab = fileTab();
        if (tab) await saveOne(tab);
        return;
      }
      case "file.saveAs": {
        const tab = fileTab();
        if (tab) await saveAs(tab);
        return;
      }
      case "file.saveAll": {
        const dirty = useEditorTabsStore
          .getState()
          .tabs.filter((tab) => tab.mode === "file" && tab.dirty);
        for (const tab of dirty) {
          const current = fileTab(tab.id);
          if (!current) continue;
          const ok = await saveOne(current);
          if (!ok) return;
        }
        return;
      }
      case "file.autoSave":
        useEditorTabsStore.getState().toggleAutoSave();
        return;
      case "file.revert": {
        const tab = fileTab();
        if (!tab || isUntitled(tab.path)) return;
        const content = await readTextFile(tab.path);
        useEditorTabsStore.getState().revertContent(tab.id, content);
        return;
      }
      case "file.closeEditor": {
        const active = useEditorTabsStore.getState().activeId;
        if (active) useEditorTabsStore.getState().closeTab(active);
        return;
      }
      case "file.closeFolder":
        useExplorerStore.getState().closeWorkspace();
        return;
      case "file.closeWindow":
        if (inTauri()) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
          return;
        }
        window.close();
        return;
      case "file.copyPath":
        await copyText(false);
        return;
      case "file.copyRelativePath":
        await copyText(true);
        return;
      case "view.palette":
        openPicker("commands");
        return;
      case "go.file":
        openPicker("files");
        return;
      case "view.explorer":
        showView("explorer");
        return;
      case "view.search":
      case "view.replaceInFiles":
        showView("search");
        return;
      case "view.scm":
        showView("scm");
        return;
      case "view.run":
        showView("run");
        return;
      case "view.extensions":
        showView("extensions");
        return;
      case "view.history":
        showView("history");
        return;
      case "view.problems":
        useLayoutStore.getState().setBottomTab("problems");
        return;
      case "view.output":
        useLayoutStore.getState().setBottomTab("output");
        return;
      case "view.terminal":
      case "terminal.new":
      case "terminal.split": {
        const root = useExplorerStore.getState().root ?? ".";
        useLayoutStore.getState().setBottomTab("terminal");
        if (id !== "view.terminal") useTerminalStore.getState().addTerminal(root);
        return;
      }
      case "view.sidebar":
        useLayoutStore.getState().toggleSidebar();
        return;
      case "view.panel":
        useLayoutStore.getState().toggleBottom();
        return;
      case "view.minimap":
        useEditorTabsStore.getState().toggleMinimap();
        return;
      case "view.wordWrap":
        useEditorTabsStore.getState().toggleWordWrap();
        return;
      case "view.zen": {
        const layout = useLayoutStore.getState();
        const hide = layout.sidebarVisible || layout.bottomVisible;
        useLayoutStore.setState({
          sidebarVisible: !hide,
          bottomVisible: !hide,
        });
        return;
      }
      case "view.fullscreen": {
        if (!inTauri()) {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
          return;
        }
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.setFullscreen(!(await win.isFullscreen()));
        return;
      }
      case "view.zoomIn":
        await applyZoom(zoom + 0.1);
        return;
      case "view.zoomOut":
        await applyZoom(zoom - 0.1);
        return;
      case "view.zoomReset":
        await applyZoom(1);
        return;
      case "go.back":
        goHistory("back");
        return;
      case "go.forward":
        goHistory("forward");
        return;
      case "go.nextEditor":
        cycleEditor(1);
        return;
      case "go.prevEditor":
        cycleEditor(-1);
        return;
      case "run.start":
      case "run.noDebug":
      case "run.restart":
        await runNpm("dev");
        return;
      case "run.stop":
        runGeneration += 1;
        useLayoutStore.getState().setBottomTab("output");
        useTerminalStore
          .getState()
          .appendOutput("\nNo background debugger is attached. A running command finishes on its own.\n");
        return;
      case "terminal.runTask":
        showView("run");
        return;
      case "terminal.build":
        await runNpm("build");
        return;
      case "terminal.runFile": {
        const tab = fileTab();
        const root = useExplorerStore.getState().root;
        if (!tab || !root) return;
        if (isUntitled(tab.path)) {
          toast("Save the file before running it.");
          return;
        }
        if (tab.dirty) await saveOne(tab);
        const ext = tab.path.split(".").pop()?.toLowerCase();
        const quoted = shQuote(tab.path);
        const command =
          ext === "py"
            ? `python3 ${quoted}`
            : ext === "js" || ext === "mjs" || ext === "cjs"
              ? `node ${quoted}`
              : ext === "ts" || ext === "tsx"
                ? `npx tsx ${quoted}`
                : ext === "sh"
                  ? `bash ${quoted}`
                  : "";
        if (!command) {
          toast("This file type can't be run directly.");
          return;
        }
        useLayoutStore.getState().setBottomTab("output");
        useTerminalStore.getState().appendOutput(`\n$ ${command}\n`);
        const out = await runWorkspaceCommand(command, root);
        useTerminalStore.getState().appendOutput(`${out}\n`);
        return;
      }
      case "terminal.clear":
        useLayoutStore.getState().setBottomTab("terminal");
        useTerminalStore.getState().requestClear();
        return;
      case "window.minimize": {
        if (!inTauri()) {
          toast("Minimize works in the desktop window.");
          return;
        }
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
        return;
      }
      case "window.zoom": {
        if (!inTauri()) {
          toast("Zoom works in the desktop window.");
          return;
        }
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().toggleMaximize();
        return;
      }
      case "help.welcome":
        useExplorerStore.getState().openLauncher();
        return;
      case "help.settings":
        useSettingsStore.getState().openSettingsGate();
        return;
      case "help.about":
        openAbout();
        return;
      default:
        return;
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}
