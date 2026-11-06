import { useMemo, useState, type ReactNode } from "react";
import {
  BUILTIN_EXTENSIONS,
  MARKETPLACE_EXTENSIONS,
  type ExtensionItem,
} from "../../../lib/extensions-catalog";
import { useEditorTabsStore } from "../../../store/editorTabsStore";
import { useExtensionsStore } from "../../../store/extensionsStore";
import { BRAND_MARKS } from "../../../lib/brand-marks";
import vigilLogo from "../../../../src-tauri/icons/32x32.png";

function ExtensionIcon({ id }: { id: string }) {
  const brand = BRAND_MARKS[id];
  if (!brand) {
    return (
      <img
        src={vigilLogo}
        alt=""
        className="mt-0.5 h-7 w-7 shrink-0 rounded"
      />
    );
  }
  return (
    <span
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--vigil-border)] bg-white"
      title={brand.title}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4">
        <path fill={brand.color} d={brand.path} />
      </svg>
    </span>
  );
}

export function ExtensionsSidebar() {
  const [query, setQuery] = useState("");
  const openExtension = useEditorTabsStore((s) => s.openExtension);
  const selectedId = useExtensionsStore((s) => s.selectedId);
  const setSelected = useExtensionsStore((s) => s.setSelected);
  const isInstalled = useExtensionsStore((s) => s.isInstalled);
  const installingId = useExtensionsStore((s) => s.installingId);
  const install = useExtensionsStore((s) => s.install);
  const uninstall = useExtensionsStore((s) => s.uninstall);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...BUILTIN_EXTENSIONS, ...MARKETPLACE_EXTENSIONS];
    if (!q) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.publisher.toLowerCase().includes(q),
    );
  }, [query]);

  const installed = filtered.filter((e) => isInstalled(e.id));
  const marketplace = filtered.filter((e) => !isInstalled(e.id));

  function openDetails(ext: ExtensionItem) {
    setSelected(ext.id);
    openExtension({
      extensionId: ext.id,
      detailUrl: ext.detailUrl,
      name: ext.name,
      publisher: ext.publisher,
      builtin: ext.builtin,
    });
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        Extensions
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search extensions"
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-xs"
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        <Section title="Installed" count={installed.length}>
          {installed.map((e) => (
            <ExtRow
              key={e.id}
              item={e}
              selected={selectedId === e.id}
              installed
              busy={installingId === e.id}
              onOpen={() => openDetails(e)}
              onUninstall={
                e.builtin
                  ? undefined
                  : () => {
                      void uninstall(e);
                    }
              }
            />
          ))}
        </Section>
        <Section title="Marketplace" count={marketplace.length}>
          {marketplace.map((e) => (
            <ExtRow
              key={e.id}
              item={e}
              selected={selectedId === e.id}
              installed={false}
              busy={installingId === e.id}
              onOpen={() => openDetails(e)}
              onInstall={() => {
                openDetails(e);
                void install(e);
              }}
            />
          ))}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
        {title} ({count})
      </div>
      {count === 0 ? (
        <div className="px-1 text-[10px] text-[var(--vigil-muted)]">None</div>
      ) : (
        children
      )}
    </div>
  );
}

function ExtRow({
  item,
  selected,
  installed,
  busy,
  onOpen,
  onInstall,
  onUninstall,
}: {
  item: ExtensionItem;
  selected: boolean;
  installed: boolean;
  busy: boolean;
  onOpen: () => void;
  onInstall?: () => void;
  onUninstall?: () => void;
}) {
  return (
    <div
      className={`mb-1 rounded border px-2 py-1.5 transition-colors ${
        selected
          ? "border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)]"
          : "border-[var(--vigil-border-soft)] hover:bg-[var(--vigil-hover)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <ExtensionIcon id={item.id} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onOpen}
          title="Open extension details"
        >
          <div className="truncate text-xs font-medium text-[var(--vigil-text)]">
            {item.name}
          </div>
          <div className="text-[10px] text-[var(--vigil-muted)]">
            {item.publisher}
            {item.builtin ? " · built-in" : ""}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--vigil-muted)]">
            {item.description}
          </div>
        </button>

        <div className="shrink-0 pt-0.5">
          {item.builtin ? (
            <span className="text-[10px] text-[var(--vigil-success)]">On</span>
          ) : busy ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--vigil-accent)]">
              <span
                className="ext-spinner"
                style={{
                  borderColor: "rgba(0,120,212,0.25)",
                  borderTopColor: "var(--vigil-accent)",
                }}
                aria-hidden
              />
              …
            </span>
          ) : installed ? (
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--vigil-panel)]"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall?.();
              }}
            >
              Uninstall
            </button>
          ) : (
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-1.5 py-0.5 text-[10px] text-white"
              onClick={(e) => {
                e.stopPropagation();
                onInstall?.();
              }}
            >
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
