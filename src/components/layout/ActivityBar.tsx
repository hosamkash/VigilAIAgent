import { useLayoutStore, type SidebarView } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";

const ITEMS: { id: SidebarView; label: string; icon: string }[] = [
  { id: "explorer", label: "Explorer", icon: "📁" },
  { id: "search", label: "Search", icon: "🔍" },
  { id: "scm", label: "Source Control", icon: "⎇" },
  { id: "run", label: "Run and Debug", icon: "▶" },
  { id: "extensions", label: "Extensions", icon: "⧉" },
  { id: "history", label: "Vigil History", icon: "◷" },
];

export function ActivityBar() {
  const { sidebarView, setSidebarView } = useLayoutStore();
  const openSettingsGate = useSettingsStore((s) => s.openSettingsGate);

  return (
    <nav
      className="flex h-full w-12 flex-col items-center border-r border-[var(--vigil-border)] bg-[var(--vigil-activity)] py-2"
      aria-label="Activity Bar"
    >
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          onClick={() => setSidebarView(item.id)}
          className={`mb-1 flex h-10 w-10 items-center justify-center rounded text-base ${
            sidebarView === item.id
              ? "border-l-2 border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-text)]"
              : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          }`}
        >
          <span aria-hidden>{item.icon}</span>
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => openSettingsGate()}
        className="flex h-10 w-10 items-center justify-center text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
      >
        ⚙
      </button>
    </nav>
  );
}
