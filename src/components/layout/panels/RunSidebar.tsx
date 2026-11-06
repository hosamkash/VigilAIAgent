import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useExplorerStore } from "../../../store/explorerStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useTerminalStore } from "../../../store/terminalStore";
import { readTextFile, runWorkspaceCommand } from "../../../lib/workspace-fs";
import { useNativeLiveDictation } from "../../../lib/hooks/useNativeLiveDictation";
import { useSpeechDictation } from "../../../lib/hooks/useSpeechDictation";
import { SpeechDictationMicButton } from "../../SpeechDictationMicButton";
import {
  deleteRunCommand,
  listRunCommandDocs,
  upsertRunCommand,
  upsertRunOverride,
  type RunCommandDoc,
} from "../../../lib/vigil-db";

interface DiscoveredConfig {
  id: string;
  command: string;
  description: string;
  source: "package.json" | "launch";
}

interface DisplayConfig {
  id: string;
  command: string;
  description: string;
  source: "custom" | "package.json" | "launch";
  /** VigilDB doc id when custom or overridden */
  dbId?: string;
  baseId?: string;
  editable: boolean;
  deletable: boolean;
}

const SCRIPT_PURPOSE_AR: Record<string, string> = {
  dev: "تشغيل وضع التطوير",
  start: "تشغيل التطبيق",
  serve: "تشغيل السيرفر المحلي",
  build: "بناء نسخة الإنتاج",
  preview: "معاينة النسخة المبنية",
  tauri: "تشغيل تطبيق سطح المكتب",
  "tauri:dev": "تشغيل التطبيق أثناء التطوير",
  "tauri:build": "بناء تطبيق سطح المكتب",
  test: "تشغيل الاختبارات مرة واحدة",
  "test:watch": "اختبارات مع إعادة التشغيل",
  "test:ui": "فتح واجهة الاختبارات",
  lint: "فحص جودة الكود",
  format: "تنسيق الكود",
  typecheck: "فحص الأنواع",
  sidecar: "تشغيل الخدمة الجانبية",
};

const SCRIPT_RANK = [
  "dev",
  "start",
  "tauri",
  "tauri:dev",
  "serve",
  "build",
  "tauri:build",
  "preview",
  "test",
  "test:watch",
  "test:ui",
  "lint",
  "typecheck",
  "format",
  "sidecar",
];

function describeScript(name: string, command: string): string {
  const key = name.trim().toLowerCase();
  const known = SCRIPT_PURPOSE_AR[key];
  if (known) return known;

  const cmd = command.toLowerCase();
  if (cmd.includes("vitest") || cmd.includes("jest") || cmd.includes("mocha")) {
    return cmd.includes("watch")
      ? "اختبارات مع إعادة التشغيل"
      : "تشغيل الاختبارات";
  }
  if (cmd.includes("tauri") && cmd.includes("build")) return "بناء تطبيق سطح المكتب";
  if (cmd.includes("tauri")) return "تشغيل تطبيق سطح المكتب";
  if (cmd.includes("tsc") && (cmd.includes("vite build") || cmd.includes("build"))) {
    return "فحص الأنواع ثم البناء";
  }
  if (cmd.includes("vite") && cmd.includes("preview")) return "معاينة النسخة المبنية";
  if (cmd.includes("vite") && cmd.includes("build")) return "بناء الواجهة";
  if (cmd.includes("vite") || cmd.includes("next dev") || cmd.includes("webpack")) {
    return "تشغيل سيرفر التطوير";
  }
  if (cmd.includes("eslint")) return "فحص جودة الكود";
  if (cmd.includes("prettier")) return "تنسيق الكود";
  if (key.startsWith("test")) return "تشغيل الاختبارات";
  if (key.includes("build")) return "بناء المشروع";
  if (key.includes("lint")) return "فحص جودة الكود";
  return "أمر من المشروع";
}

function scriptRank(name: string): number {
  const i = SCRIPT_RANK.indexOf(name.trim().toLowerCase());
  return i === -1 ? SCRIPT_RANK.length : i;
}

function matchesFilter(cfg: DisplayConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    cfg.command.toLowerCase().includes(q) ||
    cfg.description.toLowerCase().includes(q) ||
    cfg.source.toLowerCase().includes(q)
  );
}

