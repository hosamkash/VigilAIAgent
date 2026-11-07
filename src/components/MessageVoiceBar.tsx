import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, Pause, Play, Volume2, X } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { synthesizeMessageSpeech } from "../lib/gemini-tts";
import { notify } from "../lib/ide-commands";
import { useChatStore } from "../store/chatStore";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const cache = new Map<string, { blob: Blob; url: string }>();

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function downloadBlob(blob: Blob, baseName: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (inTauri()) {
    const target = await saveDialog({
      defaultPath: `${baseName}.wav`,
      filters: [{ name: "Audio", extensions: ["wav"] }],
    });
    if (typeof target !== "string" || !target) return;
    await writeFile(target, bytes);
    notify("Saved audio");
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.wav`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function MessageVoiceBar({
  messageId,
  text,
  children,
}: {
  messageId: string;
  text: string;
  children: (parts: { button: ReactNode; panel: ReactNode }) => ReactNode;
}) {
  const voiceId = useChatStore((s) => s.voiceId);
  const voiceGender = useChatStore((s) => s.voiceGender);
  const cacheKey = `${messageId}:${voiceGender}:${voiceId}`;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(
    () => cache.get(cacheKey)?.url ?? null,
  );

  useEffect(() => {
    setAudioUrl(cache.get(cacheKey)?.url ?? null);
  }, [cacheKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  async function ensureAudio(): Promise<string> {
    const hit = cache.get(cacheKey);
    if (hit) {
      setAudioUrl(hit.url);
      return hit.url;
    }
    setBusy(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const speech = await synthesizeMessageSpeech(text, {
        signal: controller.signal,
        voiceName: voiceId,
      });
      const url = URL.createObjectURL(speech.blob);
      cache.set(cacheKey, { blob: speech.blob, url });
      setAudioUrl(url);
      return url;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function bindAudio(url: string): HTMLAudioElement {
    let audio = audioRef.current;
    if (!audio || audio.src !== url) {
      audio?.pause();
      audio = new Audio(url);
      audio.playbackRate = speed;
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("play", () => setPlaying(true));
      audioRef.current = audio;
    }
    return audio;
  }

  async function openPanel() {
    setOpen(true);
    setError(null);
    try {
      const url = await ensureAudio();
      const audio = bindAudio(url);
      await audio.play();
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function togglePlay() {
    setError(null);
    try {
      const url = await ensureAudio();
      const audio = bindAudio(url);
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function closePanel() {
    abortRef.current?.abort();
    audioRef.current?.pause();
    setPlaying(false);
    setOpen(false);
    setError(null);
  }

  async function onDownload() {
    setError(null);
    try {
      await ensureAudio();
      const hit = cache.get(cacheKey);
      if (!hit) throw new Error("Audio is not ready yet.");
      await downloadBlob(hit.blob, `vigil-message-${messageId.slice(0, 8)}`);
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const button = (
    <button
      type="button"
      title={open ? "Hide voice" : "Listen"}
      aria-label={open ? "Hide voice" : "Listen to message"}
      aria-expanded={open}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded !text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
      onClick={() => {
        if (open) closePanel();
        else void openPanel();
      }}
    >
      <Volume2 className="h-3 w-3" />
    </button>
  );

  const panel = open ? (
    <div className="mb-1.5 flex w-full min-w-0 flex-col gap-1 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
          disabled={busy}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void togglePlay()}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-[var(--vigil-muted)]">
          Speed
          <select
            aria-label="Playback speed"
            value={String(speed)}
            className="h-6 rounded border border-[var(--vigil-border)] bg-[var(--vigil-editor)] px-1 text-[11px] text-[var(--vigil-text)]"
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          title="Download"
          aria-label="Download audio"
          disabled={busy && !audioUrl}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void onDownload()}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Close"
          aria-label="Close voice panel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
          onClick={closePanel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <div className="text-[10px] leading-snug text-[var(--vigil-danger)]">{error}</div>
      )}
    </div>
  ) : null;

  return <>{children({ button, panel })}</>;
}
