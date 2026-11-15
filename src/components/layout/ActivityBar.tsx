import {
  Blocks,
  Database,
  GitBranch,
  Globe,
  History,
  House,
  Play,
  Settings,
  Tickets,
  type LucideIcon,
} from "lucide-react";
import { useLayoutStore, type SidebarView } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useEditorTabsStore } from "../../store/editorTabsStore";

const ITEMS: {
  id: SidebarView;
  label: string;
  icon?: string;
  Icon?: LucideIcon;
  accent?: string;
}[] = [
  { id: "explorer", label: "Explorer", icon: "📁" },
  { id: "search", label: "Search", icon: "🔍" },
  { id: "scm", label: "Source Control", Icon: GitBranch },
  { id: "run", label: "Run and Debug", Icon: Play },
  {
    id: "database",
    label: "Database",
    Icon: Database,
    accent: "#038387",
  },
  {
    id: "browser",
    label: "Vigil Browser",
    Icon: Globe,
    accent: "#0078d4",
  },
  {
    id: "tickets",
    label: "Tickets",
    Icon: Tickets,
    accent: "#ea580c",
  },
  { id: "extensions", label: "Extensions", Icon: Blocks },
  { id: "history", label: "Vigil History", Icon: History },
];

export function ActivityBar() {
  const { sidebarView, setSidebarView } = useLayoutStore();
  const openSettingsGate = useSettingsStore((s) => s.openSettingsGate);
  const launcherOpen = useExplorerStore((s) => s.launcherOpen);
  const openLauncher = useExplorerStore((s) => s.openLauncher);

  function onSidebarClick(id: SidebarView) {
    setSidebarView(id);
    if (id === "browser") {
      const tabs = useEditorTabsStore.getState().tabs;
      const hasBrowser = tabs.some((t) => t.mode === "browser");
      if (!hasBrowser) {
        useEditorTabsStore.getState().openBrowser("");
      }
    }
    if (id === "tickets") {
      void import("../../lib/open-tickets-hub").then(({ openTicketsHub }) => {
        const store = useEditorTabsStore.getState();
        const hub = store.tabs.find((t) => t.mode === "tickets-hub");
        if (hub) store.setActive(hub.id);
        else openTicketsHub(undefined, "overview");
      });
    }
  }

  return (
    <nav
      className="flex h-full w-14 min-h-0 flex-col items-center overflow-y-auto border-r border-[var(--vigil-border)] bg-[var(--vigil-activity)] py-2"
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
            onClick={() => onSidebarClick(item.id)}
            className={`mb-1 flex h-11 w-11 items-center justify-center rounded ${
              active
                ? "border-l-2 bg-[var(--vigil-accent-soft)] text-[var(--vigil-text)]"
                : item.id === "tickets"
                  ? "bg-orange-500/15 text-orange-500 hover:bg-orange-500/25"
                  : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            }`}
            style={{
              ...(active
                ? { borderLeftColor: item.accent || "var(--vigil-accent)" }
                : {}),
              ...(item.accent && !active && item.id !== "tickets"
                ? { color: item.accent }
                : {}),
            }}
          >
            {item.Icon ? (
              <item.Icon
                className="h-6 w-6"
                strokeWidth={
                  item.id === "database" ||
                  item.id === "browser" ||
                  item.id === "tickets"
                    ? 2.5
                    : 2.25
                }
                aria-hidden
              />
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
