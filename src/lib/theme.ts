export type ThemeId = "light" | "dark" | "ocean" | "forest" | "sunset";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  mode: "light" | "dark";
  /** Preview swatches for Settings UI */
  swatches: [string, string, string];
  vars: Record<string, string>;
}

/** Cursor / VS Code gitDecoration.* colors for the explorer. */
const GIT_DECO_LIGHT = {
  "--vigil-git-modified": "#895503",
  "--vigil-git-untracked": "#007100",
  "--vigil-git-added": "#587c0c",
  "--vigil-git-deleted": "#ad0707",
  "--vigil-git-conflict": "#ad0707",
} as const;

const GIT_DECO_DARK = {
  "--vigil-git-modified": "#e2c08d",
  "--vigil-git-untracked": "#73c991",
  "--vigil-git-added": "#81b88b",
  "--vigil-git-deleted": "#c74e39",
  "--vigil-git-conflict": "#e4676b",
} as const;

export const THEMES: ThemeDefinition[] = [
  {
    id: "light",
    label: "Light",
    description: "Clean bright IDE — default",
    mode: "light",
    swatches: ["#f3f3f3", "#ffffff", "#0078d4"],
    vars: {
      "--vigil-bg": "#f3f3f3",
      "--vigil-panel": "#ffffff",
      "--vigil-sidebar": "#f3f3f3",
      "--vigil-activity": "#e8e8e8",
      "--vigil-editor": "#ffffff",
      "--vigil-border": "#d4d4d4",
      "--vigil-border-soft": "#e8e8e8",
      "--vigil-accent": "#0078d4",
      "--vigil-accent-soft": "#cce5f7",
      "--vigil-text": "#1e1e1e",
      "--vigil-muted": "#6e6e6e",
      "--vigil-danger": "#c72e0f",
      "--vigil-success": "#388a34",
      "--vigil-tab-active": "#ffffff",
      "--vigil-tab-inactive": "#ececec",
      "--vigil-selection": "#add6ff",
      "--vigil-hover": "#e8e8e8",
      "--vigil-input": "#ffffff",
      "--vigil-scrollbar": "#c1c1c1",
      "--vigil-scrollbar-hover": "#a8a8a8",
      "--vigil-terminal-bg": "#ffffff",
      "--vigil-terminal-fg": "#1e1e1e",
      "--vigil-terminal-cursor": "#1e1e1e",
      ...GIT_DECO_LIGHT,
    },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Cursor-like dark IDE",
    mode: "dark",
    swatches: ["#1e1e1e", "#252526", "#0078d4"],
    vars: {
      "--vigil-bg": "#1e1e1e",
      "--vigil-panel": "#252526",
      "--vigil-sidebar": "#252526",
      "--vigil-activity": "#333333",
      "--vigil-editor": "#1e1e1e",
      "--vigil-border": "#3c3c3c",
      "--vigil-border-soft": "#2b2b2b",
      "--vigil-accent": "#0078d4",
      "--vigil-accent-soft": "#264f78",
      "--vigil-text": "#cccccc",
      "--vigil-muted": "#858585",
      "--vigil-danger": "#f14c4c",
      "--vigil-success": "#89d185",
      "--vigil-tab-active": "#1e1e1e",
      "--vigil-tab-inactive": "#2d2d2d",
      "--vigil-selection": "#264f78",
      "--vigil-hover": "#2a2d2e",
      "--vigil-input": "#1e1e1e",
      "--vigil-scrollbar": "#424242",
      "--vigil-scrollbar-hover": "#4f4f4f",
      "--vigil-terminal-bg": "#1e1e1e",
      "--vigil-terminal-fg": "#cccccc",
      "--vigil-terminal-cursor": "#cccccc",
      ...GIT_DECO_DARK,
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue night coding",
    mode: "dark",
    swatches: ["#0b1220", "#121a2b", "#38bdf8"],
    vars: {
      "--vigil-bg": "#0b1220",
      "--vigil-panel": "#121a2b",
      "--vigil-sidebar": "#101827",
      "--vigil-activity": "#0f172a",
      "--vigil-editor": "#0b1220",
      "--vigil-border": "#1e293b",
      "--vigil-border-soft": "#162033",
      "--vigil-accent": "#38bdf8",
      "--vigil-accent-soft": "#0c4a6e",
      "--vigil-text": "#e2e8f0",
      "--vigil-muted": "#94a3b8",
      "--vigil-danger": "#fb7185",
      "--vigil-success": "#4ade80",
      "--vigil-tab-active": "#0b1220",
      "--vigil-tab-inactive": "#152238",
      "--vigil-selection": "#1e3a5f",
      "--vigil-hover": "#162033",
      "--vigil-input": "#0b1220",
      "--vigil-scrollbar": "#334155",
      "--vigil-scrollbar-hover": "#475569",
      "--vigil-terminal-bg": "#0b1220",
      "--vigil-terminal-fg": "#e2e8f0",
      "--vigil-terminal-cursor": "#38bdf8",
      ...GIT_DECO_DARK,
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Soft green on cream paper",
    mode: "light",
    swatches: ["#f4f7f2", "#ffffff", "#2f6f4e"],
    vars: {
      "--vigil-bg": "#f4f7f2",
      "--vigil-panel": "#ffffff",
      "--vigil-sidebar": "#eef3ea",
      "--vigil-activity": "#e4ebe0",
      "--vigil-editor": "#ffffff",
      "--vigil-border": "#d5e0d0",
      "--vigil-border-soft": "#e7eee3",
      "--vigil-accent": "#2f6f4e",
      "--vigil-accent-soft": "#d7eadf",
      "--vigil-text": "#1f2a24",
      "--vigil-muted": "#66786d",
      "--vigil-danger": "#b42318",
      "--vigil-success": "#3f8f5a",
      "--vigil-tab-active": "#ffffff",
      "--vigil-tab-inactive": "#e8efe4",
      "--vigil-selection": "#cfe6d7",
      "--vigil-hover": "#e7eee3",
      "--vigil-input": "#ffffff",
      "--vigil-scrollbar": "#c5d2c4",
      "--vigil-scrollbar-hover": "#aebdab",
      "--vigil-terminal-bg": "#ffffff",
      "--vigil-terminal-fg": "#1f2a24",
      "--vigil-terminal-cursor": "#2f6f4e",
      ...GIT_DECO_LIGHT,
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm dusk accents",
    mode: "dark",
    swatches: ["#1c1410", "#261c16", "#f59e0b"],
    vars: {
      "--vigil-bg": "#1c1410",
      "--vigil-panel": "#261c16",
      "--vigil-sidebar": "#221811",
      "--vigil-activity": "#2a1d14",
      "--vigil-editor": "#1c1410",
      "--vigil-border": "#3d2c22",
      "--vigil-border-soft": "#30231a",
      "--vigil-accent": "#f59e0b",
      "--vigil-accent-soft": "#7c4a12",
      "--vigil-text": "#f5e6d3",
      "--vigil-muted": "#b69a82",
      "--vigil-danger": "#fb7185",
      "--vigil-success": "#86efac",
      "--vigil-tab-active": "#1c1410",
      "--vigil-tab-inactive": "#2a1d14",
      "--vigil-selection": "#5b3a16",
      "--vigil-hover": "#30231a",
      "--vigil-input": "#1c1410",
      "--vigil-scrollbar": "#5a4333",
      "--vigil-scrollbar-hover": "#6e5340",
      "--vigil-terminal-bg": "#1c1410",
      "--vigil-terminal-fg": "#f5e6d3",
      "--vigil-terminal-cursor": "#f59e0b",
      ...GIT_DECO_DARK,
    },
  },
];

export const DEFAULT_THEME_ID: ThemeId = "light";
export const THEME_STORAGE_KEY = "vigil.themeId";

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export function applyTheme(id: ThemeId): void {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.id);
  root.style.colorScheme = theme.mode;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value);
  }
}

export function loadStoredThemeId(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && THEMES.some((t) => t.id === raw)) {
      return raw as ThemeId;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID;
}

export function persistThemeId(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
