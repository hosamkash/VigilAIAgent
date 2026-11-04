import { create } from "zustand";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  loadStoredThemeId,
  persistThemeId,
  type ThemeId,
  THEMES,
  getTheme,
} from "../lib/theme";

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: DEFAULT_THEME_ID,
  setTheme: (themeId) => {
    applyTheme(themeId);
    persistThemeId(themeId);
    set({ themeId });
  },
  initTheme: () => {
    const themeId = loadStoredThemeId();
    applyTheme(themeId);
    set({ themeId });
  },
}));

export { THEMES, getTheme };
