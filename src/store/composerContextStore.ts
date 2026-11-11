import { create } from "zustand";
import {
  relativeWorkspaceLabel,
  type VigilExplorerDragItem,
} from "../lib/explorer-dnd";

const MAX_CHIP_CHARS = 12_000;

export type ComposerContextChip = {
  id: string;
  kind: "terminal" | "file" | "folder" | "symbol" | "virtual" | "selection";
  title: string;
  detail: string;
  text: string;
  /** Absolute path for file/folder/symbol/selection chips. */
  path?: string;
  /** 1-based line for symbol chips (or selection start). */
  line?: number;
  /** 1-based end line for selection chips. */
  endLine?: number;
  /** Virtual mention id: problems | codebase | open */
  virtualId?: "problems" | "codebase" | "open";
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

type SymbolInput = {
  path: string;
  name: string;
  line: number;
  kind?: string;
  workspaceRoot?: string | null;
};

type CodeSelectionInput = {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
  workspaceRoot?: string | null;
};

interface ComposerContextState {
  chips: ComposerContextChip[];
  addTerminalSelection: (input: TerminalSelectionInput) => string | null;
  addWorkspacePath: (input: WorkspacePathInput) => string | null;
  addSymbol: (input: SymbolInput) => string | null;
  addCodeSelection: (input: CodeSelectionInput) => string | null;
  addVirtual: (virtualId: "problems" | "codebase" | "open") => string | null;
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
      if (chip.kind === "symbol") {
        return (
          `[Symbol reference: ${chip.title}]\n` +
          `kind: ${chip.detail}\n` +
          `path: ${chip.path ?? ""}\n` +
          `line: ${chip.line ?? 1}\n` +
          `[/Symbol reference]`
        );
      }
      if (chip.kind === "selection") {
        const start = chip.line ?? 1;
        const end = chip.endLine ?? start;
        const range = start === end ? `L${start}` : `L${start}–${end}`;
        return (
          `[Code selection: ${chip.detail} ${range}]\n` +
          `path: ${chip.path ?? ""}\n` +
          "```\n" +
          `${chip.text}\n` +
          "```\n" +
          `[/Code selection]`
        );
      }
      if (chip.kind === "virtual") {
        return `[Virtual reference: @${chip.title}]`;
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
      if (chip.kind === "symbol" || chip.kind === "virtual") {
        return `@${chip.title}`;
      }
      if (chip.kind === "selection") {
        return `@${chip.detail} (${chip.title})`;
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
  addSymbol: (input) => {
    const abs = input.path.trim();
    const name = input.name.trim();
    if (!abs || !name) return null;
    const detail = relativeWorkspaceLabel(abs, input.workspaceRoot);
    const existing = get().chips.find(
      (chip) =>
        chip.kind === "symbol" &&
        chip.path === abs &&
        chip.title === name &&
        chip.line === input.line,
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    set((state) => ({
      chips: [
        ...state.chips,
        {
          id,
          kind: "symbol",
          title: name,
          detail: `${input.kind || "symbol"} · ${detail}:${input.line}`,
          text: abs,
          path: abs,
          line: input.line,
        },
      ],
    }));
    return id;
  },
  addCodeSelection: (input) => {
    const abs = input.path.trim();
    const text = clipText(input.text);
    if (!abs || !text.trim()) return null;
    const start = Math.max(1, Math.min(input.startLine, input.endLine));
    const end = Math.max(input.startLine, input.endLine);
    const range = start === end ? `L${start}` : `L${start}–${end}`;
    const detail = relativeWorkspaceLabel(abs, input.workspaceRoot);
    const existing = get().chips.find(
      (chip) =>
        chip.kind === "selection" &&
        chip.path === abs &&
        chip.line === start &&
        chip.endLine === end &&
        chip.text === text,
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    set((state) => ({
      chips: [
        ...state.chips,
        {
          id,
          kind: "selection",
          title: range,
          detail,
          text,
          path: abs,
          line: start,
          endLine: end,
        },
      ],
    }));
    return id;
  },
  addVirtual: (virtualId) => {
    const meta = {
      problems: {
        title: "problems",
        detail: "Current editor diagnostics",
      },
      codebase: {
        title: "codebase",
        detail: "Workspace file/symbol index",
      },
      open: {
        title: "open",
        detail: "Open editor tabs",
      },
    }[virtualId];
    const existing = get().chips.find(
      (chip) => chip.kind === "virtual" && chip.virtualId === virtualId,
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    set((state) => ({
      chips: [
        ...state.chips,
        {
          id,
          kind: "virtual",
          title: meta.title,
          detail: meta.detail,
          text: virtualId,
          virtualId,
        },
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
