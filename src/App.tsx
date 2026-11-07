import { useCallback, useEffect, useRef } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import "allotment/dist/style.css";
import { PaneToggleButton } from "./components/layout/PaneToggleButton";
import { ActivityBar } from "./components/layout/ActivityBar";
import { SidebarPanel } from "./components/layout/SidebarPanel";
import { EditorGroup } from "./components/layout/EditorGroup";
import { BottomPanel } from "./components/layout/BottomPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SettingsUnlockScreen } from "./components/SettingsUnlockScreen";
import { ExplorerDragGhost } from "./components/ExplorerDragGhost";
import { isDeviceAuthEnabled } from "./lib/secure-storage";
import { useSettingsStore } from "./store/settingsStore";
import { useLayoutStore } from "./store/layoutStore";
import { useCostStore } from "./store/costStore";
import {
  DEFAULT_LAYOUT,
  mergeHorizontalSizes,
  sizesToPercents,
} from "./lib/layout-persist";
import { destroyExtHostWebview } from "./lib/embedded-site";
import { destroyVigilEmbedWebview } from "./lib/vigil-embed-webview";
import { MenuBar } from "./components/layout/MenuBar";
import { StatusBar } from "./components/layout/StatusBar";
import { bindClipWorkspace, installClipCapture } from "./lib/clip-shelf";
import { useExplorerStore } from "./store/explorerStore";

function IdeShell() {
  const {
    sidebarVisible,
    chatVisible,
    bottomVisible,
    layoutSizes,
    setVerticalSizes,
    resetLayout,
  } = useLayoutStore();
  const horizontalRef = useRef<AllotmentHandle | null>(null);
  const verticalRef = useRef<AllotmentHandle | null>(null);

  useEffect(() => {
    void destroyExtHostWebview();
    void destroyVigilEmbedWebview();
  }, []);

  useEffect(() => {
    bindClipWorkspace(
      () => useExplorerStore.getState().root?.trim() || "none",
    );
    return installClipCapture();
  }, []);

  const onHorizontalChange = useCallback((sizes: number[]) => {
    const state = useLayoutStore.getState();
    const next = mergeHorizontalSizes(
      sizes,
      state.sidebarVisible,
      state.chatVisible,
    );
    if (next) state.setHorizontalSizes(next);
  }, []);

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
    <div className="relative flex h-full w-full overflow-hidden bg-[var(--vigil-bg)]">
      <ActivityBar />
      {!sidebarVisible && (
        <div className="flex h-full w-9 shrink-0 items-start justify-center border-r border-[var(--vigil-border)] bg-[var(--vigil-sidebar)] pt-1.5">
          <PaneToggleButton
            direction="right"
            label="Expand sidebar"
            onClick={() => useLayoutStore.getState().toggleSidebar()}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Allotment
          ref={horizontalRef}
          proportionalLayout
          onChange={onHorizontalChange}
          onReset={resetHorizontal}
        >
          <Allotment.Pane
            minSize={200}
            preferredSize={`${layoutSizes.horizontal[0]}%`}
            visible={sidebarVisible}
          >
            <SidebarPanel fill />
          </Allotment.Pane>
          <Allotment.Pane
            minSize={280}
            preferredSize={`${layoutSizes.horizontal[1]}%`}
          >
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <div className="min-h-0 flex-1">
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
              </div>
              {!bottomVisible && (
                <div className="flex h-8 shrink-0 items-center justify-end border-t border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2">
                  <PaneToggleButton
                    direction="up"
                    label="Expand panel"
                    onClick={() => useLayoutStore.getState().toggleBottom()}
                  />
                </div>
              )}
            </div>
          </Allotment.Pane>
          <Allotment.Pane
            minSize={300}
            preferredSize={`${layoutSizes.horizontal[2]}%`}
            visible={chatVisible}
          >
            <ChatPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
      {!chatVisible && (
        <div className="flex h-full w-9 shrink-0 items-start justify-center border-l border-[var(--vigil-border)] bg-[var(--vigil-panel)] pt-1.5">
          <PaneToggleButton
            direction="left"
            label="Expand chat"
            onClick={() => useLayoutStore.getState().toggleChat()}
          />
        </div>
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
  else if (!isDeviceAuthEnabled() && (view === "settings-locked" || view === "settings")) {
    body = <SettingsPanel />;
  } else if (view === "settings-locked" || view === "settings") {
    body = <SettingsUnlockScreen />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MenuBar />
      <div className="min-h-0 flex-1">{body}</div>
      <StatusBar />
      <ExplorerDragGhost />
    </div>
  );
}

export default App;
