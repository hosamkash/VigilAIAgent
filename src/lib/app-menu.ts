import { accelMatches, formatAccel, isMacPlatform, type Accel, type PressedKey } from "./menu-accel";
import { readRecentProjects } from "./recent-projects";

export interface MenuItem {
  kind: "item";
  id?: string;
  label: string;
  shortcut?: string;
  accel?: Accel;
  checked?: boolean;
  enabled?: boolean;
  submenu?: MenuNode[];
}

export interface MenuSep {
  kind: "sep";
}

export type MenuNode = MenuItem | MenuSep;

export interface TopMenu {
  id: string;
  label: string;
  items: MenuNode[];
}

export interface MenuSnapshot {
  root: string | null;
  hasActiveFile: boolean;
  canRevert: boolean;
  canSaveAll: boolean;
  canCloseEditor: boolean;
  autoSave: boolean;
  wordWrap: boolean;
  minimap: boolean;
  sidebarVisible: boolean;
  panelVisible: boolean;
}

export interface CommandRef {
  id: string;
  label: string;
  shortcut?: string;
  accel?: Accel;
  enabled: boolean;
}

const sep = (): MenuSep => ({ kind: "sep" });

function item(
  id: string,
  label: string,
  accel?: Accel,
  extra?: Partial<MenuItem>,
): MenuItem {
  return {
    kind: "item",
    id,
    label,
    accel,
    shortcut: accel ? formatAccel(accel) : extra?.shortcut,
    ...extra,
  };
}

function sub(label: string, submenu: MenuNode[], extra?: Partial<MenuItem>): MenuItem {
  return { kind: "item", label, submenu, ...extra };
}

function macAccel(mac: Accel, other: Accel): Accel {
  return isMacPlatform() ? mac : other;
}

