import { useLayoutStore } from "../../store/layoutStore";
import { PaneToggleButton } from "./PaneToggleButton";
import { FileExplorer } from "./FileExplorer";
import { SearchSidebar } from "./panels/SearchSidebar";
import { ScmSidebar } from "./panels/ScmSidebar";
import { HistorySidebar } from "./panels/HistorySidebar";
import { RunSidebar } from "./panels/RunSidebar";
import { ExtensionsSidebar } from "./panels/ExtensionsSidebar";

export function SidebarPanel({ fill = false }: { fill?: boolean }) {
  const { sidebarView, sidebarVisible } = useLayoutStore();
  if (!sidebarVisible) return null;

  return (
    <aside
      className={`relative flex h-full min-h-0 flex-col border-r border-[var(--vigil-border)] bg-[var(--vigil-sidebar)] ${
        fill ? "w-full" : "w-[260px] shrink-0"
      }`}
    >
      <div className="absolute top-1.5 right-1.5 z-10">
        <PaneToggleButton
          direction="left"
          label="Collapse sidebar"
          onClick={() => useLayoutStore.getState().toggleSidebar()}
        />
      </div>
      {sidebarView === "explorer" && <FileExplorer />}
      {sidebarView === "search" && <SearchSidebar />}
      {sidebarView === "scm" && <ScmSidebar />}
      {sidebarView === "run" && <RunSidebar />}
      {sidebarView === "extensions" && <ExtensionsSidebar />}
      {sidebarView === "history" && <HistorySidebar />}
    </aside>
  );
}
