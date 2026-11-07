/**
 * Copied from VigilHub `lib/hooks/use-speech-dictation.ts`
 * (same engine as the support-ticket description field).
 * Web Speech only: ar-EG, continuous, interim results, live paint.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0?: { transcript?: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type UseSpeechDictationOptions = {
  getBaseText: () => string;
  onText: (text: string) => void;
  mode?: "replace" | "append";
  stopOnSilence?: boolean;
};

function normalizeSpeechChunk(value: string): string {
  return value
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function appendSpeechChunk(base: string, chunk: string): string {
  const next = normalizeSpeechChunk(chunk);
  if (!next) return base;
  const current = base.replace(/\s+$/g, "");
  if (!current) return next;

  const currentNorm = normalizeSpeechChunk(current).toLowerCase();
  const nextNorm = next.toLowerCase();
  if (currentNorm === nextNorm || currentNorm.endsWith(nextNorm)) return current;
  if (nextNorm.startsWith(currentNorm) && nextNorm.length > currentNorm.length) {
    return next;
  }

  const maxOverlap = Math.min(currentNorm.length, nextNorm.length);
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (currentNorm.slice(-size) === nextNorm.slice(0, size)) {
      const remainder = next.slice(size).trimStart();
      return remainder ? `${current} ${remainder}` : current;
    }
  }

  const needsSpace = !/[\s\n]$/.test(current) && !/^[,.;:!?،؛]/.test(next);
  return needsSpace ? `${current} ${next}` : `${current}${next}`;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechDictation({
  getBaseText,
  onText,
  mode = "replace",
  stopOnSilence = true,
}: UseSpeechDictationOptions) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => !!getSpeechRecognitionCtor());

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stopRequestedRef = useRef(false);
  const baseRef = useRef("");
  const committedRef = useRef("");
  const interimRef = useRef("");
  const cursorRef = useRef(0);
  const onTextRef = useRef(onText);
  const getBaseTextRef = useRef(getBaseText);
  onTextRef.current = onText;
  getBaseTextRef.current = getBaseText;

  const buildText = useCallback(
    (interim: string): string => {
      let text =
        mode === "replace" ? "" : baseRef.current.replace(/\s+$/g, "");
      if (mode === "replace") {
        const session = committedRef.current.trim();
        text = session;
        const live = normalizeSpeechChunk(interim);
        if (!live) return text;
        const sessionNorm = normalizeSpeechChunk(
          committedRef.current,
        ).toLowerCase();
        const liveNorm = live.toLowerCase();
        if (
          sessionNorm &&
          (sessionNorm.endsWith(liveNorm) || liveNorm === sessionNorm)
        ) {
          return text;
        }
        return text ? appendSpeechChunk(text, live) : live;
      }

      const session = committedRef.current.trim();
      if (session) {
        text = text ? appendSpeechChunk(text, session) : session;
      }
      const live = normalizeSpeechChunk(interim);
      if (!live) return text;
      const sessionNorm = normalizeSpeechChunk(
        committedRef.current,
      ).toLowerCase();
      const liveNorm = live.toLowerCase();
      if (
        sessionNorm &&
        (sessionNorm.endsWith(liveNorm) || liveNorm === sessionNorm)
      ) {
        return text;
      }
      return text ? appendSpeechChunk(text, live) : live;
    },
    [mode],
  );

  const paint = useCallback(
    (interim: string) => {
      onTextRef.current(buildText(interim));
    },
    [buildText],
  );

  const commitInterimIfAny = useCallback(() => {
    const leftover = normalizeSpeechChunk(interimRef.current);
    if (!leftover) return;
    committedRef.current = appendSpeechChunk(committedRef.current, leftover);
    interimRef.current = "";
    paint("");
  }, [paint]);

  const stop = useCallback(
    (opts?: { silent?: boolean }) => {
      void opts;
      commitInterimIfAny();
      stopRequestedRef.current = true;
      try {
        recognitionRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      setListening(false);
      interimRef.current = "";
      cursorRef.current = 0;
    },
    [commitInterimIfAny],
  );

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    if (listening) return;

    // WKWebView + SpeechRecognition aborts the Tauri process on macOS.
    if ("__TAURI_INTERNALS__" in window) return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    baseRef.current = String(getBaseTextRef.current() || "");
    committedRef.current = "";
    interimRef.current = "";
    cursorRef.current = 0;
    stopRequestedRef.current = false;

    const recognition = new Ctor();
    recognition.lang = "ar-EG";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    setListening(true);

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const startAt = Math.max(
        Number(event.resultIndex) || 0,
        cursorRef.current,
      );
      let interim = "";
      for (let i = startAt; i < event.results.length; i += 1) {
        const item = event.results[i];
        const piece = normalizeSpeechChunk(String(item?.[0]?.transcript || ""));
        if (!piece) continue;
        if (item?.isFinal) {
          committedRef.current = appendSpeechChunk(
            committedRef.current,
            piece,
          );
          cursorRef.current = i + 1;
        } else {
          interim = interim ? appendSpeechChunk(interim, piece) : piece;
        }
      }
      for (let i = cursorRef.current; i < event.results.length; i += 1) {
        if (event.results[i]?.isFinal) cursorRef.current = i + 1;
      }
      interimRef.current = interim;
      paint(interim);
    };

    recognition.onerror = (ev) => {
      const err = String(ev?.error || "");
      if (err === "no-speech" || err === "aborted") return;
      stopRequestedRef.current = true;
      commitInterimIfAny();
      recognitionRef.current = null;
      setListening(false);
    };

    recognition.onend = () => {
      if (
        !stopOnSilence &&
        !stopRequestedRef.current &&
        recognitionRef.current === recognition
      ) {
        commitInterimIfAny();
        cursorRef.current = 0;
        try {
          recognition.start();
          return;
        } catch {
          /* ignore */
        }
      }
      if (!stopRequestedRef.current) {
        commitInterimIfAny();
        recognitionRef.current = null;
        setListening(false);
        interimRef.current = "";
        cursorRef.current = 0;
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.error(error);
      recognitionRef.current = null;
      setListening(false);
    }
  }, [listening, stopOnSilence, paint, commitInterimIfAny]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      try {
        recognitionRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, []);

  return {
    listening,
    supported,
    toggle,
    start,
    stop,
  };
}
