import { useMemo, useState, type ReactNode } from "react";

interface ExtItem {
  id: string;
  name: string;
  publisher: string;
  description: string;
  installed: boolean;
  builtin?: boolean;
}

const BUILTIN: ExtItem[] = [
  {
    id: "vigil.theme",
    name: "Vigil Themes",
    publisher: "Vigil",
    description: "Light, Dark, Ocean, Forest, Sunset color themes",
    installed: true,
    builtin: true,
  },
  {
    id: "vigil.git",
    name: "Git Source Control",
    publisher: "Vigil",
    description: "Built-in Git status, stage, commit, diff",
    installed: true,
    builtin: true,
  },
  {
    id: "vigil.terminal",
    name: "Integrated Terminal",
    publisher: "Vigil",
    description: "xterm.js command runner with theme sync",
    installed: true,
    builtin: true,
  },
  {
    id: "vigil.cline",
    name: "Cline Agent Core",
    publisher: "Vigil",
    description: "Sidecar-backed AI coding agent",
    installed: true,
    builtin: true,
  },
];

const MARKETPLACE_MOCK: ExtItem[] = [
  {
    id: "mock.prettier",
    name: "Prettier",
    publisher: "Prettier",
    description: "Code formatter (mock — V3.1 VSIX)",
    installed: false,
  },
  {
    id: "mock.eslint",
    name: "ESLint",
    publisher: "Microsoft",
    description: "Linting support (mock)",
    installed: false,
  },
  {
    id: "mock.python",
    name: "Python",
    publisher: "Microsoft",
    description: "Python language support (mock)",
    installed: false,
  },
  {
    id: "mock.rust",
    name: "rust-analyzer",
    publisher: "rust-lang",
    description: "Rust IDE features (mock)",
    installed: false,
  },
];

export function ExtensionsSidebar() {
  const [query, setQuery] = useState("");
  const [installedExtra, setInstalledExtra] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [
      ...BUILTIN,
      ...MARKETPLACE_MOCK.map((e) => ({
        ...e,
        installed: e.installed || installedExtra.includes(e.id),
      })),
    ];
    if (!q) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.publisher.toLowerCase().includes(q),
    );
  }, [query, installedExtra]);

  const installed = filtered.filter((e) => e.installed);
  const marketplace = filtered.filter((e) => !e.installed);

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        Extensions
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search extensions"
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <div className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-hover)] p-2 text-[11px] text-[var(--vigil-muted)]">
        Extensions support coming in V3.1 — VSIX install
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        <Section title="Installed">
          {installed.map((e) => (
            <ExtRow key={e.id} item={e} />
          ))}
        </Section>
        <Section title="Marketplace (mock)">
          {marketplace.map((e) => (
            <ExtRow
              key={e.id}
              item={e}
              onInstall={() =>
                setInstalledExtra((prev) =>
                  prev.includes(e.id) ? prev : [...prev, e.id],
                )
              }
            />
          ))}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function ExtRow({
  item,
  onInstall,
}: {
  item: ExtItem;
  onInstall?: () => void;
}) {
  return (
    <div className="mb-1 rounded border border-[var(--vigil-border-soft)] px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{item.name}</div>
          <div className="text-[10px] text-[var(--vigil-muted)]">
            {item.publisher}
            {item.builtin ? " · built-in" : ""}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--vigil-muted)]">
            {item.description}
          </div>
        </div>
        {item.installed ? (
          <span className="shrink-0 text-[10px] text-[var(--vigil-success)]">
            On
          </span>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px]"
            onClick={onInstall}
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}
