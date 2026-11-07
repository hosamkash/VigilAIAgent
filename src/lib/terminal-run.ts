import { listen } from "@tauri-apps/api/event";
import {
  startWorkspaceCommand,
  type TerminalStreamEvent,
} from "./workspace-fs";

/**
 * Run a shell command and stream output via chunks.
 * Attaches the listener first, then starts the process.
 */
export async function streamWorkspaceCommand(
  command: string,
  cwd: string,
  onChunk: (text: string) => void,
): Promise<number> {
  const runId = crypto.randomUUID();
  let unlisten: (() => void) | undefined;

  try {
    const code = await new Promise<number>((resolve, reject) => {
      void (async () => {
        try {
          unlisten = await listen<TerminalStreamEvent>("vigil-terminal", (event) => {
            const payload = event.payload;
            if (payload.runId !== runId) return;
            if (payload.kind === "chunk" && payload.text) onChunk(payload.text);
            if (payload.kind === "done") {
              resolve(typeof payload.code === "number" ? payload.code : 0);
            }
          });
          await startWorkspaceCommand(command, cwd, runId);
        } catch (err) {
          reject(err);
        }
      })();
    });
    return code;
  } finally {
    unlisten?.();
  }
}
