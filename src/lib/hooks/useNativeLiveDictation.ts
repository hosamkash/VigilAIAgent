/**
 * Native macOS live dictation (SFSpeechRecognizer via Tauri).
 * Paints interim text while speaking — same UX idea as VigilHub Web Speech.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type DictationEvent = {
  kind: string;
  text: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Only the instance that started dictation consumes events or stops the session. */
let dictationOwner = 0;
const dictationRevokes = new Set<() => void>();

function claimDictation(revoke: () => void): number {
  for (const fn of dictationRevokes) fn();
  dictationRevokes.clear();
  dictationRevokes.add(revoke);
  dictationOwner += 1;
  return dictationOwner;
}

function appendChunk(base: string, chunk: string): string {
  const next = chunk.replace(/\s+/g, " ").trim();
  if (!next) return base;
  const current = base.replace(/\s+$/g, "");
  if (!current) return next;
  if (current.endsWith(next) || next === current) return current;
  if (next.startsWith(current) && next.length > current.length) return next;
  const needsSpace = !/[\s\n]$/.test(current) && !/^[,.;:!?،؛]/.test(next);
  return needsSpace ? `${current} ${next}` : `${current}${next}`;
}

export type UseNativeLiveDictationOptions = {
  getBaseText: () => string;
  onText: (text: string) => void;
  onError?: (message: string) => void;
  locale?: string;
};

export function useNativeLiveDictation({
  getBaseText,
  onText,
  onError,
  locale = "ar-EG",
}: UseNativeLiveDictationOptions) {
  const [listening, setListening] = useState(false);
  const [available] = useState(() => isTauri());

  const baseRef = useRef("");
  const committedRef = useRef("");
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const ownerRef = useRef(0);
  const revokeRef = useRef<(() => void) | null>(null);
  const onTextRef = useRef(onText);
  const getBaseTextRef = useRef(getBaseText);
  const onErrorRef = useRef(onError);
  onTextRef.current = onText;
  getBaseTextRef.current = getBaseText;
  onErrorRef.current = onError;

  const releaseOwner = useCallback(() => {
    if (revokeRef.current) {
      dictationRevokes.delete(revokeRef.current);
      revokeRef.current = null;
    }
    ownerRef.current = 0;
  }, []);

  const ownsSession = useCallback(
    () => ownerRef.current !== 0 && ownerRef.current === dictationOwner,
    [],
  );

  const paint = useCallback((interim: string) => {
    let text = baseRef.current.replace(/\s+$/g, "");
    const session = committedRef.current.trim();
    if (session) text = text ? appendChunk(text, session) : session;
    const live = interim.trim();
    if (live) text = text ? appendChunk(text, live) : live;
    onTextRef.current(text);
  }, []);

  const stop = useCallback(async () => {
    const mine = ownsSession();
    releaseOwner();
    setListening(false);
    if (!mine) return;
    try {
      await invoke("stop_live_dictation");
    } catch {
      /* ignore */
    }
  }, [ownsSession, releaseOwner]);

  const start = useCallback(async () => {
    if (!available || listening) return;

    baseRef.current = String(getBaseTextRef.current() || "");
    committedRef.current = "";
    const revoke = () => {
      ownerRef.current = 0;
      setListening(false);
    };
    revokeRef.current = revoke;
    ownerRef.current = claimDictation(revoke);

    try {
      if (!unlistenRef.current) {
        unlistenRef.current = await listen<DictationEvent>(
          "vigil-dictation",
          (ev) => {
            if (ownerRef.current === 0 || ownerRef.current !== dictationOwner) {
              return;
            }
            const { kind, text } = ev.payload;
            if (kind === "partial") {
              paint(text);
            } else if (kind === "final") {
              committedRef.current = appendChunk(committedRef.current, text);
              paint("");
            } else if (kind === "error") {
              onErrorRef.current?.(text || "Dictation error");
            } else if (kind === "auth" && text && text !== "ok") {
              onErrorRef.current?.(
                text === "microphone-denied"
                  ? "Microphone access was denied. Allow the microphone for Vigil Dictate in System Settings → Privacy & Security."
                  : "Speech recognition was denied. Allow speech recognition for Vigil Dictate in System Settings → Privacy & Security.",
              );
              releaseOwner();
              setListening(false);
            } else if (kind === "end") {
              releaseOwner();
              setListening(false);
            } else if (kind === "ready") {
              setListening(true);
            }
          },
        );
      }

      await invoke("start_live_dictation", { locale });
      setListening(true);
    } catch (err) {
      releaseOwner();
      setListening(false);
      onErrorRef.current?.(
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [available, listening, locale, paint, releaseOwner]);

  const toggle = useCallback(() => {
    if (listening) void stop();
    else void start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      const mine = ownerRef.current !== 0 && ownerRef.current === dictationOwner;
      if (revokeRef.current) {
        dictationRevokes.delete(revokeRef.current);
        revokeRef.current = null;
      }
      ownerRef.current = 0;
      if (mine) {
        void invoke("stop_live_dictation").catch(() => undefined);
      }
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  return {
    available,
    listening,
    toggle,
    start,
    stop,
  };
}
