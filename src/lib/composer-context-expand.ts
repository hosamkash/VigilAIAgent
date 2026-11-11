/** Expand composer chips with file/folder contents for the agent prompt. */

import type { ComposerContextChip } from "../store/composerContextStore";
import { formatComposerContext } from "../store/composerContextStore";
import { listDir, readTextFile } from "./workspace-fs";
import {
  formatCodebaseContext,
  formatOpenTabsContext,
  formatProblemsContext,
} from "./virtual-context";
import { useTerminalStore } from "../store/terminalStore";
import { useWorkspaceIndexStore } from "../store/workspaceIndexStore";
import { useEditorTabsStore } from "../store/editorTabsStore";

const FILE_BODY_CHARS = 8_000;
const FOLDER_LIST_LIMIT = 40;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}

/**
 * Build the agent context block, reading file bodies and folder listings.
 * Falls back to path-only references when IO fails.
 */
export async function expandComposerContext(
  chips: ComposerContextChip[],
): Promise<string> {
  if (chips.length === 0) return "";

  const parts: string[] = [];
  for (const chip of chips) {
    if (chip.kind === "virtual") {
      if (chip.virtualId === "problems") {
        parts.push(formatProblemsContext(useTerminalStore.getState().problems));
      } else if (chip.virtualId === "codebase") {
        const index = useWorkspaceIndexStore.getState();
        parts.push(
          formatCodebaseContext(
            index.files,
            index.symbols.length,
            index.semantic,
          ),
        );
      } else if (chip.virtualId === "open") {
        const tabs = useEditorTabsStore.getState().tabs.map((t) => ({
          path: t.path,
          content: t.content,
          mode: t.mode,
        }));
        parts.push(await formatOpenTabsContext(tabs));
      }
      continue;
    }
    if (
      chip.kind === "terminal" ||
      chip.kind === "symbol" ||
      chip.kind === "selection"
    ) {
      parts.push(formatComposerContext([chip]));
      continue;
    }
    if (chip.kind === "file" && chip.path) {
      try {
        const body = clip(await readTextFile(chip.path), FILE_BODY_CHARS);
        parts.push(
          `[File reference: ${chip.detail}]\n` +
            `path: ${chip.path}\n` +
            "```\n" +
            `${body}\n` +
            "```\n" +
            `[/File reference]`,
        );
      } catch {
        parts.push(formatComposerContext([chip]));
      }
      continue;
    }
    if (chip.kind === "folder" && chip.path) {
      try {
        const entries = await listDir(chip.path);
        const listing = entries
          .slice(0, FOLDER_LIST_LIMIT)
          .map((e) => `${e.isDir ? "dir" : "file"} ${e.name}`)
          .join("\n");
        const more =
          entries.length > FOLDER_LIST_LIMIT
            ? `\n…(+${entries.length - FOLDER_LIST_LIMIT} more)`
            : "";
        parts.push(
          `[Folder reference: ${chip.detail}]\n` +
            `path: ${chip.path}\n` +
            `${listing || "(empty)"}${more}\n` +
            `[/Folder reference]`,
        );
      } catch {
        parts.push(formatComposerContext([chip]));
      }
      continue;
    }
    parts.push(formatComposerContext([chip]));
  }
  return parts.filter(Boolean).join("\n\n");
}
