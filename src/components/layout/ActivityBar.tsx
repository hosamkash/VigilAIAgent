import {
  Blocks,
  GitBranch,
  History,
  House,
  Play,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useLayoutStore, type SidebarView } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useExplorerStore } from "../../store/explorerStore";

const ITEMS: {
  id: SidebarView;
  label: string;
  icon?: string;
  Icon?: LucideIcon;
}[] = [
  { id: "explorer", label: "Explorer", icon: "📁" },
  { id: "search", label: "Search", icon: "🔍" },
  { id: "scm", label: "Source Control", Icon: GitBranch },
  { id: "run", label: "Run and Debug", Icon: Play },
  { id: "extensions", label: "Extensions", Icon: Blocks },
  { id: "history", label: "Vigil History", Icon: History },
];

export function ActivityBar() {
  const { sidebarView, setSidebarView } = useLayoutStore();
  const openSettingsGate = useSettingsStore((s) => s.openSettingsGate);
  const launcherOpen = useExplorerStore((s) => s.launcherOpen);
  const openLauncher = useExplorerStore((s) => s.openLauncher);

  return (
    <nav
      className="flex h-full w-14 flex-col items-center border-r border-[var(--vigil-border)] bg-[var(--vigil-activity)] py-2"
      aria-label="Activity Bar"
    >
      <button
        type="button"
        title="Projects"
        aria-label="Projects"
        onClick={openLauncher}
        className={`mb-1 flex h-11 w-11 items-center justify-center rounded ${
          launcherOpen
            ? "border-l-2 border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-text)]"
            : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
        }`}
      >
        <House className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      </button>
      {ITEMS.map((item) => {
        const active = sidebarView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => setSidebarView(item.id)}
            className={`mb-1 flex h-11 w-11 items-center justify-center rounded ${
              active
                ? "border-l-2 border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-text)]"
                : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            }`}
          >
            {item.Icon ? (
              <item.Icon className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            ) : (
              <span className="text-xl leading-none" aria-hidden>
                {item.icon}
              </span>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => openSettingsGate()}
        className="mb-1 flex h-11 w-11 items-center justify-center rounded text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
      >
        <Settings className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      </button>
    </nav>
  );
}
