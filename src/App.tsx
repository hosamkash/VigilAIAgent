import { useCallback, useEffect, useRef } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import "allotment/dist/style.css";
import { ActivityBar } from "./components/layout/ActivityBar";
import { SidebarPanel } from "./components/layout/SidebarPanel";
import { EditorGroup } from "./components/layout/EditorGroup";
import { BottomPanel } from "./components/layout/BottomPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SettingsUnlockScreen } from "./components/SettingsUnlockScreen";
import { useSettingsStore } from "./store/settingsStore";
import { useLayoutStore } from "./store/layoutStore";
import { useCostStore } from "./store/costStore";
import {
  DEFAULT_LAYOUT,
  sizesToPercents,
} from "./lib/layout-persist";
import { destroyExtHostWebview } from "./lib/embedded-site";
import { MenuBar } from "./components/layout/MenuBar";

function IdeShell() {
  const {
    sidebarVisible,
    bottomVisible,
    layoutSizes,
    setHorizontalSizes,
    setVerticalSizes,
    resetLayout,
  } = useLayoutStore();
  const horizontalRef = useRef<AllotmentHandle | null>(null);
  const verticalRef = useRef<AllotmentHandle | null>(null);

  useEffect(() => {
    void destroyExtHostWebview();
  }, []);

  const onHorizontalChange = useCallback(
    (sizes: number[]) => {
      if (sizes.length < 2) return;
      const percents = sizesToPercents(sizes);
      if (sidebarVisible && percents.length >= 3) {
        setHorizontalSizes([
          percents[0]!,
          percents[1]!,
          percents[2]!,
        ]);
      } else if (!sidebarVisible && percents.length >= 2) {
        // editor + chat only — keep explorer % from store
        setHorizontalSizes([
          layoutSizes.horizontal[0],
          percents[0]!,
          percents[1]!,
        ]);
      }
    },
    [sidebarVisible, setHorizontalSizes, layoutSizes.horizontal],
  );

  const onVerticalChange = useCallback(
    (sizes: number[]) => {
      if (sizes.length < 2) return;
      const percents = sizesToPercents(sizes);
      setVerticalSizes([percents[0]!, percents[1]!], sizes[1]);
    },
    [setVerticalSizes],
  );

  const resetHorizontal = useCallback(() => {
    resetLayout();
    horizontalRef.current?.reset();
    verticalRef.current?.reset();
  }, [resetLayout]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--vigil-bg)]">
      <ActivityBar />
      <div className="min-w-0 flex-1">
        <Allotment
          ref={horizontalRef}
          proportionalLayout
          onChange={onHorizontalChange}
          onReset={resetHorizontal}
        >
          {sidebarVisible && (
            <Allotment.Pane
              minSize={200}
              preferredSize={`${layoutSizes.horizontal[0]}%`}
            >
              <SidebarPanel fill />
            </Allotment.Pane>
          )}
          <Allotment.Pane
            minSize={400}
            preferredSize={`${layoutSizes.horizontal[1]}%`}
          >
            <Allotment
              vertical
              ref={verticalRef}
              proportionalLayout
              onChange={bottomVisible ? onVerticalChange : undefined}
              onReset={() => {
                setVerticalSizes(DEFAULT_LAYOUT.vertical, 220);
                verticalRef.current?.reset();
              }}
            >
              <Allotment.Pane
                minSize={160}
                preferredSize={
                  bottomVisible ? `${layoutSizes.vertical[0]}%` : "100%"
                }
              >
                <EditorGroup />
              </Allotment.Pane>
              {bottomVisible && (
                <Allotment.Pane
                  minSize={120}
                  preferredSize={`${layoutSizes.vertical[1]}%`}
                >
                  <BottomPanel fill />
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>
          <Allotment.Pane
            minSize={300}
            preferredSize={`${layoutSizes.horizontal[2]}%`}
          >
            <ChatPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
      {!bottomVisible && (
        <button
          type="button"
          className="absolute bottom-0 left-12 right-0 z-10 border-t border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-1 text-left text-[11px] text-[var(--vigil-muted)]"
          onClick={() => useLayoutStore.getState().toggleBottom()}
        >
          Panel
        </button>
      )}
    </div>
  );
}

function App() {
  const view = useSettingsStore((s) => s.view);
  const settingsUnlocked = useSettingsStore((s) => s.settingsUnlocked);
  const refreshLogs = useCostStore((s) => s.refreshLogs);
  const initLayout = useLayoutStore((s) => s.initLayout);

  useEffect(() => {
    initLayout();
    void refreshLogs();
    const params = new URLSearchParams(window.location.search);
    if (params.get("agents") === "1") {
      useLayoutStore.setState({ sidebarVisible: false, bottomVisible: false });
    }
  }, [refreshLogs, initLayout]);

  let body = <IdeShell />;
  if (view === "settings" && settingsUnlocked === true) body = <SettingsPanel />;
  else if (view === "settings-locked" || view === "settings") {
    body = <SettingsUnlockScreen />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MenuBar />
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

export default App;
