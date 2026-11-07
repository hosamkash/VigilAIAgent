import { create } from "zustand";
import {
  relativeWorkspaceLabel,
  type VigilExplorerDragItem,
} from "../lib/explorer-dnd";

const MAX_CHIP_CHARS = 12_000;

export type ComposerContextChip = {
  id: string;
  kind: "terminal" | "file" | "folder";
  title: string;
  detail: string;
  text: string;
  /** Absolute path for file/folder chips. */
  path?: string;
};

type TerminalSelectionInput = {
  text: string;
  startLine: number;
  endLine: number;
  terminalTitle?: string;
};

type WorkspacePathInput = {
  path: string;
  name?: string;
  isDir: boolean;
  workspaceRoot?: string | null;
};

interface ComposerContextState {
  chips: ComposerContextChip[];
  addTerminalSelection: (input: TerminalSelectionInput) => string | null;
  addWorkspacePath: (input: WorkspacePathInput) => string | null;
  addExplorerItems: (
    items: VigilExplorerDragItem[],
    workspaceRoot?: string | null,
  ) => number;
  removeChip: (id: string) => void;
  clearChips: () => void;
  takeChips: () => ComposerContextChip[];
}

function clipText(text: string): string {
  const clean = text.replace(/\r\n/g, "\n");
  if (clean.length <= MAX_CHIP_CHARS) return clean;
  return clean.slice(clean.length - MAX_CHIP_CHARS);
}

export function formatComposerContext(chips: ComposerContextChip[]): string {
  if (chips.length === 0) return "";
  return chips
    .map((chip) => {
      if (chip.kind === "terminal") {
        return (
          `[Terminal reference: ${chip.title} ${chip.detail}]\n` +
          `${chip.text}\n` +
          `[/Terminal reference]`
        );
      }
      if (chip.kind === "file") {
        return (
          `[File reference: ${chip.detail}]\n` +
          `path: ${chip.path ?? chip.text}\n` +
          `[/File reference]`
        );
      }
      if (chip.kind === "folder") {
        return (
          `[Folder reference: ${chip.detail}]\n` +
          `path: ${chip.path ?? chip.text}\n` +
          `[/Folder reference]`
        );
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function formatComposerChipLabels(chips: ComposerContextChip[]): string {
  return chips
    .map((chip) => {
      if (chip.kind === "file" || chip.kind === "folder") {
        return `@${chip.detail}`;
      }
      return `@${chip.title} (${chip.detail})`;
    })
    .join(" ");
}

export const useComposerContextStore = create<ComposerContextState>((set, get) => ({
  chips: [],
  addTerminalSelection: (input) => {
    const text = clipText(input.text);
    if (!text.trim()) return null;
    const start = Math.max(1, Math.min(input.startLine, input.endLine));
    const end = Math.max(input.startLine, input.endLine);
    const detail = start === end ? `L${start}` : `L${start}–${end}`;
    const title = (input.terminalTitle || "Terminal").trim() || "Terminal";
    const id = crypto.randomUUID();
    set((state) => ({
      chips: [
        ...state.chips.filter(
          (chip) =>
            !(
              chip.kind === "terminal" &&
              chip.detail === detail &&
              chip.text === text
            ),
        ),
        { id, kind: "terminal", title, detail, text },
      ],
    }));
    return id;
  },
  addWorkspacePath: (input) => {
    const abs = input.path.trim();
    if (!abs) return null;
    const kind = input.isDir ? "folder" : "file";
    const detail = relativeWorkspaceLabel(abs, input.workspaceRoot);
    const title =
      (input.name || "").trim() ||
      detail.split("/").pop() ||
      (input.isDir ? "Folder" : "File");
    const existing = get().chips.find(
      (chip) =>
        (chip.kind === "file" || chip.kind === "folder") && chip.path === abs,
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    set((state) => ({
      chips: [
        ...state.chips,
        { id, kind, title, detail, text: abs, path: abs },
      ],
    }));
    return id;
  },
  addExplorerItems: (items, workspaceRoot) => {
    let added = 0;
    for (const item of items) {
      const id = get().addWorkspacePath({
        path: item.path,
        name: item.name,
        isDir: item.isDir,
        workspaceRoot,
      });
      if (id) added += 1;
    }
    return added;
  },
  removeChip: (id) =>
    set((state) => ({ chips: state.chips.filter((chip) => chip.id !== id) })),
  clearChips: () => set({ chips: [] }),
  takeChips: () => {
    const chips = get().chips;
    set({ chips: [] });
    return chips;
  },
}));
