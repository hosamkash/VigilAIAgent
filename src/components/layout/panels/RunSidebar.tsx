import { useEffect, useState } from "react";
import { useExplorerStore } from "../../../store/explorerStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useTerminalStore } from "../../../store/terminalStore";
import { readTextFile, runWorkspaceCommand } from "../../../lib/workspace-fs";

interface RunConfig {
  id: string;
  label: string;
  command: string;
  source: "package.json" | "custom" | "launch";
}

const CUSTOM_KEY = "vigil.runConfigs";

function loadCustom(): RunConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RunConfig[];
  } catch {
    return [];
  }
}

export function RunSidebar() {
  const root = useExplorerStore((s) => s.root);
  const setBottomTab = useLayoutStore((s) => s.setBottomTab);
  const appendOutput = useTerminalStore((s) => s.appendOutput);
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [launchJson, setLaunchJson] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!root) return;
      const list: RunConfig[] = [...loadCustom()];
      try {
        const pkg = await readTextFile(`${root}/package.json`);
        const json = JSON.parse(pkg) as { scripts?: Record<string, string> };
        for (const [name, cmd] of Object.entries(json.scripts ?? {})) {
          list.push({
            id: `npm:${name}`,
            label: `npm run ${name}`,
            command: `npm run ${JSON.stringify(name)}`,
            source: "package.json",
          });
          void cmd;
        }
      } catch {
        /* no package.json */
      }
      try {
        const launch = await readTextFile(`${root}/.vscode/launch.json`);
        setLaunchJson(launch);
        list.push({
          id: "launch.json",
          label: "Show launch.json",
          command: "",
          source: "launch",
        });
      } catch {
        setLaunchJson(null);
      }
      setConfigs(list);
    })();
  }, [root]);

  async function run(cfg: RunConfig) {
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
      // also mirror into active terminal history
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
      <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        Run and Debug
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {configs.length === 0 && (
          <div className="text-xs text-[var(--vigil-muted)]">
            No package.json scripts found.
          </div>
        )}
        {configs.map((cfg) => (
          <div
            key={cfg.id}
            className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[var(--vigil-hover)]"
          >
            <button
              type="button"
              disabled={running === cfg.id}
              onClick={() => void run(cfg)}
              className="rounded bg-[var(--vigil-accent)] px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
              title="Run"
            >
              ▶
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{cfg.label}</div>
              <div className="truncate text-[10px] text-[var(--vigil-muted)]">
                {cfg.source}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded border border-dashed border-[var(--vigil-border)] p-2 text-[11px] text-[var(--vigil-muted)]">
        <div className="mb-1 font-semibold text-[var(--vigil-text)]">Debug</div>
        Attach debugger (V3.1)
        {launchJson && (
          <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px]">
            {launchJson.slice(0, 800)}
            {launchJson.length > 800 ? "…" : ""}
          </pre>
        )}
      </div>
    </div>
  );
}
