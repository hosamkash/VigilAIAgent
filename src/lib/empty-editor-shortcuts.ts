/**
 * Empty editor shortcut rows — edit this list to change labels / keys / commands.
 * Keys use the same Accel model as the app menu (⌘/Ctrl via `mod`).
 */
import type { Accel } from "./menu-accel";

export type EmptyEditorShortcut = {
  /** Stable id for React keys */
  id: string;
  /** Shown label (English; keep short like Cursor) */
  label: string;
  /** ide-commands / menu command id */
  commandId: string;
  accel: Accel;
};

export const EMPTY_EDITOR_SHORTCUTS: EmptyEditorShortcut[] = [
  {
    id: "new-chat",
    label: "New Chat",
    commandId: "chat.new",
    accel: { mod: true, shift: true, key: "l", label: "L" },
  },
  {
    id: "toggle-panel",
    label: "Toggle Terminal",
    commandId: "view.panel",
    accel: { mod: true, key: "j", label: "J" },
  },
  {
    id: "go-file",
    label: "Search Files",
    commandId: "go.file",
    accel: { mod: true, key: "p", label: "P" },
  },
  {
    id: "toggle-chat",
    label: "Toggle Chat",
    commandId: "view.chat",
    accel: { mod: true, alt: true, key: "b", label: "B" },
  },
  {
    id: "add-repo",
    label: "Add Repository",
    commandId: "scm.addRepo",
    accel: { mod: true, alt: true, key: "a", label: "A" },
  },
];
