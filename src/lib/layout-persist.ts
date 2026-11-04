export const LAYOUT_SIZES_KEY = "vigil_layout_sizes";
export const TERMINAL_HEIGHT_KEY = "vigil_terminal_height";

export interface LayoutSizes {
  /** Horizontal: [explorer, editor, chat] as percentages that sum ~100 */
  horizontal: [number, number, number];
  /** Vertical within center: [editor, terminal] percentages */
  vertical: [number, number];
}

export const DEFAULT_LAYOUT: LayoutSizes = {
  horizontal: [22, 48, 30],
  vertical: [70, 30],
};

export function loadLayoutSizes(): LayoutSizes {
  try {
    const raw = localStorage.getItem(LAYOUT_SIZES_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>;
    const horizontal = normalizeTriple(
      parsed.horizontal ?? DEFAULT_LAYOUT.horizontal,
    );
    const vertical = normalizePair(parsed.vertical ?? DEFAULT_LAYOUT.vertical);
    return { horizontal, vertical };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayoutSizes(sizes: LayoutSizes): void {
  try {
    localStorage.setItem(LAYOUT_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    /* ignore */
  }
}

/** Absolute terminal height in px (secondary persist key from spec). */
export function loadTerminalHeightPx(fallback = 220): number {
  try {
    const raw = localStorage.getItem(TERMINAL_HEIGHT_KEY);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(480, Math.max(120, n)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveTerminalHeightPx(px: number): void {
  try {
    localStorage.setItem(
      TERMINAL_HEIGHT_KEY,
      String(Math.min(480, Math.max(120, Math.round(px)))),
    );
  } catch {
    /* ignore */
  }
}

function normalizeTriple(v: number[]): [number, number, number] {
  const a = Math.max(5, v[0] ?? 22);
  const b = Math.max(5, v[1] ?? 48);
  const c = Math.max(5, v[2] ?? 30);
  const sum = a + b + c;
  return [(a / sum) * 100, (b / sum) * 100, (c / sum) * 100];
}

function normalizePair(v: number[]): [number, number] {
  const a = Math.max(5, v[0] ?? 70);
  const b = Math.max(5, v[1] ?? 30);
  const sum = a + b;
  return [(a / sum) * 100, (b / sum) * 100];
}

/** Convert Allotment pixel sizes to percentages. */
export function sizesToPercents(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => (s / sum) * 100);
}
