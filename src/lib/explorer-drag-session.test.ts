import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerDragStore } from "./explorer-drag-session";

describe("explorer pointer drag session", () => {
  beforeEach(() => {
    useExplorerDragStore.getState().cancel();
  });

  it("does not commit until moved and released over the composer", () => {
    const store = useExplorerDragStore.getState();
    store.beginPointer(
      [{ path: "/proj/a.tsx", name: "a.tsx", isDir: false }],
      10,
      10,
    );
    expect(useExplorerDragStore.getState().dragging).toBe(false);

    store.movePointer(12, 12, false);
    expect(useExplorerDragStore.getState().dragging).toBe(false);

    store.movePointer(40, 40, true);
    expect(useExplorerDragStore.getState().dragging).toBe(true);
    expect(useExplorerDragStore.getState().overComposer).toBe(true);

    const items = useExplorerDragStore.getState().endPointer();
    expect(items).toEqual([{ path: "/proj/a.tsx", name: "a.tsx", isDir: false }]);
    expect(useExplorerDragStore.getState().active).toBe(false);
  });

  it("returns nothing when released outside the composer", () => {
    const store = useExplorerDragStore.getState();
    store.beginPointer(
      [{ path: "/proj/a.tsx", name: "a.tsx", isDir: false }],
      0,
      0,
    );
    store.movePointer(40, 40, false);
    expect(store.endPointer()).toEqual([]);
  });
});