export function buildAppMenus(snap: MenuSnapshot): TopMenu[] {
  const recent = readRecentProjects();
  const hasRoot = !!snap.root;
  const fileOk = snap.hasActiveFile;

  const recentItems: MenuNode[] =
    recent.length === 0
      ? [item("file.recent.empty", "No Recent Folders", undefined, { enabled: false })]
      : recent.map((entry) =>
          item(`recent:${encodeURIComponent(entry.path)}`, entry.name),
        );

  return [
    {
      id: "file",
      label: "File",
      items: [
        item("file.newTextFile", "New Text File", { mod: true, key: "n", label: "N" }),
        item("file.newWindow", "New Window", { mod: true, shift: true, key: "n", label: "N" }),
        item("file.newAgentsWindow", "New Agents Window", {
          mod: true,
          alt: true,
          key: "n",
          label: "N",
        }),
        sub("New Window with Profile", [
          item("file.newWindowProfile", "Default"),
        ]),
        sep(),
        item("file.open", "Open...", { mod: true, key: "o", label: "O" }),
        item("file.openFolder", "Open Folder..."),
        item("file.openWorkspace", "Open Workspace from File..."),
        sub("Open Recent", [
          ...recentItems,
          sep(),
          item("file.clearRecent", "Clear Recently Opened", undefined, {
            enabled: recent.length > 0,
          }),
        ]),
        sep(),
        item("file.addFolder", "Add Folder to Workspace..."),
        item("file.saveWorkspace", "Save Workspace As...", undefined, { enabled: hasRoot }),
        item("file.duplicateWorkspace", "Duplicate Workspace", undefined, {
          enabled: hasRoot,
        }),
        sep(),
        item("file.save", "Save", { mod: true, key: "s", label: "S" }, { enabled: fileOk }),
        item(
          "file.saveAs",
          "Save As...",
          { mod: true, shift: true, key: "s", label: "S" },
          { enabled: fileOk },
        ),
        item(
          "file.saveAll",
          "Save All",
          { mod: true, alt: true, key: "s", label: "S" },
          { enabled: snap.canSaveAll },
        ),
        sep(),
        sub(
          "Share",
          [
            item("file.copyPath", "Copy Path", undefined, { enabled: fileOk }),
            item("file.copyRelativePath", "Copy Relative Path", undefined, {
              enabled: fileOk && hasRoot,
            }),
          ],
          { enabled: fileOk },
        ),
        sep(),
        item("file.autoSave", "Auto Save", undefined, { checked: snap.autoSave }),
        sep(),
        item("file.revert", "Revert File", undefined, { enabled: snap.canRevert }),
        sep(),
        item(
          "file.closeEditor",
          "Close Editor",
          { mod: true, key: "w", label: "W" },
          { enabled: snap.canCloseEditor },
        ),
        item("file.closeFolder", "Close Folder", undefined, { enabled: hasRoot }),
        item("file.closeWindow", "Close Window", {
          mod: true,
          shift: true,
          key: "w",
          label: "W",
        }),
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        item("edit.undo", "Undo", { mod: true, key: "z", label: "Z" }),
        item("edit.redo", "Redo", { mod: true, shift: true, key: "z", label: "Z" }),
        sep(),
        item("edit.cut", "Cut", { mod: true, key: "x", label: "X" }),
        item("edit.copy", "Copy", { mod: true, key: "c", label: "C" }),
        item("edit.paste", "Paste", { mod: true, key: "v", label: "V" }),
        sep(),
        item("edit.find", "Find", { mod: true, key: "f", label: "F" }),
        item("edit.replace", "Replace", { mod: true, alt: true, key: "f", label: "F" }),
        sep(),
        item("view.search", "Find in Files", { mod: true, shift: true, key: "f", label: "F" }),
        item("view.replaceInFiles", "Replace in Files", {
          mod: true,
          shift: true,
          key: "h",
          label: "H",
        }),
        sep(),
        item("edit.comment", "Toggle Line Comment", { mod: true, key: "/", label: "/" }),
        item("edit.blockComment", "Toggle Block Comment", {
          shift: true,
          alt: true,
          key: "a",
          label: "A",
        }),
      ],
    },
    {
      id: "selection",
      label: "Selection",
      items: [
        item("selection.all", "Select All", { mod: true, key: "a", label: "A" }),
        sep(),
        item("selection.expand", "Expand Selection", {
          mod: true,
          ctrl: true,
          shift: true,
          key: "arrowright",
          label: "→",
        }),
        item("selection.shrink", "Shrink Selection", {
          mod: true,
          ctrl: true,
          shift: true,
          key: "arrowleft",
          label: "←",
        }),
        sep(),
        item("selection.copyUp", "Copy Line Up", {
          shift: true,
          alt: true,
          key: "arrowup",
          label: "↑",
        }),
        item("selection.copyDown", "Copy Line Down", {
          shift: true,
          alt: true,
          key: "arrowdown",
          label: "↓",
        }),
        item("selection.moveUp", "Move Line Up", { alt: true, key: "arrowup", label: "↑" }),
        item("selection.moveDown", "Move Line Down", {
          alt: true,
          key: "arrowdown",
          label: "↓",
        }),
        sep(),
        item("selection.cursorAbove", "Add Cursor Above", {
          mod: true,
          alt: true,
          key: "arrowup",
          label: "↑",
        }),
        item("selection.cursorBelow", "Add Cursor Below", {
          mod: true,
          alt: true,
          key: "arrowdown",
          label: "↓",
        }),
        item("selection.lineEnds", "Add Cursors to Line Ends", {
          shift: true,
          alt: true,
          key: "i",
          label: "I",
        }),
        item("selection.next", "Add Selection to Next Find Match", {
          mod: true,
          key: "d",
          label: "D",
        }),
        item("selection.allMatches", "Select All Occurrences of Find Match", {
          mod: true,
          shift: true,
          key: "l",
          label: "L",
        }),
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        item("view.palette", "Command Palette...", {
          mod: true,
          shift: true,
          key: "p",
          label: "P",
        }),
        sub("Open View", [
          item("view.explorer", "Explorer"),
          item("view.search", "Search"),
          item("view.scm", "Source Control"),
          item("view.run", "Run and Debug"),
          item("view.extensions", "Extensions"),
          item("view.history", "Vigil History"),
          sep(),
          item("view.problems", "Problems"),
          item("view.output", "Output"),
          item("view.terminal", "Terminal"),
        ]),
        sep(),
        sub("Appearance", [
          item(
            "view.fullscreen",
            "Full Screen",
            macAccel(
              { mod: true, ctrl: true, key: "f", label: "F" },
              { key: "f11", label: "F11" },
            ),
          ),
          item("view.zen", "Zen Mode"),
          item("view.sidebar", "Toggle Primary Side Bar", { mod: true, key: "b", label: "B" }, {
            checked: snap.sidebarVisible,
          }),
          item("view.panel", "Toggle Panel", { mod: true, key: "j", label: "J" }, {
            checked: snap.panelVisible,
          }),
          item("view.minimap", "Toggle Minimap", undefined, { checked: snap.minimap }),
          sep(),
          item("view.zoomIn", "Zoom In", { mod: true, key: "=", label: "+" }),
          item("view.zoomOut", "Zoom Out", { mod: true, key: "-", label: "−" }),
          item("view.zoomReset", "Reset Zoom", { mod: true, key: "0", label: "0" }),
        ]),
        sep(),
        item("view.explorer", "Explorer", { mod: true, shift: true, key: "e", label: "E" }),
        item("view.search", "Search"),
        item("view.scm", "Source Control", {
          ctrl: true,
          shift: true,
          key: "g",
          label: "G",
        }),
        item("view.run", "Run", { mod: true, shift: true, key: "d", label: "D" }),
        item("view.extensions", "Extensions", { mod: true, shift: true, key: "x", label: "X" }),
        item("view.history", "Vigil History"),
        sep(),
        item("view.problems", "Problems", { mod: true, shift: true, key: "m", label: "M" }),
        item("view.output", "Output", { mod: true, shift: true, key: "u", label: "U" }),
        item("view.terminal", "Terminal", { ctrl: true, key: "`", label: "`" }),
        sep(),
        item("view.wordWrap", "Word Wrap", { alt: true, key: "z", label: "Z" }, {
          checked: snap.wordWrap,
        }),
      ],
    },
    {
      id: "go",
      label: "Go",
      items: [
        item(
          "go.back",
          "Back",
          macAccel(
            { ctrl: true, key: "-", label: "−" },
            { alt: true, key: "arrowleft", label: "←" },
          ),
        ),
        item(
          "go.forward",
          "Forward",
          macAccel(
            { ctrl: true, shift: true, key: "-", label: "−" },
            { alt: true, key: "arrowright", label: "→" },
          ),
        ),
        sep(),
        item("go.file", "Go to File...", { mod: true, key: "p", label: "P" }),
        item("go.symbol", "Go to Symbol in Editor...", {
          mod: true,
          shift: true,
          key: "o",
          label: "O",
        }),
        item("go.line", "Go to Line/Column...", { ctrl: true, key: "g", label: "G" }),
        sep(),
        item("go.def", "Go to Definition", { key: "f12", label: "F12" }),
        item("go.refs", "Go to References", { shift: true, key: "f12", label: "F12" }),
        item("go.peek", "Peek Definition", { alt: true, key: "f12", label: "F12" }),
        sep(),
        item("go.nextEditor", "Next Editor", {
          mod: true,
          alt: true,
          key: "arrowright",
          label: "→",
        }),
        item("go.prevEditor", "Previous Editor", {
          mod: true,
          alt: true,
          key: "arrowleft",
          label: "←",
        }),
      ],
    },
    {
      id: "run",
      label: "Run",
      items: [
        item("run.start", "Start Debugging", { key: "f5", label: "F5" }, { enabled: hasRoot }),
        item(
          "run.noDebug",
          "Run Without Debugging",
          { ctrl: true, key: "f5", label: "F5" },
          { enabled: hasRoot },
        ),
        item("run.stop", "Stop Debugging", { shift: true, key: "f5", label: "F5" }),
        item(
          "run.restart",
          "Restart Debugging",
          { mod: true, shift: true, key: "f5", label: "F5" },
          { enabled: hasRoot },
        ),
        sep(),
        item("view.run", "Open Run and Debug"),
      ],
    },
    {
      id: "terminal",
      label: "Terminal",
      items: [
        item("terminal.new", "New Terminal", {
          ctrl: true,
          shift: true,
          key: "`",
          label: "`",
        }),
        item("terminal.split", "Split Terminal"),
        sep(),
        item("terminal.runTask", "Run Task..."),
        item("terminal.build", "Run Build Task", undefined, { enabled: hasRoot }),
        item("terminal.runFile", "Run Active File", undefined, { enabled: fileOk }),
        sep(),
        item("terminal.clear", "Clear Terminal"),
      ],
    },
    {
      id: "window",
      label: "Window",
      items: [
        item("window.minimize", "Minimize", { mod: true, key: "m", label: "M" }),
        item("window.zoom", "Zoom"),
        item("file.newWindow", "New Window"),
        item("file.closeWindow", "Close Window"),
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        item("help.welcome", "Welcome"),
        item("view.palette", "Show All Commands"),
        item("help.settings", "Settings", { mod: true, key: ",", label: "," }),
        sep(),
        item("help.about", "About"),
      ],
    },
  ];
}

