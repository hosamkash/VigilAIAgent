import { create } from "zustand";
import { insertMonacoText, readMonacoSelection } from "./monaco-bridge";

export const CLIP_LIMIT = 15;
export const CLIP_MAX_CHARS = 50_000;
const CLIP_IMAGE_EDGE = 480;
const CLIP_IMAGE_MAX_CHARS = 180_000;

export interface Clip {
  id: string;
  text: string;
  image?: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ClipInput = string | { text?: string; image?: string };

let readWorkspace = () => "none";
let installed = false;

export function bindClipWorkspace(read: () => string) {
  readWorkspace = read;
}

function clipPayload(
  input: ClipInput,
): { text: string; image?: string } | null {
  const text = (typeof input === "string" ? input : (input.text ?? "")).slice(
    0,
    CLIP_MAX_CHARS,
  );
  const image =
    typeof input === "string" ? undefined : input.image?.trim() || undefined;
  if (!text.trim() && !image) return null;
  return { text, image };
}

export function placeClip(
  clips: Clip[],
  input: ClipInput,
  now = Date.now(),
  opts?: { ifNew?: boolean },
): Clip[] {
  const value = clipPayload(input);
  if (!value) return clips;
  const existing = clips.find(
    (clip) => clip.text === value.text && (clip.image ?? "") === (value.image ?? ""),
  );
  if (existing && opts?.ifNew) return clips;
  const next = existing
    ? [
        { ...existing, updatedAt: now },
        ...clips.filter((clip) => clip.id !== existing.id),
      ]
    : [
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          text: value.text,
          image: value.image,
          pinned: false,
          createdAt: now,
          updatedAt: now,
        },
        ...clips,
      ];
  let kept = next;
  while (kept.length > CLIP_LIMIT) {
    const oldest = [...kept]
      .filter((clip) => !clip.pinned)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!oldest || oldest.updatedAt === now) break;
    kept = kept.filter((clip) => clip.id !== oldest.id);
  }
  return kept.sort((a, b) => b.updatedAt - a.updatedAt);
}

function storageKey(workspace: string): string {
  return `vigil.clipShelf:${workspace}`;
}

export function loadClips(workspace: string): Clip[] {
  try {
    const raw = localStorage.getItem(storageKey(workspace));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Clip =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        typeof item.pinned === "boolean" &&
        (item.image === undefined || typeof item.image === "string"),
    );
  } catch {
    return [];
  }
}

function saveClips(workspace: string, clips: Clip[]): Clip[] {
  let next = clips;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(storageKey(workspace), JSON.stringify(next));
      return next;
    } catch {
      const oldest = [...next]
        .filter((clip) => !clip.pinned)
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) return clips;
      next = next.filter((clip) => clip.id !== oldest.id);
    }
  }
  return next;
}

interface ClipShelfState {
  workspace: string;
  clips: Clip[];
  load: (workspace: string) => void;
  add: (input: ClipInput, ifNew?: boolean) => void;
  update: (id: string, text: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
}

function withWorkspace(
  state: ClipShelfState,
): { workspace: string; clips: Clip[] } {
  const workspace = readWorkspace();
  if (state.workspace === workspace) {
    return { workspace, clips: state.clips };
  }
  return { workspace, clips: loadClips(workspace) };
}

export const useClipShelf = create<ClipShelfState>((set, get) => ({
  workspace: "",
  clips: [],
  load: (workspace) => {
    set({ workspace, clips: loadClips(workspace) });
  },
  add: (input, ifNew = false) => {
    const current = withWorkspace(get());
    const placed = placeClip(current.clips, input, Date.now(), { ifNew });
    if (placed === current.clips) return;
    const clips = saveClips(current.workspace, placed);
    set({ workspace: current.workspace, clips });
  },
  update: (id, text) => {
    const value = text.slice(0, CLIP_MAX_CHARS);
    const current = withWorkspace(get());
    const target = current.clips.find((clip) => clip.id === id);
    if (!target || (!value.trim() && !target.image)) return;
    const clips = current.clips.map((clip) =>
      clip.id === id ? { ...clip, text: value, updatedAt: Date.now() } : clip,
    );
    saveClips(current.workspace, clips);
    set({ workspace: current.workspace, clips });
  },
  togglePin: (id) => {
    const current = withWorkspace(get());
    const clips = current.clips.map((clip) =>
      clip.id === id ? { ...clip, pinned: !clip.pinned } : clip,
    );
    saveClips(current.workspace, clips);
    set({ workspace: current.workspace, clips });
  },
  remove: (id) => {
    const current = withWorkspace(get());
    const clips = current.clips.filter((clip) => clip.id !== id);
    saveClips(current.workspace, clips);
    set({ workspace: current.workspace, clips });
  },
}));

function textBeingCopied(): string {
  const active = document.activeElement;
  if (active instanceof Element && active.closest(".monaco-editor")) {
    const selected = readMonacoSelection();
    if (selected) return selected;
  }
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type !== "file")
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return active.value.slice(start, end);
  }
  return document.getSelection()?.toString() ?? "";
}

