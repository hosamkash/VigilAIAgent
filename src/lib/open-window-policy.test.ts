import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceKey,
  shouldReuseVigilWindow,
} from "./open-window-policy";

describe("shouldReuseVigilWindow", () => {
  it("reuses an empty window for the first folder", () => {
    expect(shouldReuseVigilWindow(null, "/tmp/a")).toBe(true);
    expect(shouldReuseVigilWindow("", "/tmp/a")).toBe(true);
  });

  it("reuses when the folder is already open", () => {
    expect(shouldReuseVigilWindow("/tmp/proj/", "/tmp/proj")).toBe(true);
    expect(normalizeWorkspaceKey("C:\\Work\\App")).toBe("c:/work/app");
  });

  it("opens a new window for a different folder", () => {
    expect(shouldReuseVigilWindow("/tmp/a", "/tmp/b")).toBe(false);
  });
});
