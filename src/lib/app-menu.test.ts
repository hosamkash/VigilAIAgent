import { describe, expect, it } from "vitest";
import { buildAppMenus, FILE_MENU_LABELS, matchingCommand } from "./app-menu";
import { accelMatches } from "./menu-accel";
import { parseWorkspaceFolders, serializeWorkspace } from "./workspace-file";

const snap = {
  root: "/tmp/app",
  hasActiveFile: true,
  canRevert: false,
  canSaveAll: false,
  canCloseEditor: true,
  autoSave: true,
  wordWrap: false,
  minimap: true,
  sidebarVisible: true,
  panelVisible: false,
};

describe("app menu", () => {
  it("lists the same top menus as Cursor", () => {
    expect(buildAppMenus(snap).map((menu) => menu.label)).toEqual([
      "File",
      "Edit",
      "Selection",
      "View",
      "Go",
      "Run",
      "Terminal",
      "Window",
      "Help",
    ]);
  });

  it("keeps the File menu in Cursor's order", () => {
    const file = buildAppMenus(snap).find((menu) => menu.id === "file");
    const labels = file?.items.flatMap((item) =>
      item.kind === "item" ? [item.label] : [],
    );
    expect(labels).toEqual(FILE_MENU_LABELS);
  });

  it("matches save and save-all shortcuts separately", () => {
    const menus = buildAppMenus(snap);
    expect(
      matchingCommand(menus, { key: "s", meta: true, ctrl: false, shift: false, alt: false }, true),
    ).toBe("file.save");
    expect(
      matchingCommand(
        menus,
        { key: "s", meta: true, ctrl: false, shift: false, alt: true },
        true,
      ),
    ).toBe("file.saveAll");
  });
});

describe("accelerators", () => {
  it("treats command and control as the modifier on each platform", () => {
    const accel = { mod: true, key: "n", label: "N" };
    expect(
      accelMatches({ key: "n", meta: true, ctrl: false, shift: false, alt: false }, accel, true),
    ).toBe(true);
    expect(
      accelMatches({ key: "n", meta: false, ctrl: true, shift: false, alt: false }, accel, false),
    ).toBe(true);
    expect(
      accelMatches({ key: "n", meta: true, ctrl: false, shift: true, alt: false }, accel, true),
    ).toBe(false);
  });
});

describe("workspace file", () => {
  it("reads and writes folder paths", () => {
    const text = serializeWorkspace(["/a", "/b"]);
    expect(parseWorkspaceFolders(text)).toEqual(["/a", "/b"]);
    expect(parseWorkspaceFolders("{")).toEqual([]);
    expect(parseWorkspaceFolders('{"folders":[{"path":"  "}]}')).toEqual([]);
  });
});