function rememberFocus(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  if (target.closest("[data-clip-shelf]")) return;
  if (target.closest("[data-vigil-terminal]")) {
    lastWasTerminal = true;
    lastWasMonaco = false;
    lastField = null;
    return;
  }
  if (target.closest(".monaco-editor")) {
    lastWasMonaco = true;
    lastWasTerminal = false;
    lastField = null;
    return;
  }
  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      target.type !== "file" &&
      target.type !== "checkbox" &&
      target.type !== "radio")
  ) {
    lastField = target;
    lastWasMonaco = false;
    lastWasTerminal = false;
  }
}

let lastWasMonaco = false;
let lastWasTerminal = false;
let lastField: HTMLTextAreaElement | HTMLInputElement | null = null;

function insertIntoField(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string,
) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.focus();
  el.setSelectionRange(start, end);
  if (document.execCommand("insertText", false, text)) return;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const cursor = start + text.length;
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const tracker = (el as HTMLInputElement & { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  tracker?.setValue(el.value);
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.setSelectionRange(cursor, cursor);
}

type ImageSink = (dataUrl: string) => void;
type TerminalSink = (text: string) => boolean;
let imageSink: ImageSink | null = null;
let terminalSink: TerminalSink | null = null;

export function setClipImageSink(next: ImageSink | null) {
  imageSink = next;
}

/** Lets the terminal receive pasted text from the clip shelf. */
export function setClipTerminalSink(next: TerminalSink | null) {
  terminalSink = next;
}

function insertText(text: string): boolean {
  if (lastWasTerminal && terminalSink?.(text)) return true;
  if (lastWasMonaco && insertMonacoText(text)) return true;
  if (lastField && lastField.isConnected) {
    insertIntoField(lastField, text);
    return true;
  }
  return insertMonacoText(text);
}

/** Puts the clip into the editor/terminal, and an image onto the chat composer. */
export function pasteClip(clip: { text: string; image?: string }): boolean {
  let placed = false;
  if (clip.image && imageSink) {
    imageSink(clip.image);
    placed = true;
  }
  if (clip.text.trim()) placed = insertText(clip.text) || placed;
  return placed;
}

export function shrinkClipImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return Promise.resolve("");
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const edge = Math.max(img.width, img.height);
      if (edge <= 0) {
        resolve("");
        return;
      }
      const scale = Math.min(1, CLIP_IMAGE_EDGE / edge);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("");
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let out = canvas.toDataURL("image/jpeg", quality);
      while (out.length > CLIP_IMAGE_MAX_CHARS && quality > 0.4) {
        quality -= 0.1;
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out.startsWith("data:image/") ? out : "");
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function readClipboardImage(): Promise<string | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((entry) => entry.startsWith("image/"));
      if (!type) continue;
      const raw = await blobToDataUrl(await item.getType(type));
      const image = await shrinkClipImage(raw);
      return image || null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Keeps a copied picture that is not already in the shelf. */
export async function refreshClipboardImages(ifNew = true): Promise<boolean> {
  const image = await readClipboardImage();
  if (!image) return false;
  useClipShelf.getState().add({ image }, ifNew);
  return true;
}

function imageSrcsFromSelection(): string[] {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  const srcs: string[] = [];
  const push = (src: string | null | undefined) => {
    if (src && !srcs.includes(src)) srcs.push(src);
  };
  for (let i = 0; i < selection.rangeCount; i++) {
    selection
      .getRangeAt(i)
      .cloneContents()
      .querySelectorAll("img")
      .forEach((img) => push(img.currentSrc || img.src));
  }
  const node = selection.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (el instanceof HTMLImageElement) push(el.currentSrc || el.src);
  return srcs;
}

async function keepImages(srcs: string[]) {
  const fromOs = await readClipboardImage();
  if (fromOs) {
    useClipShelf.getState().add({ image: fromOs });
    return;
  }
  for (const src of srcs) {
    const image = await shrinkClipImage(src);
    if (image) useClipShelf.getState().add({ image });
  }
}

export function installClipCapture(): () => void {
  if (installed) return () => {};
  installed = true;
  const onCopy = () => {
    const text = textBeingCopied();
    const images = imageSrcsFromSelection();
    if (text.trim()) useClipShelf.getState().add(text);
    window.setTimeout(() => void keepImages(images), 40);
  };
  const onPaste = (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      void blobToDataUrl(file).then(async (raw) => {
        const image = await shrinkClipImage(raw);
        if (image) useClipShelf.getState().add({ image }, true);
      });
    }
  };
  const onFocus = (event: FocusEvent) => rememberFocus(event.target);
  const onShow = () => {
    if (document.visibilityState === "visible") void refreshClipboardImages(true);
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("paste", onPaste);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("visibilitychange", onShow);
  return () => {
    installed = false;
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("paste", onPaste);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("visibilitychange", onShow);
  };
}
