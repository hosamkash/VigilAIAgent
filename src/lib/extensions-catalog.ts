/** Marketplace catalog — details are hosted on official pages (not custom UIs). */

export interface ExtensionItem {
  id: string;
  name: string;
  publisher: string;
  description: string;
  /** VS Marketplace itemName when available */
  marketplaceItemName?: string;
  /** Official detail page to embed / open */
  detailUrl: string;
  builtin?: boolean;
  /** Starts installed (built-ins) */
  defaultInstalled?: boolean;
}

const INSTALLED_KEY = "vigil.extensions.installed";

export const BUILTIN_EXTENSIONS: ExtensionItem[] = [
  {
    id: "vigil.theme",
    name: "Vigil Themes",
    publisher: "Vigil",
    description: "Light, Dark, Ocean, Forest, Sunset color themes",
    detailUrl: "",
    builtin: true,
    defaultInstalled: true,
  },
  {
    id: "vigil.git",
    name: "Git Source Control",
    publisher: "Vigil",
    description: "Built-in Git status, stage, commit, diff",
    detailUrl: "https://git-scm.com/doc",
    builtin: true,
    defaultInstalled: true,
  },
  {
    id: "vigil.terminal",
    name: "Integrated Terminal",
    publisher: "Vigil",
    description: "xterm.js command runner with theme sync",
    detailUrl: "https://xtermjs.org/",
    builtin: true,
    defaultInstalled: true,
  },
  {
    id: "vigil.cline",
    name: "Cline Agent Core",
    publisher: "Vigil",
    description: "Sidecar-backed AI coding agent",
    detailUrl: "https://docs.cline.bot/",
    builtin: true,
    defaultInstalled: true,
  },
];

/** Real marketplace entries — detail pages from Open VSX / VS Marketplace. */
export const MARKETPLACE_EXTENSIONS: ExtensionItem[] = [
  {
    id: "esbenp.prettier-vscode",
    name: "Prettier",
    publisher: "Prettier",
    description: "Code formatter using prettier",
    marketplaceItemName: "esbenp.prettier-vscode",
    detailUrl: "https://open-vsx.org/extension/esbenp/prettier-vscode",
  },
  {
    id: "dbaeumer.vscode-eslint",
    name: "ESLint",
    publisher: "Microsoft",
    description: "Integrates ESLint into VS Code",
    marketplaceItemName: "dbaeumer.vscode-eslint",
    detailUrl: "https://open-vsx.org/extension/dbaeumer/vscode-eslint",
  },
  {
    id: "ms-python.python",
    name: "Python",
    publisher: "Microsoft",
    description: "Python language support",
    marketplaceItemName: "ms-python.python",
    detailUrl: "https://open-vsx.org/extension/ms-python/python",
  },
  {
    id: "rust-lang.rust-analyzer",
    name: "rust-analyzer",
    publisher: "rust-lang",
    description: "Rust language server",
    marketplaceItemName: "rust-lang.rust-analyzer",
    detailUrl: "https://open-vsx.org/extension/rust-lang/rust-analyzer",
  },
  {
    id: "Vue.volar",
    name: "Vue - Official",
    publisher: "Vue",
    description: "Language support for Vue 3",
    marketplaceItemName: "Vue.volar",
    detailUrl: "https://open-vsx.org/extension/Vue/volar",
  },
  {
    id: "bradlc.vscode-tailwindcss",
    name: "Tailwind CSS IntelliSense",
    publisher: "Tailwind Labs",
    description: "Intelligent Tailwind CSS tooling",
    marketplaceItemName: "bradlc.vscode-tailwindcss",
    detailUrl: "https://open-vsx.org/extension/bradlc/vscode-tailwindcss",
  },
];

export function allExtensions(): ExtensionItem[] {
  return [...BUILTIN_EXTENSIONS, ...MARKETPLACE_EXTENSIONS];
}

export function findExtension(id: string): ExtensionItem | undefined {
  return allExtensions().find((e) => e.id === id);
}

export function loadInstalledIds(): Set<string> {
  const set = new Set<string>();
  for (const e of BUILTIN_EXTENSIONS) {
    if (e.defaultInstalled) set.add(e.id);
  }
  try {
    const raw = localStorage.getItem(INSTALLED_KEY);
    if (!raw) return set;
    const list = JSON.parse(raw) as string[];
    if (Array.isArray(list)) {
      for (const id of list) set.add(id);
    }
  } catch {
    /* ignore */
  }
  return set;
}

export function saveInstalledIds(ids: Set<string>): void {
  const extras = [...ids].filter(
    (id) => !BUILTIN_EXTENSIONS.some((b) => b.id === id),
  );
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(extras));
}

export function vsMarketplaceUrl(itemName: string): string {
  return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(itemName)}`;
}