export function RunSidebar() {
  const root = useExplorerStore((s) => s.root);
  const setBottomTab = useLayoutStore((s) => s.setBottomTab);
  const appendOutput = useTerminalStore((s) => s.appendOutput);

  const [dbDocs, setDbDocs] = useState<RunCommandDoc[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredConfig[]>([]);
  const [launchJson, setLaunchJson] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draftCommand, setDraftCommand] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DisplayConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftDescRef = useRef(draftDesc);
  draftDescRef.current = draftDesc;

  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const nativeDictation = useNativeLiveDictation({
    getBaseText: () => draftDescRef.current,
    onText: setDraftDesc,
    onError: (msg) => setError(msg),
  });
  const webDictation = useSpeechDictation({
    getBaseText: () => draftDescRef.current,
    onText: setDraftDesc,
    mode: "append",
    stopOnSilence: false,
  });
  const listening = inTauri
    ? nativeDictation.listening
    : webDictation.listening;

  function stopDictation() {
    if (inTauri) void nativeDictation.stop();
    else webDictation.stop();
  }

  function toggleDictation() {
    if (busy) return;
    setError(null);
    if (inTauri) nativeDictation.toggle();
    else webDictation.toggle();
  }

  const refreshDb = useCallback(async () => {
    try {
      setDbDocs(await listRunCommandDocs());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refreshDb();
  }, [refreshDb]);

  useEffect(() => {
    void (async () => {
      if (!root) {
        setDiscovered([]);
        return;
      }
      const list: DiscoveredConfig[] = [];
      try {
        const pkg = await readTextFile(`${root}/package.json`);
        const json = JSON.parse(pkg) as { scripts?: Record<string, string> };
        const scripts = Object.entries(json.scripts ?? {}).sort(
          ([a], [b]) => scriptRank(a) - scriptRank(b) || a.localeCompare(b),
        );
        for (const [name, cmd] of scripts) {
          list.push({
            id: `npm:${name}`,
            command: `npm run ${name}`,
            description: describeScript(name, cmd),
            source: "package.json",
          });
        }
      } catch {
        /* no package.json */
      }
      try {
        const launch = await readTextFile(`${root}/.vscode/launch.json`);
        setLaunchJson(launch);
        list.push({
          id: "launch.json",
          command: "launch.json",
          description: "عرض إعدادات التشغيل",
          source: "launch",
        });
      } catch {
        setLaunchJson(null);
      }
      setDiscovered(list);
    })();
  }, [root]);

  const displayList = useMemo(() => {
    const customs = dbDocs.filter((d) => d.kind === "custom");
    const overrides = new Map(
      dbDocs
        .filter((d) => d.kind === "override" && d.baseId)
        .map((d) => [d.baseId!, d]),
    );

    const ready: DisplayConfig[] = discovered.map((d) => {
      const ov = overrides.get(d.id);
      if (ov) {
        return {
          id: d.id,
          command: ov.command,
          description: ov.description || d.description,
          source: d.source,
          dbId: ov.id,
          baseId: d.id,
          editable: true,
          deletable: true,
        };
      }
      return {
        id: d.id,
        command: d.command,
        description: d.description,
        source: d.source,
        baseId: d.id,
        editable: true,
        deletable: false,
      };
    });

    const mine: DisplayConfig[] = customs.map((c) => ({
      id: c.id,
      command: c.command,
      description: c.description,
      source: "custom" as const,
      dbId: c.id,
      editable: true,
      deletable: true,
    }));

    return { mine, ready };
  }, [dbDocs, discovered]);

  const filteredMine = useMemo(
    () => displayList.mine.filter((c) => matchesFilter(c, filter)),
    [displayList.mine, filter],
  );
  const filteredReady = useMemo(
    () => displayList.ready.filter((c) => matchesFilter(c, filter)),
    [displayList.ready, filter],
  );

  function resetForm() {
    stopDictation();
    setDraftCommand("");
    setDraftDesc("");
    setEditing(null);
    setShowForm(false);
  }

  function startAdd() {
    setEditing(null);
    setDraftCommand("");
    setDraftDesc("");
    setShowForm(true);
  }

  function startEdit(cfg: DisplayConfig) {
    setEditing(cfg);
    setDraftCommand(cfg.command);
    setDraftDesc(cfg.description);
    setShowForm(true);
  }

  async function saveDraft() {
    const command = draftCommand.trim();
    if (!command) return;
    setBusy(true);
    setError(null);
    try {
      if (editing?.source === "custom" && editing.dbId) {
        await upsertRunCommand({
          id: editing.dbId,
          command,
          description: draftDesc.trim(),
          kind: "custom",
        });
      } else if (editing && editing.source !== "custom") {
        await upsertRunOverride({
          baseId: editing.baseId ?? editing.id,
          command,
          description: draftDesc.trim(),
        });
      } else {
        await upsertRunCommand({
          id: crypto.randomUUID(),
          command,
          description: draftDesc.trim(),
          kind: "custom",
        });
      }
      await refreshDb();
      resetForm();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCfg(cfg: DisplayConfig) {
    if (!cfg.dbId) return;
    setBusy(true);
    try {
      await deleteRunCommand(cfg.dbId);
      await refreshDb();
      if (editing?.id === cfg.id) resetForm();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(cfg: DisplayConfig) {
    if (!root) return;
    if (cfg.source === "launch") {
      setBottomTab("output");
      appendOutput(launchJson ?? "(no launch.json)");
      return;
    }
    setRunning(cfg.id);
    setBottomTab("output");
    appendOutput(`\n$ ${cfg.command}\n`);
    try {
      const out = await runWorkspaceCommand(cfg.command, root);
      appendOutput(out + "\n");
      const term = useTerminalStore.getState();
      if (term.activeId) {
        term.appendHistory(term.activeId, `$ ${cfg.command}\n${out}\n$ `);
      }
    } catch (err) {
      appendOutput(String(err) + "\n");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
          Run and Debug
        </div>
        <button
          type="button"
          className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--vigil-hover)]"
          onClick={() => {
            if (showForm && !editing) resetForm();
            else startAdd();
          }}
        >
          {showForm && !editing ? "Cancel" : "+ Add"}
        </button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter commands…"
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
      />

      {error && (
        <div className="mb-2 rounded border border-[var(--vigil-danger)]/30 px-2 py-1 text-[10px] text-[var(--vigil-danger)]">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-2 space-y-1.5 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-2">
          <div className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
            {editing
              ? editing.source === "custom"
                ? "Edit command"
                : "Edit (saves as your override in VigilDB)"
              : "New quick command"}
          </div>
          <input
            value={draftCommand}
            onChange={(e) => setDraftCommand(e.target.value)}
            placeholder="Command — e.g. npm run dev"
            className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 font-mono text-[11px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void saveDraft();
              }
              if (e.key === "Escape") resetForm();
            }}
          />
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            placeholder="Description / ليه الأمر ده؟ (عربي أو English)"
            rows={2}
            className="w-full resize-none rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!draftCommand.trim() || busy}
              className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
              onClick={() => void saveDraft()}
            >
              {busy ? "…" : editing ? "Save" : "Add"}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px]"
              onClick={resetForm}
            >
              Cancel
            </button>
            <SpeechDictationMicButton
              size="sm"
              active={listening}
              disabled={busy}
              onClick={toggleDictation}
              title={
                listening
                  ? "Stop voice to text"
                  : "Voice to text — description"
              }
            />
            {listening && (
              <span className="text-[10px] text-[var(--vigil-muted)]">
                Listening…
              </span>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        <Section
          title="My commands"
          count={filteredMine.length}
          emptyHint={
            displayList.mine.length === 0
              ? "Saved in your .vigilDB — add shortcuts you don’t want to forget."
              : "No matches."
          }
        >
          {filteredMine.map((cfg) => (
            <CommandRow
              key={cfg.id}
              cfg={cfg}
              running={running === cfg.id}
              onRun={() => void run(cfg)}
              onEdit={() => startEdit(cfg)}
              onDelete={() => void removeCfg(cfg)}
            />
          ))}
        </Section>

        <Section
          title="Ready scripts"
          count={filteredReady.length}
          emptyHint={
            discovered.length === 0
              ? "No package.json scripts found."
              : "No matches."
          }
        >
          {filteredReady.map((cfg) => (
            <CommandRow
              key={cfg.id}
              cfg={cfg}
              running={running === cfg.id}
              onRun={() => void run(cfg)}
              onEdit={() => startEdit(cfg)}
              onDelete={
                cfg.deletable ? () => void removeCfg(cfg) : undefined
              }
            />
          ))}
        </Section>
      </div>

      {launchJson && (
        <div className="mt-2 max-h-24 overflow-auto rounded border border-dashed border-[var(--vigil-border)] p-2 text-[10px] text-[var(--vigil-muted)]">
          <div className="mb-1 font-semibold text-[var(--vigil-text)]">
            launch.json
          </div>
          <pre className="font-mono whitespace-pre-wrap">
            {launchJson.slice(0, 600)}
            {launchJson.length > 600 ? "…" : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  emptyHint,
  children,
}: {
  title: string;
  count: number;
  emptyHint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
        {title} ({count})
      </div>
      {count === 0 ? (
        <div className="px-1 text-[10px] text-[var(--vigil-muted)]">{emptyHint}</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  );
}

function CommandRow({
  cfg,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  cfg: DisplayConfig;
  running: boolean;
  onRun: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-[var(--vigil-hover)]">
      <button
        type="button"
        disabled={running}
        onClick={onRun}
        className="mt-0.5 shrink-0 rounded bg-[var(--vigil-accent)] px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
        title="Run"
      >
        {running ? "…" : "▶"}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs" title={cfg.command}>
          {cfg.command}
        </div>
        {cfg.description ? (
          <div
            className="truncate text-[10px] text-[var(--vigil-muted)]"
            title={cfg.description}
          >
            {cfg.description}
            {cfg.dbId && cfg.source !== "custom" ? " · override" : ""}
          </div>
        ) : null}
      </div>
      <div className="hidden shrink-0 gap-0.5 group-hover:flex">
        {onEdit && (
          <button
            type="button"
            className="px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            title="Edit"
            onClick={onEdit}
          >
            ✎
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="px-1 text-[10px] text-[var(--vigil-danger)]"
            title="Delete"
            onClick={onDelete}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
