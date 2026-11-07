import { describe, expect, it } from "vitest";
import {
  formatComposerChipLabels,
  formatComposerContext,
  type ComposerContextChip,
} from "../store/composerContextStore";
import {
  packExplorerDragItems,
  readExplorerDragItems,
  relativeWorkspaceLabel,
  setExplorerDragData,
  unpackExplorerDragItems,
  VIGIL_EXPLORER_PREFIX,
} from "./explorer-dnd";

const terminalChip: ComposerContextChip = {
  id: "1",
  kind: "terminal",
  title: "Terminal",
  detail: "L12–18",
  text: "Error: listen EADDRINUSE :::4300",
};

const fileChip: ComposerContextChip = {
  id: "2",
  kind: "file",
  title: "App.tsx",
  detail: "src/App.tsx",
  text: "/Users/me/proj/src/App.tsx",
  path: "/Users/me/proj/src/App.tsx",
};

const folderChip: ComposerContextChip = {
  id: "3",
  kind: "folder",
  title: "components",
  detail: "src/components",
  text: "/Users/me/proj/src/components",
  path: "/Users/me/proj/src/components",
};

describe("composer context formatting", () => {
  it("keeps a compact label for the composer", () => {
    expect(formatComposerChipLabels([terminalChip])).toBe("@Terminal (L12–18)");
    expect(formatComposerChipLabels([fileChip, folderChip])).toBe(
      "@src/App.tsx @src/components",
    );
  });

  it("expands the full terminal block for the agent", () => {
    const out = formatComposerContext([terminalChip]);
    expect(out).toContain("[Terminal reference: Terminal L12–18]");
    expect(out).toContain("EADDRINUSE");
    expect(out).toContain("[/Terminal reference]");
  });

  it("expands file and folder path references for the agent", () => {
    const out = formatComposerContext([fileChip, folderChip]);
    expect(out).toContain("[File reference: src/App.tsx]");
    expect(out).toContain("path: /Users/me/proj/src/App.tsx");
    expect(out).toContain("[Folder reference: src/components]");
    expect(out).toContain("path: /Users/me/proj/src/components");
  });
});

describe("explorer drag payload", () => {
  it("round-trips explorer items", () => {
    const packed = packExplorerDragItems([
      { path: "/proj/src/App.tsx", name: "App.tsx", isDir: false },
      { path: "/proj/src", name: "src", isDir: true },
    ]);
    expect(unpackExplorerDragItems(packed)).toEqual([
      { path: "/proj/src/App.tsx", name: "App.tsx", isDir: false },
      { path: "/proj/src", name: "src", isDir: true },
    ]);
  });

  it("builds workspace-relative labels", () => {
    expect(
      relativeWorkspaceLabel("/proj/src/App.tsx", "/proj"),
    ).toBe("src/App.tsx");
    expect(relativeWorkspaceLabel("/proj", "/proj")).toBe(".");
  });

  it("round-trips through text/plain prefix (WKWebView-safe)", () => {
    const store = new Map<string, string>();
    const dt = {
      setData: (type: string, value: string) => {
        store.set(type, value);
      },
      getData: (type: string) => store.get(type) ?? "",
      types: [] as string[],
      effectAllowed: "none",
    } as unknown as DataTransfer;
    setExplorerDragData(dt, [
      { path: "/proj/a.tsx", name: "a.tsx", isDir: false },
    ]);
    expect(store.get("text/plain")?.startsWith(VIGIL_EXPLORER_PREFIX)).toBe(true);
    expect(readExplorerDragItems(dt)).toEqual([
      { path: "/proj/a.tsx", name: "a.tsx", isDir: false },
    ]);
  });
});
