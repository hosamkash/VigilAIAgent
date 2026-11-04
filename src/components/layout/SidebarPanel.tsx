import { useLayoutStore } from "../../store/layoutStore";
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
      className={`flex h-full min-h-0 flex-col border-r border-[var(--vigil-border)] bg-[var(--vigil-sidebar)] ${
        fill ? "w-full" : "w-[260px] shrink-0"
      }`}
    >
      {sidebarView === "explorer" && <FileExplorer />}
      {sidebarView === "search" && <SearchSidebar />}
      {sidebarView === "scm" && <ScmSidebar />}
      {sidebarView === "run" && <RunSidebar />}
      {sidebarView === "extensions" && <ExtensionsSidebar />}
      {sidebarView === "history" && <HistorySidebar />}
    </aside>
  );
}