export function matchingCommand(
  menus: TopMenu[],
  pressed: PressedKey,
  mac: boolean,
): string | null {
  let found: string | null = null;
  const walk = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (found || node.kind === "sep") continue;
      if (node.submenu) walk(node.submenu);
      if (
        !found &&
        node.id &&
        node.accel &&
        accelMatches(pressed, node.accel, mac)
      ) {
        found = node.id;
      }
    }
  };
  for (const menu of menus) {
    if (found) break;
    walk(menu.items);
  }
  return found;
}

export function listCommands(menus: TopMenu[]): CommandRef[] {
  const out: CommandRef[] = [];
  const seen = new Set<string>();
  const walk = (nodes: MenuNode[], group: string) => {
    for (const node of nodes) {
      if (node.kind === "sep") continue;
      if (node.submenu) {
        walk(node.submenu, node.label);
        continue;
      }
      if (!node.id || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({
        id: node.id,
        label: `${group}: ${node.label}`,
        shortcut: node.shortcut,
        accel: node.accel,
        enabled: node.enabled !== false,
      });
    }
  };
  for (const menu of menus) walk(menu.items, menu.label);
  return out;
}

export const FILE_MENU_LABELS = [
  "New Text File",
  "New Window",
  "New Agents Window",
  "New Window with Profile",
  "Open...",
  "Open Folder...",
  "Open Workspace from File...",
  "Open Recent",
  "Add Folder to Workspace...",
  "Save Workspace As...",
  "Duplicate Workspace",
  "Save",
  "Save As...",
  "Save All",
  "Share",
  "Auto Save",
  "Revert File",
  "Close Editor",
  "Close Folder",
  "Close Window",
];
